import { createHash } from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import {
  ActivityEntityType,
  CollectionHandoverStatus,
  LedgerAccount,
  LedgerTransactionType,
  NotificationCategory,
  NotificationEvent,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
  RealtimeEvent,
  UserRole,
} from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { nextReference } from '../models/Counter';
import { Delivery } from '../models/Delivery';
import { Invoice } from '../models/Invoice';
import { LedgerTransaction } from '../models/LedgerTransaction';
import { Payment } from '../models/Payment';
import { Shop } from '../models/Shop';
import { allocatePayment, FinancialEntry, reverseEntries } from './financialMath';
import {
  appendLedgerTransaction,
  FinanceActor,
  getAvailableAdvance,
  getInvoiceBalance,
  getLedgerBalance,
  postInvoiceCharge,
} from './ledgerService';
import { PaymentAttachmentInput, paymentAttachmentStorage } from './paymentAttachmentService';
import { notify } from './notificationService';
import type { TemplateContext } from './notificationCatalogue';
import { ActivityVisibility, recordActivity } from './activityService';
import { emitEntityUpdate } from './realtime';
import { MANAGEMENT_ROLES, userIdsWithRoles } from './notificationAudience';
import { businessSettings, financeSettings } from './settingsService';
import { currencySnapshot } from './localisation';

type RecordPaymentInput = {
  shopId: string;
  invoiceId?: string;
  deliveryId?: string;
  amountMinor: number;
  method: PaymentMethod;
  transactionReference?: string;
  collectedAt: Date;
  notes?: string;
  attachment?: PaymentAttachmentInput;
  allowAdvance: boolean;
  postNow: boolean;
  idempotencyKey: string;
};

function paymentError(message: string, code: string, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode, code });
}

function requestFingerprint(input: RecordPaymentInput) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        shopId: input.shopId,
        invoiceId: input.invoiceId ?? null,
        deliveryId: input.deliveryId ?? null,
        amountMinor: input.amountMinor,
        method: input.method,
        transactionReference: input.transactionReference ?? null,
        notes: input.notes ?? null,
        allowAdvance: input.allowAdvance,
        postNow: input.postNow,
        attachment: input.attachment
          ? createHash('sha256').update(input.attachment.base64Data).digest('hex')
          : null,
      }),
    )
    .digest('hex');
}

function assertSameIdempotentRequest(
  payment: InstanceType<typeof Payment>,
  input: RecordPaymentInput,
) {
  if (payment.requestFingerprint && payment.requestFingerprint !== requestFingerprint(input)) {
    throw paymentError(
      'This idempotency key was already used for a different payment request',
      'IDEMPOTENCY_CONFLICT',
    );
  }
}

function clearingAccount(method: PaymentMethod) {
  return method === PaymentMethod.CASH
    ? LedgerAccount.CASH_UNDEPOSITED
    : LedgerAccount.BANK_CLEARING;
}

/**
 * Announces a payment outcome to the shop and records the timeline entry.
 * Managers see it on the shop timeline; shop owners see it on their account.
 */
async function announcePayment(
  payment: {
    _id: Types.ObjectId;
    shopId: Types.ObjectId;
    reference: string;
    amountMinor: number;
    invoiceId?: Types.ObjectId;
  },
  event: NotificationEvent,
  context: TemplateContext,
  summary: string,
  session: ClientSession,
  actor?: { _id: Types.ObjectId; role: UserRole },
) {
  const shop = await Shop.findById(payment.shopId).select('ownerIds').session(session);
  await notify({
    event,
    recipientIds: shop?.ownerIds ?? [],
    context: {
      reference: payment.reference,
      amountMinor: payment.amountMinor,
      paymentId: String(payment._id),
      shopId: String(payment.shopId),
      ...context,
    },
    entityType: 'Payment',
    entityId: payment._id,
    occurrenceKey: `${event}:${payment.reference}`,
    session,
  });
  await recordActivity({
    action: event,
    category: NotificationCategory.FINANCE,
    entityType: ActivityEntityType.PAYMENT,
    entityId: payment._id,
    shopId: payment.shopId,
    actor: actor ? { _id: actor._id, role: actor.role } : null,
    summary,
    metadata: { amountMinor: payment.amountMinor, reference: payment.reference },
    visibleToRoles: ActivityVisibility.management,
    visibleToShop: true,
    occurrenceKey: `${event}:${payment.reference}`,
    session,
  });
  emitEntityUpdate({
    event: RealtimeEvent.PAYMENT_UPDATED,
    entityType: ActivityEntityType.PAYMENT,
    entityId: payment._id,
    reference: payment.reference,
    shopId: payment.shopId,
    roles: MANAGEMENT_ROLES,
    notifyShop: true,
  });
}

async function validatePaymentRelations(input: RecordPaymentInput, session: ClientSession) {
  const shop = await Shop.findById(input.shopId).session(session);
  if (!shop) throw paymentError('Shop not found', 'NOT_FOUND', 404);
  let invoice;
  if (input.invoiceId) {
    invoice = await Invoice.findById(input.invoiceId).session(session);
    if (!invoice) throw paymentError('Invoice not found', 'NOT_FOUND', 404);
    if (String(invoice.shopId) !== input.shopId)
      throw paymentError('Invoice does not belong to the selected shop', 'INVOICE_SHOP', 400);
  }
  if (input.deliveryId) {
    const delivery = await Delivery.findById(input.deliveryId).session(session);
    if (!delivery) throw paymentError('Delivery not found', 'NOT_FOUND', 404);
    if (
      String(delivery.shopId) !== input.shopId ||
      (input.invoiceId && String(delivery.invoiceId) !== input.invoiceId)
    )
      throw paymentError('Delivery does not match the payment account', 'DELIVERY_PAYMENT', 400);
  }
  return { shop, invoice };
}

async function createPendingPayment(
  input: RecordPaymentInput,
  actor: FinanceActor,
  source: PaymentSource,
  collectedBy: Types.ObjectId,
  session: ClientSession,
) {
  await validatePaymentRelations(input, session);
  const [payment] = await Payment.create(
    [
      {
        reference: await nextReference('PAY'),
        // What this receipt is denominated in, recorded on it.
        currencySnapshot: currencySnapshot(),
        shopId: new Types.ObjectId(input.shopId),
        invoiceId: input.invoiceId ? new Types.ObjectId(input.invoiceId) : undefined,
        deliveryId: input.deliveryId ? new Types.ObjectId(input.deliveryId) : undefined,
        amountMinor: input.amountMinor,
        method: input.method,
        transactionReference: input.transactionReference,
        source,
        collectedBy,
        receivedBy: source === PaymentSource.MANUAL ? actor._id : undefined,
        collectedAt: input.collectedAt,
        status: PaymentStatus.PENDING,
        notes: input.notes,
        allowAdvance: input.allowAdvance,
        handoverStatus:
          source === PaymentSource.DELIVERY_COLLECTION && input.method === PaymentMethod.CASH
            ? CollectionHandoverStatus.PENDING
            : CollectionHandoverStatus.NOT_REQUIRED,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: requestFingerprint(input),
      },
    ],
    { session },
  );
  if (input.attachment) {
    const attachment = await paymentAttachmentStorage.save(
      payment._id,
      input.attachment,
      actor._id,
      session,
    );
    payment.attachmentId = attachment._id;
    await payment.save({ session });
  }
  await AuditLog.create(
    [
      {
        actorId: actor._id,
        actorRole: actor.role,
        action: 'PAYMENT_RECORDED',
        entityType: 'Payment',
        entityId: payment._id,
        after: {
          reference: payment.reference,
          shopId: payment.shopId,
          invoiceId: payment.invoiceId,
          deliveryId: payment.deliveryId,
          amountMinor: payment.amountMinor,
          method: payment.method,
          status: payment.status,
        },
      },
    ],
    { session },
  );
  return payment;
}

export async function postPaymentInSession(
  payment: InstanceType<typeof Payment>,
  actor: FinanceActor,
  session: ClientSession,
  allowAdvance = false,
  postingIdempotencyKey?: string,
) {
  if (payment.status === PaymentStatus.POSTED) return { payment, idempotentReplay: true };
  if (payment.status !== PaymentStatus.PENDING)
    throw paymentError('Only a pending payment can be posted', 'PAYMENT_STATE');

  let invoiceDueMinor: number | undefined;
  if (payment.invoiceId) {
    const balance = await getInvoiceBalance(payment.invoiceId as Types.ObjectId, session);
    await postInvoiceCharge(balance.invoice, actor, session);
    const refreshed = await getInvoiceBalance(payment.invoiceId as Types.ObjectId, session);
    invoiceDueMinor = refreshed.currentAmountDueMinor;
  }
  const availableAdvanceMinor = await getAvailableAdvance(
    payment.shopId as Types.ObjectId,
    session,
  );
  const allocation = allocatePayment({
    amountMinor: payment.amountMinor,
    method: payment.method as PaymentMethod,
    invoiceDueMinor,
    availableAdvanceMinor,
    allowAdvance:
      (await financeSettings()).customerAdvanceEnabled &&
      (allowAdvance || Boolean(payment.allowAdvance)),
  });

  let entries: FinancialEntry[];
  if (payment.method === PaymentMethod.ADVANCE_BALANCE) {
    entries = [
      {
        account: LedgerAccount.CUSTOMER_ADVANCE,
        debitMinor: payment.amountMinor,
        creditMinor: 0,
      },
      {
        account: LedgerAccount.ACCOUNTS_RECEIVABLE,
        debitMinor: 0,
        creditMinor: payment.amountMinor,
      },
    ];
  } else {
    entries = [
      {
        account: clearingAccount(payment.method as PaymentMethod),
        debitMinor: payment.amountMinor,
        creditMinor: 0,
      },
    ];
    if (allocation.invoiceAppliedMinor > 0) {
      entries.push({
        account: LedgerAccount.ACCOUNTS_RECEIVABLE,
        debitMinor: 0,
        creditMinor: allocation.invoiceAppliedMinor,
      });
    }
    if (allocation.advanceCreatedMinor > 0) {
      entries.push({
        account: LedgerAccount.CUSTOMER_ADVANCE,
        debitMinor: 0,
        creditMinor: allocation.advanceCreatedMinor,
      });
    }
  }
  const ledger = await appendLedgerTransaction(
    {
      shopId: payment.shopId as Types.ObjectId,
      invoiceId: payment.invoiceId as Types.ObjectId | undefined,
      paymentId: payment._id,
      deliveryId: payment.deliveryId as Types.ObjectId | undefined,
      type: LedgerTransactionType.PAYMENT,
      occurredAt: new Date(),
      description: `Payment ${payment.reference}`,
      entries,
      customerBalanceDeltaMinor: allocation.customerBalanceDeltaMinor,
      sourceKey: `payment:${payment._id}`,
      createdBy: actor._id,
    },
    session,
  );
  if (ledger.idempotentReplay) return { payment, idempotentReplay: true };

  payment.$locals.financialTransition = true;
  payment.status = PaymentStatus.POSTED;
  payment.invoiceAppliedMinor = allocation.invoiceAppliedMinor;
  payment.advanceCreatedMinor = allocation.advanceCreatedMinor;
  payment.postedAt = new Date();
  payment.postedBy = actor._id;
  payment.receivedBy = actor._id;
  payment.receiptReference = await nextReference('RCT');
  payment.postingIdempotencyKey = postingIdempotencyKey;
  payment.version += 1;
  await payment.save({ session });
  if (payment.deliveryId) {
    await Delivery.updateOne(
      { _id: payment.deliveryId },
      {
        $set: {
          'paymentCollection.status': 'POSTED',
          'paymentCollection.paymentId': payment._id,
          'paymentCollection.paymentReference': payment.reference,
        },
      },
      { session },
    );
  }
  await AuditLog.create(
    [
      {
        actorId: actor._id,
        actorRole: actor.role,
        action: 'PAYMENT_POSTED',
        entityType: 'Payment',
        entityId: payment._id,
        before: { status: PaymentStatus.PENDING },
        after: {
          status: payment.status,
          receiptReference: payment.receiptReference,
          invoiceAppliedMinor: payment.invoiceAppliedMinor,
          advanceCreatedMinor: payment.advanceCreatedMinor,
          ledgerReference: ledger.transaction.reference,
        },
      },
    ],
    { session },
  );
  await announcePayment(
    payment as never,
    NotificationEvent.PAYMENT_POSTED,
    {},
    `Payment ${payment.reference} posted; receipt ${payment.receiptReference} issued`,
    session,
    actor,
  );
  return { payment, idempotentReplay: false };
}

export async function recordPayment(input: RecordPaymentInput, actor: FinanceActor) {
  const replay = await Payment.findOne({ idempotencyKey: input.idempotencyKey });
  if (replay) {
    assertSameIdempotentRequest(replay, input);
    return { payment: replay, idempotentReplay: true };
  }
  const session = await mongoose.startSession();
  try {
    let result: InstanceType<typeof Payment> | undefined;
    await session.withTransaction(async () => {
      const duplicate = await Payment.findOne({ idempotencyKey: input.idempotencyKey }).session(
        session,
      );
      if (duplicate) {
        assertSameIdempotentRequest(duplicate, input);
        result = duplicate;
        return;
      }
      const payment = await createPendingPayment(
        input,
        actor,
        PaymentSource.MANUAL,
        actor._id,
        session,
      );
      if (input.postNow) {
        result = (await postPaymentInSession(payment, actor, session, input.allowAdvance)).payment;
      } else {
        // Posting announces itself; an unposted payment still needs acknowledging.
        await announcePayment(
          payment as never,
          NotificationEvent.PAYMENT_RECORDED,
          {},
          `Payment ${payment.reference} recorded and awaiting verification`,
          session,
          actor,
        );
        result = payment;
      }
    });
    return { payment: result!, idempotentReplay: false };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await Payment.findOne({ idempotencyKey: input.idempotencyKey });
      if (duplicate) {
        assertSameIdempotentRequest(duplicate, input);
        return { payment: duplicate, idempotentReplay: true };
      }
      throw paymentError(
        'A payment with this delivery or transaction reference already exists',
        'DUPLICATE_PAYMENT',
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function createDeliveryCollectionPayment(
  input: {
    deliveryId: Types.ObjectId;
    shopId: Types.ObjectId;
    invoiceId: Types.ObjectId;
    amountMinor: number;
    method: Exclude<PaymentMethod, 'CREDIT' | 'ADVANCE_BALANCE'>;
    transactionReference?: string;
    collectedAt: Date;
    notes?: string;
    paymentProof?: PaymentAttachmentInput;
    idempotencyKey: string;
  },
  actor: FinanceActor,
  session: ClientSession,
) {
  const existing = await Payment.findOne({ deliveryId: input.deliveryId }).session(session);
  if (existing) return { payment: existing, idempotentReplay: true };
  const payment = await createPendingPayment(
    {
      shopId: String(input.shopId),
      invoiceId: String(input.invoiceId),
      deliveryId: String(input.deliveryId),
      amountMinor: input.amountMinor,
      method: input.method,
      transactionReference: input.transactionReference,
      collectedAt: input.collectedAt,
      notes: input.notes,
      attachment: input.paymentProof,
      allowAdvance: false,
      postNow: false,
      idempotencyKey: input.idempotencyKey,
    },
    actor,
    PaymentSource.DELIVERY_COLLECTION,
    actor._id,
    session,
  );
  const verificationRequired = (await financeSettings()).deliveryCollectionRequiresVerification;
  if (!verificationRequired) {
    await postPaymentInSession(payment, actor, session, false, `auto:${input.idempotencyKey}`);
  } else {
    // The collection sits in the review queue until a manager verifies it.
    await notify({
      event: NotificationEvent.PAYMENT_RECORDED,
      recipientIds: await userIdsWithRoles(MANAGEMENT_ROLES, session),
      context: {
        reference: payment.reference,
        amountMinor: payment.amountMinor,
        paymentId: String(payment._id),
      },
      entityType: 'Payment',
      entityId: payment._id,
      occurrenceKey: `COLLECTION:${payment.reference}`,
      session,
    });
  }
  return { payment, idempotentReplay: false };
}

export async function postPayment(
  id: string,
  input: { idempotencyKey: string; allowAdvance: boolean },
  actor: FinanceActor,
) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const payment = await Payment.findById(id).session(session);
      if (!payment) throw paymentError('Payment not found', 'NOT_FOUND', 404);
      result = await postPaymentInSession(
        payment,
        actor,
        session,
        input.allowAdvance,
        input.idempotencyKey,
      );
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

export async function failPayment(
  id: string,
  input: { idempotencyKey: string; reason: string },
  actor: FinanceActor,
) {
  const session = await mongoose.startSession();
  try {
    let result: InstanceType<typeof Payment> | undefined;
    let replay = false;
    await session.withTransaction(async () => {
      const payment = await Payment.findById(id).session(session);
      if (!payment) throw paymentError('Payment not found', 'NOT_FOUND', 404);
      if (payment.status === PaymentStatus.FAILED) {
        result = payment;
        replay = true;
        return;
      }
      if (payment.status !== PaymentStatus.PENDING)
        throw paymentError('Only a pending payment can be marked failed', 'PAYMENT_STATE');
      payment.$locals.financialTransition = true;
      payment.status = PaymentStatus.FAILED;
      payment.failureReason = input.reason;
      payment.failedAt = new Date();
      payment.failedBy = actor._id;
      payment.failureIdempotencyKey = input.idempotencyKey;
      payment.version += 1;
      await payment.save({ session });
      if (payment.deliveryId) {
        await Delivery.updateOne(
          { _id: payment.deliveryId },
          { $set: { 'paymentCollection.status': 'FAILED' } },
          { session },
        );
      }
      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'PAYMENT_FAILED',
            entityType: 'Payment',
            entityId: payment._id,
            before: { status: PaymentStatus.PENDING },
            after: { status: payment.status, reason: input.reason },
          },
        ],
        { session },
      );
      await announcePayment(
        payment as never,
        NotificationEvent.PAYMENT_FAILED,
        { reason: input.reason },
        `Payment ${payment.reference} marked failed`,
        session,
        actor,
      );
      result = payment;
    });
    return { payment: result!, idempotentReplay: replay };
  } finally {
    await session.endSession();
  }
}

export async function reversePayment(
  id: string,
  input: { idempotencyKey: string; reason: string },
  actor: FinanceActor,
) {
  const session = await mongoose.startSession();
  try {
    let result: InstanceType<typeof Payment> | undefined;
    let replay = false;
    await session.withTransaction(async () => {
      const payment = await Payment.findById(id).session(session);
      if (!payment) throw paymentError('Payment not found', 'NOT_FOUND', 404);
      if (payment.status === PaymentStatus.REVERSED) {
        result = payment;
        replay = true;
        return;
      }
      if (payment.status !== PaymentStatus.POSTED)
        throw paymentError('Only a posted payment can be reversed', 'PAYMENT_STATE');
      if (payment.advanceCreatedMinor > 0) {
        const availableAdvance = await getAvailableAdvance(
          payment.shopId as Types.ObjectId,
          session,
        );
        if (availableAdvance < payment.advanceCreatedMinor) {
          throw paymentError(
            'This payment created advance balance that has already been consumed',
            'ADVANCE_ALREADY_USED',
          );
        }
      }
      const original = await LedgerTransaction.findOne({
        paymentId: payment._id,
        type: LedgerTransactionType.PAYMENT,
      }).session(session);
      if (!original)
        throw paymentError('The original payment journal is missing', 'LEDGER_MISSING', 500);
      const reversedEntries = reverseEntries(
        original.entries.map((entry) => ({
          account: entry.account as LedgerAccount,
          debitMinor: entry.debitMinor,
          creditMinor: entry.creditMinor,
        })),
      );
      const ledger = await appendLedgerTransaction(
        {
          shopId: payment.shopId as Types.ObjectId,
          invoiceId: payment.invoiceId as Types.ObjectId | undefined,
          paymentId: payment._id,
          deliveryId: payment.deliveryId as Types.ObjectId | undefined,
          type: LedgerTransactionType.PAYMENT_REVERSAL,
          occurredAt: new Date(),
          description: `Reversal of ${payment.reference}: ${input.reason}`,
          entries: reversedEntries,
          customerBalanceDeltaMinor: -original.customerBalanceDeltaMinor,
          sourceKey: `payment-reversal:${payment._id}`,
          reversalOf: original._id,
          createdBy: actor._id,
        },
        session,
      );
      payment.$locals.financialTransition = true;
      payment.status = PaymentStatus.REVERSED;
      payment.reversalReference = ledger.transaction.reference;
      payment.reversalReason = input.reason;
      payment.reversedAt = new Date();
      payment.reversedBy = actor._id;
      payment.reversalIdempotencyKey = input.idempotencyKey;
      payment.version += 1;
      await payment.save({ session });
      if (payment.deliveryId) {
        await Delivery.updateOne(
          { _id: payment.deliveryId },
          { $set: { 'paymentCollection.status': 'REVERSED' } },
          { session },
        );
      }
      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'PAYMENT_REVERSED',
            entityType: 'Payment',
            entityId: payment._id,
            before: { status: PaymentStatus.POSTED },
            after: {
              status: payment.status,
              reason: input.reason,
              reversalReference: payment.reversalReference,
            },
          },
        ],
        { session },
      );
      await announcePayment(
        payment as never,
        NotificationEvent.PAYMENT_REVERSED,
        { reason: input.reason },
        `Payment ${payment.reference} reversed`,
        session,
        actor,
      );
      result = payment;
    });
    return { payment: result!, idempotentReplay: replay };
  } finally {
    await session.endSession();
  }
}

export async function handoverCollection(
  id: string,
  input: { idempotencyKey: string },
  actor: FinanceActor,
) {
  const session = await mongoose.startSession();
  try {
    let result: InstanceType<typeof Payment> | undefined;
    let replay = false;
    await session.withTransaction(async () => {
      const payment = await Payment.findById(id).session(session);
      if (!payment) throw paymentError('Payment not found', 'NOT_FOUND', 404);
      if (
        actor.role !== UserRole.DELIVERY_PERSON ||
        String(payment.collectedBy) !== String(actor._id)
      )
        throw paymentError('Only the collector can hand over this payment', 'FORBIDDEN', 403);
      if (payment.method !== PaymentMethod.CASH)
        throw paymentError('Only cash collections require handover', 'HANDOVER_NOT_REQUIRED', 400);
      if (payment.handoverStatus === CollectionHandoverStatus.HANDED_OVER) {
        result = payment;
        replay = true;
        return;
      }
      if (payment.status === PaymentStatus.FAILED || payment.status === PaymentStatus.REVERSED)
        throw paymentError('This collection cannot be handed over', 'PAYMENT_STATE');
      payment.$locals.financialTransition = true;
      payment.handoverStatus = CollectionHandoverStatus.HANDED_OVER;
      payment.handedOverAt = new Date();
      payment.handedOverBy = actor._id;
      payment.handoverIdempotencyKey = input.idempotencyKey;
      payment.version += 1;
      await payment.save({ session });
      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'PAYMENT_COLLECTION_HANDED_OVER',
            entityType: 'Payment',
            entityId: payment._id,
            after: { handoverStatus: payment.handoverStatus, amountMinor: payment.amountMinor },
          },
        ],
        { session },
      );
      result = payment;
    });
    return { payment: result!, idempotentReplay: replay };
  } finally {
    await session.endSession();
  }
}

export async function getReceiptData(id: string) {
  const payment = await Payment.findById(id)
    .populate('shopId', 'reference name primaryPhone')
    .populate('invoiceId', 'reference grandTotalMinor')
    .populate('deliveryId', 'reference')
    .populate('collectedBy', 'firstName lastName')
    .populate('receivedBy', 'firstName lastName')
    .lean();
  if (!payment) throw paymentError('Payment not found', 'NOT_FOUND', 404);
  if (payment.status !== PaymentStatus.POSTED && payment.status !== PaymentStatus.REVERSED)
    throw paymentError('A receipt is available only after posting', 'RECEIPT_UNAVAILABLE', 409);
  const shop = payment.shopId as unknown as { reference?: string; name?: string };
  const invoice = payment.invoiceId as unknown as { reference?: string } | undefined;
  return {
    receiptReference: payment.receiptReference,
    paymentReference: payment.reference,
    status: payment.status,
    amountMinor: payment.amountMinor,
    method: payment.method,
    transactionReference: payment.transactionReference,
    collectedAt: payment.collectedAt,
    postedAt: payment.postedAt,
    shop: payment.shopId,
    shopName: shop?.name,
    shopReference: shop?.reference,
    invoice: payment.invoiceId,
    invoiceReference: invoice?.reference,
    delivery: payment.deliveryId,
    collectedBy: payment.collectedBy,
    receivedBy: payment.receivedBy,
    reversalReference: payment.reversalReference,
  };
}

export async function paymentLedgerBalance(shopId: string) {
  return getLedgerBalance(shopId);
}
