import mongoose, { Types } from 'mongoose';
import {
  ActivityEntityType,
  DeliveryFailureReason,
  DeliveryPriority,
  DeliveryProofType,
  DeliveryStatus,
  NotificationCategory,
  NotificationEvent,
  OrderStatus,
  PaymentMethod,
  RealtimeEvent,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { Delivery } from '../models/Delivery';
import { Order } from '../models/Order';
import { Package } from '../models/Package';
import { User } from '../models/User';
import { issueDeliveryOtp, otpDeliveryProvider, verifyDeliveryOtp } from './deliveryOtpService';
import { proofFileStorage, type ProofFileInput } from './proofFileService';
import { createDeliveryCollectionPayment } from './paymentService';
import type { PaymentAttachmentInput } from './paymentAttachmentService';
import { Payment } from '../models/Payment';
import { businessDateString, getInvoiceBalance } from './ledgerService';
import { notify } from './notificationService';
import type { TemplateContext } from './notificationCatalogue';
import { ActivityVisibility, recordActivity } from './activityService';
import { emitEntityUpdate } from './realtime';
import { MANAGEMENT_ROLES, userIdsWithRoles } from './notificationAudience';
import { deliverySettings } from './settingsService';

export type DeliveryActor = { _id: Types.ObjectId; role: UserRole };

type ActionInput = { version: number; idempotencyKey: string };
type AssignmentInput = ActionInput & {
  deliveryPersonId: string;
  expectedDeliveryDate: Date;
  priority: DeliveryPriority;
  instructions?: string;
};
type HandoverInput = ActionInput & {
  packageReference: string;
  invoiceReference: string;
  packageCount: number;
};
type CompletionInput = ActionInput & {
  receiverName: string;
  receiverPhone: string;
  otp?: string;
  signature?: ProofFileInput;
  photograph?: ProofFileInput;
  gps?: {
    latitude: number;
    longitude: number;
    accuracyMetres?: number;
    capturedAt: Date;
  };
  notes?: string;
  /**
   * When the rider finished, present only when they were away from signal at
   * the time. `DeliveryCompletionSchema` bounds it; its presence is also what
   * makes the audit record say the completion arrived queued.
   */
  deliveredAt?: Date;
  deliveredPackageCount: number;
  noPaymentCollected: boolean;
  collectedAmountMinor: number;
  collectionMethod?: 'CASH' | 'BANK_TRANSFER' | 'MOBILE_FINANCIAL_SERVICE' | 'CHEQUE' | 'OTHER';
  transactionReference?: string;
  paymentProof?: PaymentAttachmentInput;
};

const internalRoles: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];

function actionError(message: string, code: string, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

/**
 * Proof requirements now come from System Settings, which fall back to
 * `DELIVERY_REQUIRED_PROOFS` and then to OTP. An empty configured list would
 * leave a delivery with no receiver evidence at all, so OTP is always restored.
 */
export async function configuredProofRequirements(): Promise<DeliveryProofType[]> {
  const configured = (await deliverySettings()).requiredProofs;
  return [...new Set(configured.length ? configured : [DeliveryProofType.OTP])];
}

function assertDeliveryPerson(delivery: InstanceType<typeof Delivery>, actor: DeliveryActor) {
  if (
    actor.role === UserRole.DELIVERY_PERSON &&
    (!delivery.assignedTo || String(delivery.assignedTo) !== String(actor._id))
  ) {
    throw actionError('This delivery is assigned to another delivery person', 'FORBIDDEN', 403);
  }
}

function replayed(delivery: InstanceType<typeof Delivery>, key: string) {
  return delivery.processedActionKeys.includes(key);
}

function recordTransition(
  delivery: InstanceType<typeof Delivery>,
  to: DeliveryStatus,
  actor: DeliveryActor,
  note?: string,
) {
  const from = delivery.status as DeliveryStatus;
  delivery.status = to;
  delivery.version += 1;
  delivery.history.push({
    from,
    to,
    actorId: actor._id,
    actorRole: actor.role,
    at: new Date(),
    note,
  });
}

function recordAction(delivery: InstanceType<typeof Delivery>, key: string) {
  delivery.processedActionKeys.push(key);
}

async function audit(
  action: string,
  delivery: InstanceType<typeof Delivery>,
  actor: DeliveryActor,
  session: mongoose.ClientSession,
  before?: unknown,
) {
  await AuditLog.create(
    [
      {
        actorId: actor._id,
        actorRole: actor.role,
        action,
        entityType: 'Delivery',
        entityId: delivery._id,
        before,
        after: delivery.toObject(),
      },
    ],
    { session },
  );
}

/**
 * Announces one delivery transition: the notification for the people who must
 * act, and the timeline entry that everyone permitted can read afterwards.
 */
async function announce(input: {
  delivery: InstanceType<typeof Delivery>;
  event: NotificationEvent;
  recipientIds: Types.ObjectId[];
  context: TemplateContext;
  actor?: DeliveryActor;
  summary: string;
  detail?: string;
  visibleToRoles?: UserRole[];
  visibleToShop?: boolean;
  session: mongoose.ClientSession;
}) {
  const { delivery, session } = input;
  await notify({
    event: input.event,
    recipientIds: input.recipientIds,
    context: {
      reference: delivery.reference,
      deliveryId: String(delivery._id),
      ...input.context,
    },
    entityType: 'Delivery',
    entityId: delivery._id,
    // A delivery legitimately revisits states after a failed attempt.
    occurrenceKey: `${input.event}:${delivery.version}`,
    session,
  });
  await recordActivity({
    action: input.event,
    category: NotificationCategory.DELIVERY,
    entityType: ActivityEntityType.DELIVERY,
    entityId: delivery._id,
    orderId: delivery.orderId as never,
    shopId: delivery.shopId as never,
    actor: input.actor ? { _id: input.actor._id, role: input.actor.role } : null,
    summary: input.summary,
    detail: input.detail,
    visibleToRoles: input.visibleToRoles ?? ActivityVisibility.delivery,
    visibleToShop: input.visibleToShop ?? false,
    occurrenceKey: `${input.event}:${delivery.version}`,
    session,
  });
  emitEntityUpdate({
    event: RealtimeEvent.DELIVERY_UPDATED,
    entityType: ActivityEntityType.DELIVERY,
    entityId: delivery._id,
    reference: delivery.reference,
    status: delivery.status,
    orderId: delivery.orderId as never,
    shopId: delivery.shopId as never,
    roles: [...MANAGEMENT_ROLES, UserRole.STOREKEEPER],
    userIds: delivery.assignedTo ? [delivery.assignedTo as never] : [],
    notifyShop: input.visibleToShop ?? false,
  });
}

export async function assignDelivery(id: string, input: AssignmentInput, actor: DeliveryActor) {
  const session = await mongoose.startSession();
  try {
    let result;
    let wasReplay = false;
    await session.withTransaction(async () => {
      const delivery = await Delivery.findById(id)
        .select('+processedActionKeys +otpHash +otpExpiresAt +otpAttempts')
        .session(session);
      if (!delivery) throw actionError('Delivery not found', 'NOT_FOUND', 404);
      if (replayed(delivery, input.idempotencyKey)) {
        result = delivery;
        wasReplay = true;
        return;
      }
      if (
        delivery.version !== input.version ||
        !(
          [
            DeliveryStatus.READY_FOR_ASSIGNMENT,
            DeliveryStatus.ASSIGNED,
            DeliveryStatus.RETURNED_TO_STORE,
          ] as DeliveryStatus[]
        ).includes(delivery.status as DeliveryStatus)
      ) {
        throw actionError('Delivery changed or can no longer be assigned', 'STALE_DELIVERY');
      }
      const person = await User.findOne({
        _id: input.deliveryPersonId,
        role: UserRole.DELIVERY_PERSON,
        status: UserStatus.ACTIVE,
      })
        .select('_id firstName lastName')
        .session(session);
      if (!person) throw actionError('Select an active delivery person', 'INVALID_ASSIGNEE', 400);
      const before = {
        status: delivery.status,
        assignedTo: delivery.assignedTo,
        expectedDeliveryDate: delivery.expectedDeliveryDate,
      };
      const retryAfterReturn = delivery.status === DeliveryStatus.RETURNED_TO_STORE;
      if (retryAfterReturn) {
        delivery.set('handover', undefined);
        delivery.set('failure', undefined);
        delivery.pickupAt = undefined;
        delivery.outForDeliveryAt = undefined;
        delivery.arrivedAt = undefined;
        delivery.returnedAt = undefined;
        delivery.returnedBy = undefined;
        delivery.otpHash = undefined;
        delivery.otpExpiresAt = undefined;
        delivery.otpAttempts = 0;
        delivery.otpSentAt = undefined;
        await Package.updateOne(
          { _id: delivery.packageId, handoverStatus: 'RETURNED_TO_STORE' },
          { $set: { handoverStatus: 'AWAITING_HANDOVER' } },
          { session },
        );
      }
      delivery.assignedTo = person._id;
      delivery.assignedBy = actor._id;
      delivery.assignedAt = new Date();
      delivery.expectedDeliveryDate = input.expectedDeliveryDate;
      delivery.priority = input.priority;
      delivery.instructions = input.instructions;
      recordTransition(
        delivery,
        DeliveryStatus.ASSIGNED,
        actor,
        before.assignedTo ? 'Delivery reassigned' : 'Delivery assigned',
      );
      recordAction(delivery, input.idempotencyKey);
      await delivery.save({ session });
      const order = await Order.findById(delivery.orderId).session(session);
      if (
        order?.status === OrderStatus.READY_FOR_DELIVERY ||
        (retryAfterReturn && order?.status === OrderStatus.DELIVERY_FAILED)
      ) {
        const fromOrder = order.status as
          typeof OrderStatus.READY_FOR_DELIVERY | typeof OrderStatus.DELIVERY_FAILED;
        order.status = OrderStatus.DELIVERY_ASSIGNED;
        order.version += 1;
        order.statusHistory.push({
          from: fromOrder,
          to: OrderStatus.DELIVERY_ASSIGNED,
          actorId: actor._id,
          at: new Date(),
        });
        await order.save({ session });
      }
      await audit(
        before.assignedTo ? 'DELIVERY_REASSIGNED' : 'DELIVERY_ASSIGNED',
        delivery,
        actor,
        session,
        before,
      );
      await announce({
        delivery,
        event: NotificationEvent.DELIVERY_ASSIGNED,
        recipientIds: [person._id],
        // The Dhaka calendar date, not the UTC one: before 6 am they differ,
        // and the rider would be told to expect the delivery yesterday.
        context: { date: businessDateString(input.expectedDeliveryDate) },
        actor,
        summary: `Delivery ${delivery.reference} assigned to ${person.firstName} ${person.lastName}`,
        detail: input.instructions,
        session,
      });
      result = delivery;
    });
    return { delivery: result!, idempotentReplay: wasReplay };
  } finally {
    await session.endSession();
  }
}

export async function handoverDelivery(id: string, input: HandoverInput, actor: DeliveryActor) {
  const session = await mongoose.startSession();
  try {
    let result;
    let wasReplay = false;
    await session.withTransaction(async () => {
      const delivery = await Delivery.findById(id).select('+processedActionKeys').session(session);
      if (!delivery) throw actionError('Delivery not found', 'NOT_FOUND', 404);
      if (replayed(delivery, input.idempotencyKey)) {
        result = delivery;
        wasReplay = true;
        return;
      }
      if (delivery.version !== input.version || delivery.status !== DeliveryStatus.ASSIGNED) {
        throw actionError('Delivery changed or is not ready for handover', 'STALE_DELIVERY');
      }
      const pack = await Package.findById(delivery.packageId).session(session);
      if (
        !pack ||
        pack.reference !== input.packageReference ||
        String(pack.invoiceId) !== String(delivery.invoiceId) ||
        pack.packageCount !== input.packageCount
      ) {
        throw actionError(
          'Package, invoice, or package count does not match',
          'HANDOVER_MISMATCH',
          400,
        );
      }
      const invoice = await mongoose.model('Invoice').findById(delivery.invoiceId).session(session);
      if (!invoice || invoice.get('reference') !== input.invoiceReference) {
        throw actionError('Invoice reference does not match', 'HANDOVER_MISMATCH', 400);
      }
      delivery.handover = {
        confirmedBy: actor._id,
        confirmedAt: new Date(),
        packageReference: input.packageReference,
        invoiceReference: input.invoiceReference,
        packageCount: input.packageCount,
      };
      recordTransition(delivery, DeliveryStatus.HANDED_OVER, actor);
      recordAction(delivery, input.idempotencyKey);
      await delivery.save({ session });
      pack.handoverStatus = 'HANDED_OVER';
      await pack.save({ session });
      const order = await Order.findOne({
        _id: delivery.orderId,
        status: OrderStatus.DELIVERY_ASSIGNED,
      }).session(session);
      if (!order) throw actionError('Order is no longer ready for handover', 'ORDER_STATE');
      order.status = OrderStatus.HANDED_TO_DELIVERY;
      order.version += 1;
      order.statusHistory.push({
        from: OrderStatus.DELIVERY_ASSIGNED,
        to: OrderStatus.HANDED_TO_DELIVERY,
        actorId: actor._id,
        at: new Date(),
      });
      await order.save({ session });
      await audit('DELIVERY_HANDOVER_CONFIRMED', delivery, actor, session);
      await announce({
        delivery,
        event: NotificationEvent.DELIVERY_HANDED_OVER,
        recipientIds: [delivery.assignedTo!],
        context: {},
        actor,
        summary: `${delivery.reference} handed over for ${pack.reference}`,
        detail: 'Awaiting delivery person acknowledgement.',
        session,
      });
      result = delivery;
    });
    return { delivery: result!, idempotentReplay: wasReplay };
  } finally {
    await session.endSession();
  }
}

async function simpleAssignedAction(
  id: string,
  input: ActionInput,
  actor: DeliveryActor,
  config: {
    from: DeliveryStatus;
    to?: DeliveryStatus;
    auditAction: string;
    mutate?: (delivery: InstanceType<typeof Delivery>) => void;
    orderFrom?: OrderStatus;
    orderTo?: OrderStatus;
    packageStatus?: 'RETURNING' | 'RETURNED_TO_STORE';
    announcement?: {
      event: NotificationEvent;
      /** SHOP_OWNER reaches the customer; STORE reaches the people holding custody. */
      audience: 'SHOP_OWNER' | 'STORE';
      summary: (delivery: InstanceType<typeof Delivery>) => string;
      visibleToShop?: boolean;
    };
  },
) {
  const session = await mongoose.startSession();
  try {
    let result;
    let wasReplay = false;
    await session.withTransaction(async () => {
      const delivery = await Delivery.findById(id).select('+processedActionKeys').session(session);
      if (!delivery) throw actionError('Delivery not found', 'NOT_FOUND', 404);
      assertDeliveryPerson(delivery, actor);
      if (replayed(delivery, input.idempotencyKey)) {
        result = delivery;
        wasReplay = true;
        return;
      }
      if (delivery.version !== input.version || delivery.status !== config.from) {
        throw actionError('Delivery changed or action is not allowed', 'STALE_DELIVERY');
      }
      config.mutate?.(delivery);
      if (config.to) recordTransition(delivery, config.to, actor);
      else delivery.version += 1;
      recordAction(delivery, input.idempotencyKey);
      await delivery.save({ session });
      if (config.packageStatus) {
        const packageUpdate = await Package.updateOne(
          { _id: delivery.packageId },
          { $set: { handoverStatus: config.packageStatus } },
          { session },
        );
        if (packageUpdate.matchedCount !== 1) {
          throw actionError('Delivery package was not found', 'PACKAGE_NOT_FOUND', 404);
        }
      }
      if (config.orderFrom && config.orderTo) {
        const order = await Order.findOne({
          _id: delivery.orderId,
          status: config.orderFrom,
        }).session(session);
        if (!order) throw actionError('Order state does not permit this action', 'ORDER_STATE');
        order.status = config.orderTo;
        order.version += 1;
        order.statusHistory.push({
          from: config.orderFrom,
          to: config.orderTo,
          actorId: actor._id,
          at: new Date(),
        });
        await order.save({ session });
      }
      await audit(config.auditAction, delivery, actor, session);
      if (config.announcement) {
        const recipientIds =
          config.announcement.audience === 'SHOP_OWNER'
            ? await orderSubmitterIds(delivery, session)
            : await userIdsWithRoles(
                [UserRole.STOREKEEPER, UserRole.MANAGER, UserRole.ADMIN],
                session,
              );
        await announce({
          delivery,
          event: config.announcement.event,
          recipientIds,
          context: {},
          actor,
          summary: config.announcement.summary(delivery),
          visibleToShop: config.announcement.visibleToShop,
          session,
        });
      }
      result = delivery;
    });
    return { delivery: result!, idempotentReplay: wasReplay };
  } finally {
    await session.endSession();
  }
}

async function orderSubmitterIds(
  delivery: InstanceType<typeof Delivery>,
  session: mongoose.ClientSession,
) {
  const order = await Order.findById(delivery.orderId).select('submittedBy').session(session);
  return order?.submittedBy ? [order.submittedBy as Types.ObjectId] : [];
}

export function acknowledgeHandover(id: string, input: ActionInput, actor: DeliveryActor) {
  return simpleAssignedAction(id, input, actor, {
    from: DeliveryStatus.HANDED_OVER,
    auditAction: 'DELIVERY_HANDOVER_ACKNOWLEDGED',
    mutate: (delivery) => {
      delivery.handover!.acknowledgedBy = actor._id;
      delivery.handover!.acknowledgedAt = new Date();
    },
  });
}

export function confirmPickup(id: string, input: ActionInput, actor: DeliveryActor) {
  return simpleAssignedAction(id, input, actor, {
    from: DeliveryStatus.HANDED_OVER,
    to: DeliveryStatus.PICKED_UP,
    auditAction: 'DELIVERY_PICKED_UP',
    mutate: (delivery) => {
      if (!delivery.handover?.acknowledgedAt) {
        throw actionError('Acknowledge the handover before pickup', 'ACKNOWLEDGEMENT_REQUIRED');
      }
      delivery.pickupAt = new Date();
    },
    orderFrom: OrderStatus.HANDED_TO_DELIVERY,
    orderTo: OrderStatus.PICKED_UP,
    announcement: {
      event: NotificationEvent.DELIVERY_PICKED_UP,
      audience: 'STORE',
      summary: (delivery) => `${delivery.reference} was picked up from the store`,
      visibleToShop: true,
    },
  });
}

export function startDelivery(id: string, input: ActionInput, actor: DeliveryActor) {
  return simpleAssignedAction(id, input, actor, {
    from: DeliveryStatus.PICKED_UP,
    to: DeliveryStatus.OUT_FOR_DELIVERY,
    auditAction: 'DELIVERY_STARTED',
    mutate: (delivery) => {
      delivery.outForDeliveryAt = new Date();
    },
    orderFrom: OrderStatus.PICKED_UP,
    orderTo: OrderStatus.OUT_FOR_DELIVERY,
    announcement: {
      event: NotificationEvent.DELIVERY_OUT_FOR_DELIVERY,
      audience: 'SHOP_OWNER',
      summary: (delivery) => `${delivery.reference} is out for delivery`,
      visibleToShop: true,
    },
  });
}

export function markArrived(id: string, input: ActionInput, actor: DeliveryActor) {
  return simpleAssignedAction(id, input, actor, {
    from: DeliveryStatus.OUT_FOR_DELIVERY,
    to: DeliveryStatus.ARRIVED,
    auditAction: 'DELIVERY_ARRIVED',
    mutate: (delivery) => {
      delivery.arrivedAt = new Date();
    },
  });
}

export async function sendDeliveryOtp(id: string, input: ActionInput, actor: DeliveryActor) {
  const delivery = await Delivery.findById(id).select(
    '+processedActionKeys +otpHash +otpExpiresAt +otpAttempts',
  );
  if (!delivery) throw actionError('Delivery not found', 'NOT_FOUND', 404);
  assertDeliveryPerson(delivery, actor);
  if (replayed(delivery, input.idempotencyKey)) {
    return { delivery, idempotentReplay: true };
  }
  if (delivery.version !== input.version || delivery.status !== DeliveryStatus.ARRIVED) {
    throw actionError('Delivery changed or OTP cannot be sent now', 'STALE_DELIVERY');
  }
  if (delivery.otpSentAt && Date.now() - delivery.otpSentAt.getTime() < 30_000) {
    throw actionError('Wait 30 seconds before requesting another OTP', 'OTP_RATE_LIMIT', 429);
  }
  const otp = await issueDeliveryOtp(id);
  delivery.otpHash = otp.hash;
  delivery.otpExpiresAt = otp.expiresAt;
  delivery.otpAttempts = 0;
  delivery.otpSentAt = new Date();
  delivery.version += 1;
  recordAction(delivery, input.idempotencyKey);
  await delivery.save();
  await otpDeliveryProvider.send(delivery.shopId, delivery.reference, otp.code, otp.expiryMinutes);
  await AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    action: 'DELIVERY_OTP_SENT',
    entityType: 'Delivery',
    entityId: delivery._id,
    after: { expiresAt: otp.expiresAt },
  });
  return { delivery, idempotentReplay: false };
}

export async function completeDelivery(id: string, input: CompletionInput, actor: DeliveryActor) {
  const otpDelivery = await Delivery.findById(id).select(
    '+processedActionKeys +otpHash +otpExpiresAt +otpAttempts',
  );
  if (!otpDelivery) throw actionError('Delivery not found', 'NOT_FOUND', 404);
  assertDeliveryPerson(otpDelivery, actor);
  if (replayed(otpDelivery, input.idempotencyKey)) {
    const payment = await Payment.findOne({ deliveryId: otpDelivery._id });
    return { delivery: otpDelivery, payment, idempotentReplay: true };
  }
  const requiresOtp = otpDelivery.proofRequirements.includes(DeliveryProofType.OTP);
  if (requiresOtp) {
    const valid =
      input.otp &&
      otpDelivery.otpHash &&
      otpDelivery.otpExpiresAt &&
      otpDelivery.otpExpiresAt > new Date() &&
      otpDelivery.otpAttempts < 5 &&
      verifyDeliveryOtp(id, input.otp, otpDelivery.otpHash);
    if (!valid) {
      await Delivery.updateOne({ _id: id }, { $inc: { otpAttempts: 1 } });
      throw actionError('OTP is invalid, expired, or locked', 'INVALID_OTP', 400);
    }
  }
  if (otpDelivery.proofRequirements.includes(DeliveryProofType.SIGNATURE) && !input.signature)
    throw actionError('Receiver signature is required', 'PROOF_REQUIRED', 400);
  if (otpDelivery.proofRequirements.includes(DeliveryProofType.PHOTOGRAPH) && !input.photograph)
    throw actionError('Delivery photograph is required', 'PROOF_REQUIRED', 400);
  if (otpDelivery.proofRequirements.includes(DeliveryProofType.GPS) && !input.gps)
    throw actionError('Delivery location is required', 'PROOF_REQUIRED', 400);
  if (input.collectedAmountMinor > 0 && !input.collectionMethod)
    throw actionError('Collection method is required', 'COLLECTION_METHOD_REQUIRED', 400);
  if (input.noPaymentCollected && input.collectedAmountMinor > 0)
    throw actionError(
      'No-payment confirmation cannot include an amount',
      'COLLECTION_CONFLICT',
      400,
    );

  const session = await mongoose.startSession();
  try {
    let result;
    let paymentResult: InstanceType<typeof Payment> | undefined;
    let wasReplay = false;
    await session.withTransaction(async () => {
      const delivery = await Delivery.findById(id)
        .select('+processedActionKeys +otpHash +otpExpiresAt +otpAttempts')
        .session(session);
      if (!delivery) throw actionError('Delivery not found', 'NOT_FOUND', 404);
      if (replayed(delivery, input.idempotencyKey)) {
        result = delivery;
        paymentResult =
          (await Payment.findOne({ deliveryId: delivery._id }).session(session)) ?? undefined;
        wasReplay = true;
        return;
      }
      if (delivery.version !== input.version || delivery.status !== DeliveryStatus.ARRIVED) {
        throw actionError('Delivery changed or cannot be completed', 'STALE_DELIVERY');
      }
      const pack = await Package.findById(delivery.packageId).session(session);
      if (!pack || input.deliveredPackageCount > pack.packageCount) {
        throw actionError(
          'Delivered package count exceeds the handover count',
          'PACKAGE_COUNT',
          400,
        );
      }
      const signatureFileId = input.signature
        ? await proofFileStorage.save(
            delivery._id,
            'SIGNATURE',
            input.signature,
            actor._id,
            session,
          )
        : undefined;
      const photoFileId = input.photograph
        ? await proofFileStorage.save(
            delivery._id,
            'PHOTOGRAPH',
            input.photograph,
            actor._id,
            session,
          )
        : undefined;
      const completeStatus =
        input.deliveredPackageCount === pack.packageCount
          ? DeliveryStatus.DELIVERED
          : DeliveryStatus.PARTIALLY_DELIVERED;
      /*
       * When the rider actually finished, which is not always now.
       *
       * A round goes where the signal does not, so a completion can be recorded
       * at the shop door and arrive hours later. Stamping it on arrival made the
       * record say the delivery happened when the connection came back — and
       * the money with it, so a collection taken at two in the afternoon was
       * dated to whenever the rider next found a bar of signal.
       *
       * `DeliveryCompletionSchema` bounds what a client may claim: no further
       * ahead than clock skew, no further back than twelve hours.
       */
      const finishedAt = input.deliveredAt ?? new Date();
      delivery.proof = {
        receiverName: input.receiverName,
        receiverPhone: input.receiverPhone,
        otpVerifiedAt: requiresOtp ? new Date() : undefined,
        signatureFileId,
        photoFileId,
        gps: input.gps,
        notes: input.notes,
        deliveredPackageCount: input.deliveredPackageCount,
        deliveredAt: finishedAt,
      };
      delivery.paymentCollection = {
        amountMinor: input.collectedAmountMinor,
        method: input.collectionMethod,
        transactionReference: input.transactionReference,
        status: input.collectedAmountMinor > 0 ? 'PENDING_POSTING' : 'NO_COLLECTION',
      };
      recordTransition(delivery, completeStatus, actor);
      recordAction(delivery, input.idempotencyKey);
      await delivery.save({ session });
      if (input.collectedAmountMinor > 0 && input.collectionMethod) {
        const invoiceBalance = await getInvoiceBalance(
          delivery.invoiceId as Types.ObjectId,
          session,
        );
        if (input.collectedAmountMinor > invoiceBalance.currentAmountDueMinor) {
          throw actionError(
            'Collected amount exceeds the current invoice due',
            'COLLECTION_OVERPAYMENT',
            409,
          );
        }
        const created = await createDeliveryCollectionPayment(
          {
            deliveryId: delivery._id,
            shopId: delivery.shopId as Types.ObjectId,
            invoiceId: delivery.invoiceId as Types.ObjectId,
            amountMinor: input.collectedAmountMinor,
            method: input.collectionMethod as Exclude<PaymentMethod, 'CREDIT' | 'ADVANCE_BALANCE'>,
            transactionReference: input.transactionReference,
            // The same instant the proof carries: the cash changed hands when
            // the customer signed, not when the handset reconnected.
            collectedAt: finishedAt,
            notes: input.notes,
            paymentProof: input.paymentProof,
            idempotencyKey: `delivery-collection:${delivery._id}`,
          },
          actor,
          session,
        );
        paymentResult = created.payment;
        delivery.paymentCollection.paymentId = created.payment._id;
        delivery.paymentCollection.paymentReference = created.payment.reference;
        delivery.paymentCollection.status =
          created.payment.status === 'POSTED' ? 'POSTED' : 'PENDING_POSTING';
        await delivery.save({ session });
      }
      const order = await Order.findOne({
        _id: delivery.orderId,
        status: OrderStatus.OUT_FOR_DELIVERY,
      }).session(session);
      if (!order) throw actionError('Order is no longer out for delivery', 'ORDER_STATE');
      const orderTo =
        completeStatus === DeliveryStatus.DELIVERED
          ? OrderStatus.DELIVERED
          : OrderStatus.PARTIALLY_DELIVERED;
      order.status = orderTo;
      order.version += 1;
      order.statusHistory.push({
        from: OrderStatus.OUT_FOR_DELIVERY,
        to: orderTo,
        actorId: actor._id,
        at: new Date(),
      });
      await order.save({ session });
      /*
       * A queued completion is a different kind of record and says so.
       *
       * `GET /admin/audit/actions` is built from the distinct actions in the
       * collection, so this becomes a filter on the audit screen without any
       * further plumbing: somebody reconciling a day's cash can ask for exactly
       * the completions that were recorded away from signal, and see how long
       * each one sat before it arrived.
       */
      await audit(
        input.deliveredAt ? 'DELIVERY_CONFIRMED_OFFLINE' : 'DELIVERY_CONFIRMED',
        delivery,
        actor,
        session,
        input.deliveredAt ? { recordedAt: finishedAt, arrivedAt: new Date() } : undefined,
      );
      await announce({
        delivery,
        event: NotificationEvent.DELIVERY_COMPLETED,
        recipientIds: [order.submittedBy],
        context: {
          count: input.deliveredPackageCount,
          receiverName: input.receiverName,
        },
        actor,
        summary: `${delivery.reference} completed by ${input.receiverName}`,
        detail: `${input.deliveredPackageCount} package(s) received.`,
        visibleToShop: true,
        session,
      });
      result = delivery;
    });
    return { delivery: result!, payment: paymentResult, idempotentReplay: wasReplay };
  } finally {
    await session.endSession();
  }
}

export async function failDelivery(
  id: string,
  input: ActionInput & { reason: DeliveryFailureReason; notes: string },
  actor: DeliveryActor,
) {
  const session = await mongoose.startSession();
  try {
    let result;
    let wasReplay = false;
    await session.withTransaction(async () => {
      const delivery = await Delivery.findById(id).select('+processedActionKeys').session(session);
      if (!delivery) throw actionError('Delivery not found', 'NOT_FOUND', 404);
      assertDeliveryPerson(delivery, actor);
      if (replayed(delivery, input.idempotencyKey)) {
        result = delivery;
        wasReplay = true;
        return;
      }
      const failStatuses: DeliveryStatus[] = [
        DeliveryStatus.ASSIGNED,
        DeliveryStatus.HANDED_OVER,
        DeliveryStatus.PICKED_UP,
        DeliveryStatus.OUT_FOR_DELIVERY,
        DeliveryStatus.ARRIVED,
      ];
      if (delivery.version !== input.version || !failStatuses.includes(delivery.status)) {
        throw actionError('Delivery changed or cannot be failed', 'STALE_DELIVERY');
      }
      delivery.failure = {
        reason: input.reason,
        notes: input.notes,
        reportedBy: actor._id,
        reportedAt: new Date(),
      };
      recordTransition(delivery, DeliveryStatus.FAILED, actor, input.reason);
      recordAction(delivery, input.idempotencyKey);
      await delivery.save({ session });
      const order = await Order.findById(delivery.orderId).session(session);
      if (!order) throw actionError('Order not found', 'NOT_FOUND', 404);
      const previousOrderStatus = order.status as OrderStatus;
      order.status = OrderStatus.DELIVERY_FAILED;
      order.version += 1;
      order.statusHistory.push({
        from: previousOrderStatus,
        to: OrderStatus.DELIVERY_FAILED,
        actorId: actor._id,
        at: new Date(),
        note: input.reason,
      });
      await order.save({ session });
      const managers = await User.find({ role: { $in: internalRoles }, status: UserStatus.ACTIVE })
        .select('_id')
        .session(session);
      await announce({
        delivery,
        event: NotificationEvent.DELIVERY_FAILED,
        recipientIds: [...managers.map((user) => user._id), order.submittedBy],
        context: { reason: input.reason, note: input.notes },
        actor,
        summary: `${delivery.reference} failed: ${input.reason.replaceAll('_', ' ').toLowerCase()}`,
        detail: input.notes,
        visibleToShop: true,
        session,
      });
      await audit('DELIVERY_FAILED', delivery, actor, session);
      result = delivery;
    });
    return { delivery: result!, idempotentReplay: wasReplay };
  } finally {
    await session.endSession();
  }
}

export async function startReturn(id: string, input: ActionInput, actor: DeliveryActor) {
  return simpleAssignedAction(id, input, actor, {
    from: DeliveryStatus.FAILED,
    to: DeliveryStatus.RETURNING,
    auditAction: 'DELIVERY_RETURN_STARTED',
    packageStatus: 'RETURNING',
  });
}

export async function confirmReturned(id: string, input: ActionInput, actor: DeliveryActor) {
  return simpleAssignedAction(id, input, actor, {
    from: DeliveryStatus.RETURNING,
    to: DeliveryStatus.RETURNED_TO_STORE,
    auditAction: 'DELIVERY_RETURNED_TO_STORE',
    packageStatus: 'RETURNED_TO_STORE',
    mutate: (delivery) => {
      delivery.returnedAt = new Date();
      delivery.returnedBy = actor._id;
    },
    announcement: {
      event: NotificationEvent.DELIVERY_RETURNED,
      audience: 'STORE',
      summary: (delivery) => `${delivery.reference} was returned to store custody`,
    },
  });
}

export async function cancelDelivery(id: string, input: ActionInput, actor: DeliveryActor) {
  const session = await mongoose.startSession();
  try {
    let result;
    let wasReplay = false;
    await session.withTransaction(async () => {
      const delivery = await Delivery.findById(id).select('+processedActionKeys').session(session);
      if (!delivery) throw actionError('Delivery not found', 'NOT_FOUND', 404);
      if (replayed(delivery, input.idempotencyKey)) {
        result = delivery;
        wasReplay = true;
        return;
      }
      if (
        delivery.version !== input.version ||
        !(
          [DeliveryStatus.READY_FOR_ASSIGNMENT, DeliveryStatus.ASSIGNED] as DeliveryStatus[]
        ).includes(delivery.status as DeliveryStatus)
      )
        throw actionError('Only an uncollected delivery can be cancelled', 'STALE_DELIVERY');
      delivery.cancelledAt = new Date();
      delivery.cancelledBy = actor._id;
      recordTransition(delivery, DeliveryStatus.CANCELLED, actor);
      recordAction(delivery, input.idempotencyKey);
      await delivery.save({ session });
      await audit('DELIVERY_CANCELLED', delivery, actor, session);
      result = delivery;
    });
    return { delivery: result!, idempotentReplay: wasReplay };
  } finally {
    await session.endSession();
  }
}
