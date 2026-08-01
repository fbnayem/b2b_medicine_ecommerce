import mongoose, { ClientSession, Types } from 'mongoose';
import {
  ActivityEntityType,
  NotificationCategory,
  NotificationEvent,
  OrderStatus,
  RealtimeEvent,
  ReturnDisposition,
  ReturnReason,
  ReturnStatus,
  StockMovementType,
  UserRole,
} from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { nextReference } from '../models/Counter';
import { CreditNote } from '../models/CreditNote';
import { Invoice } from '../models/Invoice';
import { MedicineBatch } from '../models/MedicineBatch';
import { Order } from '../models/Order';
import { Return } from '../models/Return';
import { Shop } from '../models/Shop';
import { ActivityVisibility, recordActivity } from './activityService';
import { applyReturnMovement } from './inventoryService';
import { postReturnCredit } from './ledgerService';
import { MANAGEMENT_ROLES, ownersForShop, userIdsWithRoles } from './notificationAudience';
import type { TemplateContext } from './notificationCatalogue';
import { notify } from './notificationService';
import { emitEntityUpdate } from './realtime';
import { businessSettings } from './settingsService';
import {
  assertCreditWithinInvoice,
  assertDispositionValid,
  assertReturnRole,
  assertReturnTransition,
  computeReturnCredit,
  decisionStatus,
  dispositionMovements,
  remainingReturnableQuantity,
  type ReturnAction,
} from './returnRules';

export type ReturnActor = {
  _id: Types.ObjectId;
  role: UserRole;
  firstName?: string;
  lastName?: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
};

type ReturnDocument = InstanceType<typeof Return>;
type ActionInput = { version: number; idempotencyKey: string };

function returnError(message: string, code: string, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

const lineKey = (medicineId: unknown, batchId: unknown) =>
  `${String(medicineId)}:${String(batchId)}`;

/** Statuses in which the order is considered delivered and therefore returnable. */
const RETURNABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.PARTIALLY_DELIVERED,
  OrderStatus.RETURN_REQUESTED,
];

const CLOSED: ReturnStatus[] = [ReturnStatus.REJECTED, ReturnStatus.CANCELLED];

const dispositionMovementType: Record<ReturnDisposition, StockMovementType> = {
  [ReturnDisposition.RESTOCK]: StockMovementType.RETURN_RESTOCK,
  [ReturnDisposition.DAMAGED]: StockMovementType.RETURN_DAMAGED,
  [ReturnDisposition.EXPIRED]: StockMovementType.RETURN_EXPIRED,
  [ReturnDisposition.QUARANTINED]: StockMovementType.RETURN_QUARANTINED,
};

async function assertShopAccess(shopId: Types.ObjectId | string, actor: ReturnActor) {
  if (actor.role !== UserRole.SHOP_OWNER) return;
  const owned = await Shop.exists({ _id: shopId, ownerIds: actor._id });
  if (!owned) throw returnError('This return belongs to another shop', 'FORBIDDEN', 403);
}

function recordTransition(
  record: ReturnDocument,
  to: ReturnStatus,
  actor: ReturnActor,
  note?: string,
) {
  const from = record.status as ReturnStatus;
  record.status = to;
  record.version += 1;
  record.statusHistory.push({
    from,
    to,
    actorId: actor._id,
    actorRole: actor.role,
    at: new Date(),
    note,
  });
}

async function audit(
  action: string,
  record: ReturnDocument,
  actor: ReturnActor,
  session: ClientSession,
  before?: unknown,
) {
  await AuditLog.create(
    [
      {
        actorId: actor._id,
        actorRole: actor.role,
        action,
        entityType: 'Return',
        entityId: record._id,
        before,
        after: record.toObject(),
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        correlationId: actor.correlationId,
      },
    ],
    { session },
  );
}

/** One notification, one timeline entry and one realtime signal per transition. */
async function announce(input: {
  record: ReturnDocument;
  event: NotificationEvent;
  recipientIds: Array<Types.ObjectId | string>;
  context?: TemplateContext;
  actor?: ReturnActor;
  summary: string;
  detail?: string;
  category?: NotificationCategory;
  visibleToShop?: boolean;
  session: ClientSession;
}) {
  const { record, session } = input;
  await notify({
    event: input.event,
    recipientIds: input.recipientIds,
    context: {
      reference: record.reference,
      returnId: String(record._id),
      orderId: String(record.orderId),
      shopId: String(record.shopId),
      ...input.context,
    },
    entityType: 'Return',
    entityId: record._id,
    occurrenceKey: `${input.event}:${record.version}`,
    session,
  });
  await recordActivity({
    action: input.event,
    category: input.category ?? NotificationCategory.ORDER,
    entityType: ActivityEntityType.RETURN,
    entityId: record._id,
    orderId: record.orderId as never,
    shopId: record.shopId as never,
    actor: input.actor
      ? {
          _id: input.actor._id,
          role: input.actor.role,
          firstName: input.actor.firstName,
          lastName: input.actor.lastName,
        }
      : null,
    summary: input.summary,
    detail: input.detail,
    visibleToRoles: ActivityVisibility.returns,
    visibleToShop: input.visibleToShop ?? true,
    occurrenceKey: `${input.event}:${record.version}`,
    session,
  });
  emitEntityUpdate({
    event: RealtimeEvent.RETURN_UPDATED,
    entityType: ActivityEntityType.RETURN,
    entityId: record._id,
    reference: record.reference,
    status: record.status,
    orderId: record.orderId as never,
    shopId: record.shopId as never,
    roles: [...MANAGEMENT_ROLES, UserRole.STOREKEEPER, UserRole.DELIVERY_PERSON],
    notifyShop: true,
  });
}

async function loadForAction(
  id: string,
  input: ActionInput,
  actor: ReturnActor,
  action: ReturnAction,
  session: ClientSession,
) {
  const record = await Return.findById(id).select('+processedActionKeys').session(session);
  if (!record) throw returnError('Return not found', 'NOT_FOUND', 404);
  await assertShopAccess(record.shopId as Types.ObjectId, actor);
  if (record.processedActionKeys.includes(input.idempotencyKey)) {
    return { record, replayed: true as const };
  }
  // The role check comes first because a forbidden actor should learn nothing
  // about the record's state. The version is then checked ahead of the
  // transition: when a colleague has already acted, "you are looking at a stale
  // copy" is the accurate diagnosis and the one clients recover from by
  // reloading, whereas the state error alone reads as a permanent dead end.
  assertReturnRole(action, actor.role);
  if (record.version !== input.version) {
    throw returnError('This return changed since it was loaded; reload and retry', 'STALE_RETURN');
  }
  assertReturnTransition(action, record.status as ReturnStatus, actor.role);
  record.processedActionKeys.push(input.idempotencyKey);
  return { record, replayed: false as const };
}

/**
 * Moves the order back out of RETURN_REQUESTED once nothing is outstanding.
 * With several returns against one order, the last one to close restores it.
 */
async function releaseOrderIfSettled(
  record: ReturnDocument,
  actor: ReturnActor,
  session: ClientSession,
) {
  const stillOpen = await Return.countDocuments({
    orderId: record.orderId,
    _id: { $ne: record._id },
    status: { $nin: [...CLOSED, ReturnStatus.COMPLETED] },
  }).session(session);
  if (stillOpen > 0) return;
  const order = await Order.findOne({
    _id: record.orderId,
    status: OrderStatus.RETURN_REQUESTED,
  }).session(session);
  if (!order) return;
  const target =
    (record.orderStatusBeforeReturn as OrderStatus | undefined) ?? OrderStatus.DELIVERED;
  order.status = target;
  order.version += 1;
  order.statusHistory.push({
    from: OrderStatus.RETURN_REQUESTED,
    to: target,
    actorId: actor._id,
    at: new Date(),
    note: `Return ${record.reference} closed as ${record.status}`,
  });
  await order.save({ session });
}

export interface CreateReturnInput {
  invoiceId: string;
  primaryReason: ReturnReason;
  shopNotes?: string;
  lines: Array<{
    medicineId: string;
    batchId: string;
    quantity: number;
    reason: ReturnReason;
    notes?: string;
  }>;
  idempotencyKey: string;
}

export async function createReturn(input: CreateReturnInput, actor: ReturnActor) {
  const session = await mongoose.startSession();
  try {
    let created: ReturnDocument | undefined;
    let replayed = false;
    await session.withTransaction(async () => {
      created = undefined;
      replayed = false;
      const existing = await Return.findOne({
        requestIdempotencyKey: input.idempotencyKey,
      }).session(session);
      if (existing) {
        await assertShopAccess(existing.shopId as Types.ObjectId, actor);
        created = existing;
        replayed = true;
        return;
      }
      const invoice = await Invoice.findOne({ _id: input.invoiceId, status: 'ISSUED' }).session(
        session,
      );
      if (!invoice) throw returnError('Issued invoice not found', 'NOT_FOUND', 404);
      await assertShopAccess(invoice.shopId as Types.ObjectId, actor);

      const order = await Order.findById(invoice.orderId).session(session);
      if (!order) throw returnError('Order not found for this invoice', 'NOT_FOUND', 404);
      if (!RETURNABLE_ORDER_STATUSES.includes(order.status as OrderStatus)) {
        throw returnError('Only a delivered order can be returned', 'ORDER_NOT_RETURNABLE');
      }

      const siblings = await Return.find({ invoiceId: invoice._id }).session(session).lean();
      const lines = [];
      for (const requested of input.lines) {
        const invoiceLine = invoice.items.find(
          (item) =>
            lineKey(item.medicineId, item.batchId) ===
            lineKey(requested.medicineId, requested.batchId),
        );
        if (!invoiceLine) {
          throw returnError(
            'One of the returned items is not on this invoice',
            'LINE_NOT_ON_INVOICE',
            400,
          );
        }
        const remaining = remainingReturnableQuantity({
          invoicedQuantity: invoiceLine.quantity,
          openQuantities: siblings.flatMap((sibling) =>
            sibling.lines
              .filter(
                (line) =>
                  lineKey(line.medicineId, line.batchId) ===
                  lineKey(requested.medicineId, requested.batchId),
              )
              .map((line) => ({
                status: sibling.status as ReturnStatus,
                requestedQuantity: line.requestedQuantity,
                approvedQuantity: line.approvedQuantity,
              })),
          ),
        });
        if (requested.quantity > remaining) {
          throw returnError(
            `Only ${remaining} unit(s) of ${invoiceLine.medicineSnapshot.brandName ?? 'this item'} remain returnable on this invoice`,
            'RETURN_EXCEEDS_INVOICE',
          );
        }
        lines.push({
          medicineId: invoiceLine.medicineId,
          medicineSnapshot: invoiceLine.medicineSnapshot,
          batchId: invoiceLine.batchId,
          batchNumber: invoiceLine.batchNumber,
          expiryDate: invoiceLine.expiryDate,
          invoicedQuantity: invoiceLine.quantity,
          requestedQuantity: requested.quantity,
          unitPriceMinor: invoiceLine.unitPriceMinor,
          discountMinor: 0,
          refundMinor: 0,
          reason: requested.reason,
          notes: requested.notes,
        });
      }

      // Indicative only; the binding figure is calculated at approval.
      const estimate = computeReturnCredit({
        lines: lines.map((line) => ({
          invoicedQuantity: line.invoicedQuantity,
          unitPriceMinor: line.unitPriceMinor,
          lineDiscountMinor:
            invoice.items.find(
              (item) =>
                lineKey(item.medicineId, item.batchId) === lineKey(line.medicineId, line.batchId),
            )?.discountMinor ?? 0,
          quantity: line.requestedQuantity,
        })),
        invoiceSubtotalMinor: invoice.subtotalMinor,
        invoiceOrderDiscountMinor: invoice.orderDiscountMinor,
        invoiceDeliveryChargeMinor: invoice.deliveryChargeMinor,
        invoiceTaxMinor: invoice.taxMinor,
      });

      const [record] = await Return.create(
        [
          {
            reference: await nextReference('RET'),
            orderId: order._id,
            invoiceId: invoice._id,
            shopId: invoice.shopId,
            status: ReturnStatus.REQUESTED,
            primaryReason: input.primaryReason,
            orderStatusBeforeReturn:
              order.status === OrderStatus.RETURN_REQUESTED ? undefined : order.status,
            shopNotes: input.shopNotes,
            lines,
            requestedTotalMinor: estimate.totalMinor,
            requestedBy: actor._id,
            requestedAt: new Date(),
            statusHistory: [
              {
                to: ReturnStatus.REQUESTED,
                actorId: actor._id,
                actorRole: actor.role,
                at: new Date(),
              },
            ],
            requestIdempotencyKey: input.idempotencyKey,
          },
        ],
        { session },
      );

      if (order.status !== OrderStatus.RETURN_REQUESTED) {
        const from = order.status as OrderStatus;
        order.status = OrderStatus.RETURN_REQUESTED;
        order.version += 1;
        order.statusHistory.push({
          from,
          to: OrderStatus.RETURN_REQUESTED,
          actorId: actor._id,
          at: new Date(),
          note: record.reference,
        });
        await order.save({ session });
      }

      await audit('RETURN_REQUESTED', record, actor, session);
      const shop = await Shop.findById(record.shopId).select('name managerId').session(session);
      await announce({
        record,
        event: NotificationEvent.RETURN_REQUESTED,
        recipientIds: await userIdsWithRoles(MANAGEMENT_ROLES, session),
        context: {
          shopName: shop?.name,
          reason: input.primaryReason,
          amountMinor: estimate.totalMinor,
        },
        actor,
        summary: `Return ${record.reference} requested against invoice ${invoice.reference}`,
        detail: input.shopNotes,
        session,
      });
      created = record;
    });
    return { record: created!, idempotentReplay: replayed };
  } catch (error) {
    if ((error as { code?: number }).code === 11_000) {
      throw returnError('This return request was already submitted', 'IDEMPOTENCY_CONFLICT');
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function startReturnReview(id: string, input: ActionInput, actor: ReturnActor) {
  const session = await mongoose.startSession();
  try {
    let result: ReturnDocument | undefined;
    let replayed = false;
    await session.withTransaction(async () => {
      const loaded = await loadForAction(id, input, actor, 'START_REVIEW', session);
      result = loaded.record;
      replayed = loaded.replayed;
      if (loaded.replayed) return;
      loaded.record.reviewedBy = actor._id;
      recordTransition(loaded.record, ReturnStatus.UNDER_REVIEW, actor);
      await loaded.record.save({ session });
      await audit('RETURN_REVIEW_STARTED', loaded.record, actor, session);
    });
    return { record: result!, idempotentReplay: replayed };
  } finally {
    await session.endSession();
  }
}

export interface ReturnDecisionInput extends ActionInput {
  lines: Array<{ medicineId: string; batchId: string; approvedQuantity: number }>;
  reviewNotes?: string;
  internalNotes?: string;
}

export async function decideReturn(id: string, input: ReturnDecisionInput, actor: ReturnActor) {
  const session = await mongoose.startSession();
  try {
    let result: ReturnDocument | undefined;
    let replayed = false;
    await session.withTransaction(async () => {
      const loaded = await loadForAction(id, input, actor, 'APPROVE', session);
      result = loaded.record;
      replayed = loaded.replayed;
      if (loaded.replayed) return;
      const record = loaded.record;
      const before = record.toObject();
      const decisions = new Map(
        input.lines.map((line) => [lineKey(line.medicineId, line.batchId), line.approvedQuantity]),
      );
      if (decisions.size !== record.lines.length) {
        throw returnError(
          'Provide a decision for every requested line',
          'INCOMPLETE_DECISION',
          400,
        );
      }
      for (const line of record.lines) {
        const approved = decisions.get(lineKey(line.medicineId, line.batchId));
        if (approved === undefined) {
          throw returnError(
            'Provide a decision for every requested line',
            'INCOMPLETE_DECISION',
            400,
          );
        }
        if (approved > line.requestedQuantity) {
          throw returnError(
            'Approved quantity cannot exceed the requested quantity',
            'APPROVAL_EXCEEDS_REQUEST',
            400,
          );
        }
        line.approvedQuantity = approved;
      }

      const invoice = await Invoice.findById(record.invoiceId).session(session);
      if (!invoice) throw returnError('Invoice not found', 'NOT_FOUND', 404);
      const credit = computeReturnCredit({
        lines: record.lines.map((line) => ({
          invoicedQuantity: line.invoicedQuantity,
          unitPriceMinor: line.unitPriceMinor,
          lineDiscountMinor:
            invoice.items.find(
              (item) =>
                lineKey(item.medicineId, item.batchId) === lineKey(line.medicineId, line.batchId),
            )?.discountMinor ?? 0,
          quantity: line.approvedQuantity,
        })),
        invoiceSubtotalMinor: invoice.subtotalMinor,
        invoiceOrderDiscountMinor: invoice.orderDiscountMinor,
        invoiceDeliveryChargeMinor: invoice.deliveryChargeMinor,
        invoiceTaxMinor: invoice.taxMinor,
      });
      record.lines.forEach((line, index) => {
        line.discountMinor = credit.lines[index].discountMinor;
        line.refundMinor = credit.lines[index].refundMinor;
      });
      record.approvedSubtotalMinor = credit.subtotalMinor;
      record.approvedTaxMinor = credit.taxMinor;
      record.approvedTotalMinor = credit.totalMinor;
      record.reviewNotes = input.reviewNotes;
      if (input.internalNotes) record.internalNotes = input.internalNotes;
      record.reviewedBy = actor._id;
      record.reviewedAt = new Date();

      const target = decisionStatus(record.lines);
      if (target === ReturnStatus.REJECTED) {
        record.rejectionReason = input.reviewNotes ?? 'No returned units were approved on review';
      }
      recordTransition(record, target, actor, input.reviewNotes);
      await record.save({ session });
      if (target === ReturnStatus.REJECTED) await releaseOrderIfSettled(record, actor, session);

      await audit(
        target === ReturnStatus.REJECTED ? 'RETURN_REJECTED' : 'RETURN_APPROVED',
        record,
        actor,
        session,
        before,
      );
      const owners = await ownersForShop(
        await Shop.findById(record.shopId).select('_id ownerIds').session(session),
        session,
      );
      await announce({
        record,
        event:
          target === ReturnStatus.REJECTED
            ? NotificationEvent.RETURN_REJECTED
            : NotificationEvent.RETURN_APPROVED,
        recipientIds: [...owners, record.requestedBy as Types.ObjectId],
        context: {
          status: target,
          amountMinor: credit.totalMinor,
          reason: record.rejectionReason ?? undefined,
        },
        actor,
        summary:
          target === ReturnStatus.REJECTED
            ? `Return ${record.reference} was rejected on review`
            : `Return ${record.reference} ${target === ReturnStatus.APPROVED ? 'approved' : 'partly approved'}`,
        detail: input.reviewNotes,
        session,
      });
    });
    return { record: result!, idempotentReplay: replayed };
  } finally {
    await session.endSession();
  }
}

export async function rejectReturn(
  id: string,
  input: ActionInput & { rejectionReason: string; internalNotes?: string },
  actor: ReturnActor,
) {
  const session = await mongoose.startSession();
  try {
    let result: ReturnDocument | undefined;
    let replayed = false;
    await session.withTransaction(async () => {
      const loaded = await loadForAction(id, input, actor, 'REJECT', session);
      result = loaded.record;
      replayed = loaded.replayed;
      if (loaded.replayed) return;
      const record = loaded.record;
      const before = record.toObject();
      record.rejectionReason = input.rejectionReason;
      if (input.internalNotes) record.internalNotes = input.internalNotes;
      record.reviewedBy = actor._id;
      record.reviewedAt = new Date();
      record.lines.forEach((line) => {
        line.approvedQuantity = 0;
        line.refundMinor = 0;
      });
      record.approvedSubtotalMinor = 0;
      record.approvedTaxMinor = 0;
      record.approvedTotalMinor = 0;
      recordTransition(record, ReturnStatus.REJECTED, actor, input.rejectionReason);
      await record.save({ session });
      await releaseOrderIfSettled(record, actor, session);
      await audit('RETURN_REJECTED', record, actor, session, before);
      const owners = await ownersForShop(
        await Shop.findById(record.shopId).select('_id ownerIds').session(session),
        session,
      );
      await announce({
        record,
        event: NotificationEvent.RETURN_REJECTED,
        recipientIds: [...owners, record.requestedBy as Types.ObjectId],
        context: { reason: input.rejectionReason },
        actor,
        summary: `Return ${record.reference} was rejected`,
        detail: input.rejectionReason,
        session,
      });
    });
    return { record: result!, idempotentReplay: replayed };
  } finally {
    await session.endSession();
  }
}

export async function cancelReturn(
  id: string,
  input: ActionInput & { reason: string },
  actor: ReturnActor,
) {
  const session = await mongoose.startSession();
  try {
    let result: ReturnDocument | undefined;
    let replayed = false;
    await session.withTransaction(async () => {
      const loaded = await loadForAction(id, input, actor, 'CANCEL', session);
      result = loaded.record;
      replayed = loaded.replayed;
      if (loaded.replayed) return;
      const record = loaded.record;
      const before = record.toObject();
      recordTransition(record, ReturnStatus.CANCELLED, actor, input.reason);
      await record.save({ session });
      await releaseOrderIfSettled(record, actor, session);
      await audit('RETURN_CANCELLED', record, actor, session, before);
      await recordActivity({
        action: 'RETURN_CANCELLED',
        category: NotificationCategory.ORDER,
        entityType: ActivityEntityType.RETURN,
        entityId: record._id,
        orderId: record.orderId as never,
        shopId: record.shopId as never,
        actor: {
          _id: actor._id,
          role: actor.role,
          firstName: actor.firstName,
          lastName: actor.lastName,
        },
        summary: `Return ${record.reference} was cancelled`,
        detail: input.reason,
        visibleToRoles: ActivityVisibility.returns,
        visibleToShop: true,
        occurrenceKey: `RETURN_CANCELLED:${record.version}`,
        session,
      });
    });
    return { record: result!, idempotentReplay: replayed };
  } finally {
    await session.endSession();
  }
}

export async function collectReturn(
  id: string,
  input: ActionInput & { notes?: string },
  actor: ReturnActor,
) {
  const session = await mongoose.startSession();
  try {
    let result: ReturnDocument | undefined;
    let replayed = false;
    await session.withTransaction(async () => {
      const loaded = await loadForAction(id, input, actor, 'COLLECT', session);
      result = loaded.record;
      replayed = loaded.replayed;
      if (loaded.replayed) return;
      const record = loaded.record;
      record.collectedBy = actor._id;
      record.collectedAt = new Date();
      recordTransition(record, ReturnStatus.COLLECTED, actor, input.notes);
      await record.save({ session });
      await audit('RETURN_COLLECTED', record, actor, session);
      await announce({
        record,
        event: NotificationEvent.RETURN_COLLECTED,
        recipientIds: await userIdsWithRoles([...MANAGEMENT_ROLES, UserRole.STOREKEEPER], session),
        actor,
        summary: `Return ${record.reference} collected from the shop`,
        detail: input.notes,
        session,
      });
    });
    return { record: result!, idempotentReplay: replayed };
  } finally {
    await session.endSession();
  }
}

export interface ReturnReceiptInput extends ActionInput {
  lines: Array<{
    medicineId: string;
    batchId: string;
    restockQuantity: number;
    damagedQuantity: number;
    expiredQuantity: number;
    quarantinedQuantity: number;
    notes?: string;
  }>;
  notes?: string;
}

/**
 * Books the physical goods in and dispositions each unit. Stock and the return
 * record move in one transaction, so a failure part-way through can never leave
 * stock booked in against a return that stayed unreceived.
 */
export async function receiveReturn(id: string, input: ReturnReceiptInput, actor: ReturnActor) {
  const session = await mongoose.startSession();
  try {
    let result: ReturnDocument | undefined;
    let replayed = false;
    await session.withTransaction(async () => {
      const loaded = await loadForAction(id, input, actor, 'RECEIVE', session);
      result = loaded.record;
      replayed = loaded.replayed;
      if (loaded.replayed) return;
      const record = loaded.record;
      const before = record.toObject();
      const receipts = new Map(
        input.lines.map((line) => [lineKey(line.medicineId, line.batchId), line]),
      );
      const now = new Date();
      let receivedUnits = 0;

      for (const line of record.lines) {
        const received = receipts.get(lineKey(line.medicineId, line.batchId));
        if (!received) {
          if (line.approvedQuantity > 0) {
            throw returnError(
              'Record an inspection result for every approved line',
              'INCOMPLETE_RECEIPT',
              400,
            );
          }
          continue;
        }
        const batch = await MedicineBatch.findById(line.batchId).session(session);
        if (!batch) throw returnError('Returned batch no longer exists', 'BATCH_NOT_FOUND', 409);
        const total = assertDispositionValid({
          approvedQuantity: line.approvedQuantity,
          batchExpired: batch.expiryDate <= now,
          disposition: received,
        });
        if (total === 0) continue;

        line.receivedQuantity = total;
        line.restockQuantity = received.restockQuantity;
        line.damagedQuantity = received.damagedQuantity;
        line.expiredQuantity = received.expiredQuantity;
        line.quarantinedQuantity = received.quarantinedQuantity;
        if (received.notes) line.notes = received.notes;
        receivedUnits += total;

        const movementKey = `return:${record._id}:${line.batchId}`;
        await applyReturnMovement(
          line.batchId as Types.ObjectId,
          {
            type: StockMovementType.RETURN_RECEIPT,
            quantity: total,
            reason: `Customer return ${record.reference}`,
            idempotencyKey: `${movementKey}:receipt`,
            referenceType: 'Return',
            referenceId: String(record._id),
          },
          actor,
          session,
        );
        for (const movement of dispositionMovements(received)) {
          await applyReturnMovement(
            line.batchId as Types.ObjectId,
            {
              type: dispositionMovementType[movement.disposition],
              quantity: movement.quantity,
              reason: `Return ${record.reference} inspected as ${movement.disposition.toLowerCase()}`,
              idempotencyKey: `${movementKey}:${movement.disposition.toLowerCase()}`,
              referenceType: 'Return',
              referenceId: String(record._id),
            },
            actor,
            session,
          );
        }
      }

      if (receivedUnits === 0) {
        throw returnError('Record at least one received unit', 'EMPTY_RECEIPT', 400);
      }

      // The credit follows what actually came back, not what was approved.
      const invoice = await Invoice.findById(record.invoiceId).session(session);
      if (!invoice) throw returnError('Invoice not found', 'NOT_FOUND', 404);
      const credit = computeReturnCredit({
        lines: record.lines.map((line) => ({
          invoicedQuantity: line.invoicedQuantity,
          unitPriceMinor: line.unitPriceMinor,
          lineDiscountMinor:
            invoice.items.find(
              (item) =>
                lineKey(item.medicineId, item.batchId) === lineKey(line.medicineId, line.batchId),
            )?.discountMinor ?? 0,
          quantity: line.receivedQuantity,
        })),
        invoiceSubtotalMinor: invoice.subtotalMinor,
        invoiceOrderDiscountMinor: invoice.orderDiscountMinor,
        invoiceDeliveryChargeMinor: invoice.deliveryChargeMinor,
        invoiceTaxMinor: invoice.taxMinor,
      });
      record.lines.forEach((line, index) => {
        line.discountMinor = credit.lines[index].discountMinor;
        line.refundMinor = credit.lines[index].refundMinor;
      });
      record.approvedSubtotalMinor = credit.subtotalMinor;
      record.approvedTaxMinor = credit.taxMinor;
      record.approvedTotalMinor = credit.totalMinor;
      record.receivedBy = actor._id;
      record.receivedAt = now;
      if (input.notes) record.internalNotes = input.notes;
      recordTransition(record, ReturnStatus.RECEIVED, actor, input.notes);
      await record.save({ session });
      await audit('RETURN_RECEIVED', record, actor, session, before);
      await announce({
        record,
        event: NotificationEvent.RETURN_RECEIVED,
        recipientIds: await userIdsWithRoles(MANAGEMENT_ROLES, session),
        context: { count: receivedUnits, amountMinor: credit.totalMinor },
        actor,
        category: NotificationCategory.INVENTORY,
        summary: `Return ${record.reference} received: ${receivedUnits} unit(s) inspected`,
        detail: input.notes,
        session,
      });
    });
    return { record: result!, idempotentReplay: replayed };
  } finally {
    await session.endSession();
  }
}

/**
 * Issues the credit note and posts it to the ledger. Money only moves here, by
 * an explicit finance decision, never automatically on warehouse receipt.
 */
export async function issueCreditNote(
  id: string,
  input: ActionInput & { notes?: string },
  actor: ReturnActor,
) {
  const business = await businessSettings();
  const session = await mongoose.startSession();
  try {
    let result: ReturnDocument | undefined;
    let note: InstanceType<typeof CreditNote> | undefined;
    let replayed = false;
    await session.withTransaction(async () => {
      const loaded = await loadForAction(id, input, actor, 'ISSUE_CREDIT_NOTE', session);
      result = loaded.record;
      replayed = loaded.replayed;
      if (loaded.replayed) {
        note =
          (await CreditNote.findOne({ returnId: loaded.record._id }).session(session)) ?? undefined;
        return;
      }
      const record = loaded.record;
      const before = record.toObject();
      if (record.approvedTotalMinor <= 0) {
        throw returnError('This return has no creditable value', 'NOTHING_TO_CREDIT', 400);
      }
      const invoice = await Invoice.findById(record.invoiceId).session(session);
      const shop = await Shop.findById(record.shopId).session(session);
      if (!invoice || !shop) throw returnError('Invoice or shop is missing', 'NOT_FOUND', 404);

      const previousCredits = await CreditNote.aggregate<{ total: number }>([
        { $match: { invoiceId: invoice._id } },
        { $group: { _id: null, total: { $sum: '$totalMinor' } } },
      ]).session(session);
      assertCreditWithinInvoice({
        invoiceGrandTotalMinor: invoice.grandTotalMinor,
        alreadyCreditedMinor: previousCredits[0]?.total ?? 0,
        proposedCreditMinor: record.approvedTotalMinor,
      });

      const reference = await nextReference('CRN');
      const issuedAt = new Date();
      const ledger = await postReturnCredit(
        {
          shopId: record.shopId as Types.ObjectId,
          invoiceId: invoice._id,
          returnId: record._id,
          creditNoteReference: reference,
          amountMinor: record.approvedTotalMinor,
          occurredAt: issuedAt,
        },
        actor,
        session,
      );

      const [creditNote] = await CreditNote.create(
        [
          {
            reference,
            returnId: record._id,
            returnReference: record.reference,
            invoiceId: invoice._id,
            invoiceReference: invoice.reference,
            orderId: record.orderId,
            shopId: record.shopId,
            supplierSnapshot: {
              name: business.name,
              address: business.address,
              phone: business.phone,
              email: business.email,
              tradeLicenceNumber: business.tradeLicenceNumber ?? '',
              drugLicenceNumber: business.drugLicenceNumber ?? '',
            },
            shopSnapshot: {
              reference: shop.reference,
              name: shop.name,
              phone: shop.primaryPhone,
            },
            lines: record.lines
              .filter((line) => line.receivedQuantity > 0)
              .map((line) => ({
                medicineSnapshot: line.medicineSnapshot,
                batchNumber: line.batchNumber,
                quantity: line.receivedQuantity,
                unitPriceMinor: line.unitPriceMinor,
                discountMinor: line.discountMinor,
                lineTotalMinor: line.refundMinor,
              })),
            subtotalMinor: record.approvedSubtotalMinor,
            taxMinor: record.approvedTaxMinor,
            totalMinor: record.approvedTotalMinor,
            ledgerTransactionId: ledger.transaction._id,
            notes: input.notes,
            issuedBy: actor._id,
            issuedAt,
          },
        ],
        { session },
      );
      note = creditNote;

      record.creditNoteId = creditNote._id;
      record.creditNoteReference = creditNote.reference;
      record.completedAt = issuedAt;
      recordTransition(record, ReturnStatus.COMPLETED, actor, input.notes);
      await record.save({ session });

      // Fully returned invoices close the order as RETURNED; anything less puts
      // it back where it was, because the customer still keeps part of it.
      const fullyReturned = record.lines.every(
        (line) => line.receivedQuantity >= line.invoicedQuantity,
      );
      if (fullyReturned) {
        const order = await Order.findById(record.orderId).session(session);
        if (order && order.status !== OrderStatus.RETURNED) {
          const from = order.status as OrderStatus;
          order.status = OrderStatus.RETURNED;
          order.version += 1;
          order.statusHistory.push({
            from,
            to: OrderStatus.RETURNED,
            actorId: actor._id,
            at: issuedAt,
            note: creditNote.reference,
          });
          await order.save({ session });
        }
      } else {
        await releaseOrderIfSettled(record, actor, session);
      }

      await audit('CREDIT_NOTE_ISSUED', record, actor, session, before);
      const owners = await ownersForShop(shop, session);
      await announce({
        record,
        event: NotificationEvent.CREDIT_NOTE_ISSUED,
        recipientIds: [...owners, record.requestedBy as Types.ObjectId],
        context: {
          reference: creditNote.reference,
          amountMinor: creditNote.totalMinor,
          creditNoteId: String(creditNote._id),
        },
        actor,
        category: NotificationCategory.FINANCE,
        summary: `Credit note ${creditNote.reference} issued for return ${record.reference}`,
        session,
      });
    });
    return { record: result!, creditNote: note, idempotentReplay: replayed };
  } finally {
    await session.endSession();
  }
}

export interface ReturnListQuery {
  page: number;
  limit: number;
  status?: ReturnStatus;
  shopId?: string;
  reason?: ReturnReason;
  q?: string;
  from?: Date;
  to?: Date;
}

export async function listReturns(actor: ReturnActor, query: ReturnListQuery) {
  const filter: Record<string, unknown> = {};
  if (actor.role === UserRole.SHOP_OWNER) {
    const shops = await Shop.find({ ownerIds: actor._id }).select('_id').lean();
    if (!shops.length)
      return { data: [], meta: { page: query.page, limit: query.limit, total: 0, pages: 0 } };
    filter.shopId = { $in: shops.map((shop) => shop._id) };
  } else if (query.shopId) {
    filter.shopId = new Types.ObjectId(query.shopId);
  }
  if (query.status) filter.status = query.status;
  if (query.reason) filter.primaryReason = query.reason;
  if (query.from || query.to) {
    filter.requestedAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }
  if (query.q) {
    // Escaped so a reference containing regex metacharacters stays a literal.
    filter.reference = { $regex: query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }
  const [data, total] = await Promise.all([
    Return.find(filter)
      .populate('shopId', 'reference name')
      .populate('invoiceId', 'reference grandTotalMinor')
      .populate('requestedBy', 'firstName lastName')
      .sort({ requestedAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Return.countDocuments(filter),
  ]);
  return {
    data,
    meta: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
  };
}

export async function getReturn(actor: ReturnActor, id: string) {
  const record = await Return.findById(id)
    .populate('shopId', 'reference name primaryPhone')
    .populate(
      'invoiceId',
      'reference grandTotalMinor invoiceDate subtotalMinor orderDiscountMinor deliveryChargeMinor taxMinor',
    )
    .populate('orderId', 'reference status')
    .populate('requestedBy', 'firstName lastName')
    .populate('reviewedBy', 'firstName lastName')
    .populate('receivedBy', 'firstName lastName')
    .lean();
  if (!record) throw returnError('Return not found', 'NOT_FOUND', 404);
  const shopId = (record.shopId as { _id?: Types.ObjectId })?._id ?? record.shopId;
  await assertShopAccess(shopId as Types.ObjectId, actor);
  const creditNote = record.creditNoteId
    ? await CreditNote.findById(record.creditNoteId).lean()
    : null;
  // Internal review notes never travel to the customer.
  if (actor.role === UserRole.SHOP_OWNER)
    delete (record as { internalNotes?: string }).internalNotes;
  return { ...record, creditNote };
}

export async function getCreditNote(actor: ReturnActor, id: string) {
  const note = await CreditNote.findById(id)
    .populate('shopId', 'reference name primaryPhone')
    .populate('issuedBy', 'firstName lastName')
    .lean();
  if (!note) throw returnError('Credit note not found', 'NOT_FOUND', 404);
  const shopId = (note.shopId as { _id?: Types.ObjectId })?._id ?? note.shopId;
  await assertShopAccess(shopId as Types.ObjectId, actor);
  return note;
}
