import { createHash } from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import { LedgerAccount, PaymentSource, PaymentStatus, ShopStatus } from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { Delivery } from '../models/Delivery';
import { CreditReservation, CreditReservationSource } from '../models/CreditReservation';
import { Invoice } from '../models/Invoice';
import { LedgerTransaction } from '../models/LedgerTransaction';
import { Payment } from '../models/Payment';
import { Shop } from '../models/Shop';
import { Order } from '../models/Order';
import { OrderApproval } from '../models/OrderApproval';
import {
  dhakaDateString,
  dhakaDayBoundary,
  FinanceActor,
  getAvailableAdvance,
  getInvoiceBalance,
  getLedgerBalance,
  postInvoiceCharge,
} from './ledgerService';
import { utilisationBasisPoints } from './financialMath';
import { getActiveReservedExposure, reserveCredit } from './creditReservationService';
import { financeSettings } from './settingsService';

function financeError(message: string, code: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

export async function invoiceBalanceRows(
  shopId: string,
  options: { page?: number; limit?: number } = {},
) {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const filter = { shopId: new Types.ObjectId(shopId), status: 'ISSUED' as const };
  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .sort({ invoiceDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Invoice.countDocuments(filter),
  ]);
  const data = await Promise.all(
    invoices.map(async (invoice) => {
      const live = await getInvoiceBalance(invoice._id);
      return {
        ...invoice,
        currentAmountPaidMinor: live.currentAmountPaidMinor,
        currentAmountDueMinor: live.currentAmountDueMinor,
        paidMinor: live.currentAmountPaidMinor,
        dueMinor: live.currentAmountDueMinor,
        amountPaidMinor: live.currentAmountPaidMinor,
        amountDueMinor: live.currentAmountDueMinor,
        settlementStatus: live.settlementStatus,
      };
    }),
  );
  return { data, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function overdueForShop(shopId: Types.ObjectId, asOf: Date, session?: ClientSession) {
  const graceDays = Math.max(0, (await financeSettings()).creditOverdueGraceDays);
  const cutoff = new Date(asOf.getTime() - graceDays * 86_400_000);
  const invoiceQuery = Invoice.find({
    shopId,
    status: 'ISSUED',
    dueDate: { $lt: cutoff },
  })
    .select('_id dueDate')
    .sort({ dueDate: 1 })
    .lean();
  if (session) invoiceQuery.session(session);
  const invoices = await invoiceQuery;
  let overdueMinor = 0;
  let oldestDueDate: Date | undefined;
  for (const invoice of invoices) {
    const live = await getInvoiceBalance(invoice._id, session);
    if (live.currentAmountDueMinor > 0) {
      overdueMinor += live.currentAmountDueMinor;
      oldestDueDate ??= invoice.dueDate;
    }
  }
  if (!Number.isSafeInteger(overdueMinor))
    throw financeError('Overdue balance exceeds the safe integer range', 'MONEY_OVERFLOW', 500);
  return { overdueMinor, oldestDueDate };
}

export async function getCreditSummary(
  shopId: string,
  options: {
    proposedExposureMinor?: number;
    asOf?: Date;
    reservedExposureMinor?: number;
    session?: ClientSession;
  } = {},
) {
  const shopQuery = Shop.findById(shopId).lean();
  if (options.session) shopQuery.session(options.session);
  const shop = await shopQuery;
  if (!shop) throw financeError('Shop not found', 'NOT_FOUND', 404);
  const asOf = options.asOf ?? new Date();
  let ledgerBalanceMinor: number;
  let advanceBalanceMinor: number;
  let overdue: Awaited<ReturnType<typeof overdueForShop>>;
  if (options.session) {
    // A MongoDB transaction session must not execute operations in parallel.
    ledgerBalanceMinor = await getLedgerBalance(shopId, options.session);
    advanceBalanceMinor = await getAvailableAdvance(shopId, options.session);
    overdue = await overdueForShop(shop._id, asOf, options.session);
  } else {
    [ledgerBalanceMinor, advanceBalanceMinor, overdue] = await Promise.all([
      getLedgerBalance(shopId),
      getAvailableAdvance(shopId),
      overdueForShop(shop._id, asOf),
    ]);
  }
  const outstandingMinor = Math.max(0, ledgerBalanceMinor);
  const proposed = options.proposedExposureMinor ?? 0;
  const reserved = options.reservedExposureMinor ?? shop.reservedCreditMinor ?? 0;
  if (![proposed, reserved].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw financeError('Credit exposure must be a safe non-negative integer', 'INVALID_MONEY');
  const projected = outstandingMinor + proposed + reserved;
  if (!Number.isSafeInteger(projected))
    throw financeError(
      'Projected credit exposure exceeds the safe integer range',
      'MONEY_OVERFLOW',
    );
  const finance = await financeSettings();
  const limitBlocking = finance.creditBlockOnLimitExceeded;
  const overdueThreshold = Math.max(0, finance.creditBlockOverdueThresholdMinor);
  const overdueBlocking = overdueThreshold >= 0 && overdue.overdueMinor > overdueThreshold;
  const limitExceeded = projected > shop.creditLimit;
  const manuallyBlocked = shop.status === ShopStatus.CREDIT_BLOCKED;
  const blockReasons: string[] = [];
  if (manuallyBlocked)
    blockReasons.push(shop.orderBlockingReason || 'Account is manually credit blocked');
  if (limitBlocking && limitExceeded)
    blockReasons.push('Projected exposure exceeds the credit limit');
  if (overdueBlocking) blockReasons.push('Overdue balance exceeds the configured threshold');
  const availableCreditMinor = Math.max(0, shop.creditLimit - outstandingMinor - reserved);
  return {
    shop: {
      _id: String(shop._id),
      reference: shop.reference,
      name: shop.name,
      status: shop.status,
    },
    shopId: String(shop._id),
    creditLimitMinor: shop.creditLimit,
    ledgerBalanceMinor,
    outstandingMinor,
    outstandingBalanceMinor: outstandingMinor,
    overdueMinor: overdue.overdueMinor,
    overdueBalanceMinor: overdue.overdueMinor,
    advanceBalanceMinor,
    availableCreditMinor,
    utilisationBasisPoints: utilisationBasisPoints(outstandingMinor + reserved, shop.creditLimit),
    creditUtilisationBps: utilisationBasisPoints(outstandingMinor + reserved, shop.creditLimit),
    creditUtilisationBasisPoints: utilisationBasisPoints(
      outstandingMinor + reserved,
      shop.creditLimit,
    ),
    paymentTermsDays: shop.paymentTermsDays,
    reservedExposureMinor: reserved,
    proposedExposureMinor: proposed,
    projectedExposureMinor: projected,
    manuallyBlocked,
    limitExceeded,
    overdueBlocked: overdueBlocking,
    orderBlocked: blockReasons.length > 0,
    creditBlocked: blockReasons.length > 0,
    blockReason: blockReasons.join('; ') || undefined,
    blockReasons,
    oldestDueDate: overdue.oldestDueDate,
    asOf: asOf.toISOString(),
  };
}

export async function getStatement(shopId: string, fromValue: string, toValue: string) {
  const from = dhakaDayBoundary(fromValue);
  const to = dhakaDayBoundary(toValue, true);
  if (from > to)
    throw financeError('Statement start date must not be after end date', 'DATE_RANGE');
  const shop = await Shop.findById(shopId).select('reference name').lean();
  if (!shop) throw financeError('Shop not found', 'NOT_FOUND', 404);
  const [openingResult, transactions] = await Promise.all([
    LedgerTransaction.aggregate<{ balance: number }>([
      { $match: { shopId: shop._id, occurredAt: { $lt: from } } },
      { $group: { _id: null, balance: { $sum: '$customerBalanceDeltaMinor' } } },
    ]),
    LedgerTransaction.find({ shopId: shop._id, occurredAt: { $gte: from, $lte: to } })
      .sort({ occurredAt: 1, _id: 1 })
      .lean(),
  ]);
  const openingBalanceMinor = openingResult[0]?.balance ?? 0;
  let running = openingBalanceMinor;
  const rows = transactions.map((transaction) => {
    running += transaction.customerBalanceDeltaMinor;
    let debitMinor = Math.max(0, transaction.customerBalanceDeltaMinor);
    let creditMinor = Math.max(0, -transaction.customerBalanceDeltaMinor);
    if (transaction.customerBalanceDeltaMinor === 0) {
      const advanceDebit = transaction.entries
        .filter((entry) => entry.account === LedgerAccount.CUSTOMER_ADVANCE)
        .reduce((sum, entry) => sum + entry.debitMinor, 0);
      const receivableCredit = transaction.entries
        .filter((entry) => entry.account === LedgerAccount.ACCOUNTS_RECEIVABLE)
        .reduce((sum, entry) => sum + entry.creditMinor, 0);
      debitMinor = advanceDebit;
      creditMinor = receivableCredit;
    }
    return {
      _id: String(transaction._id),
      reference: transaction.reference,
      date: transaction.occurredAt,
      postingTime: transaction.occurredAt,
      createdAt: transaction.createdAt,
      type: transaction.type,
      description: transaction.description,
      debitMinor,
      creditMinor,
      balanceMinor: running,
      balanceAfterMinor: running,
      invoiceId: transaction.invoiceId,
      paymentId: transaction.paymentId,
    };
  });
  return {
    shop: { _id: String(shop._id), reference: shop.reference, name: shop.name },
    from: fromValue,
    to: toValue,
    openingBalanceMinor,
    rows,
    entries: rows,
    closingBalanceMinor: running,
  };
}

export async function getLedger(shopId: string, pageValue = 1, limitValue = 50) {
  const page = Math.max(1, pageValue);
  const limit = Math.min(100, Math.max(1, limitValue));
  const filter = { shopId: new Types.ObjectId(shopId) };
  const [transactions, total, summary] = await Promise.all([
    LedgerTransaction.find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LedgerTransaction.countDocuments(filter),
    getCreditSummary(shopId),
  ]);
  const data = transactions.map((transaction) => {
    let debitMinor = Math.max(0, transaction.customerBalanceDeltaMinor);
    let creditMinor = Math.max(0, -transaction.customerBalanceDeltaMinor);
    if (transaction.customerBalanceDeltaMinor === 0) {
      debitMinor = transaction.entries
        .filter((entry) => entry.account === LedgerAccount.CUSTOMER_ADVANCE)
        .reduce((sum, entry) => sum + entry.debitMinor, 0);
      creditMinor = transaction.entries
        .filter((entry) => entry.account === LedgerAccount.ACCOUNTS_RECEIVABLE)
        .reduce((sum, entry) => sum + entry.creditMinor, 0);
    }
    return {
      ...transaction,
      debitMinor,
      creditMinor,
      postingTime: transaction.occurredAt,
    };
  });
  return { data, summary, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getOutstandingReport(asOf = new Date()) {
  const shops = await Shop.find({ status: { $ne: ShopStatus.INACTIVE } })
    .select('_id')
    .lean();
  const summaries = await Promise.all(
    shops.map((shop) => getCreditSummary(String(shop._id), { asOf })),
  );
  const rows = summaries.filter((summary) => summary.outstandingMinor > 0);
  const data = await Promise.all(
    rows.map(async (summary) => ({
      ...summary,
      shopReference: summary.shop.reference,
      shopName: summary.shop.name,
      invoiceCount: await Invoice.countDocuments({
        shopId: summary.shopId,
        status: 'ISSUED',
      }),
    })),
  );
  return {
    data,
    summary: {
      shopCount: data.length,
      totalOutstandingMinor: data.reduce((sum, row) => sum + row.outstandingMinor, 0),
    },
  };
}

export async function getOverdueReport(asOf = new Date()) {
  const report = await getOutstandingReport(asOf);
  const today = dhakaDayBoundary(dhakaDateString(asOf));
  const data = report.data
    .filter((row) => row.overdueMinor > 0)
    .map((row) => ({
      ...row,
      shopId: row.shopId,
      reference: row.shop.reference,
      name: row.shop.name,
      shopReference: row.shop.reference,
      shopName: row.shop.name,
      oldestDueDate: row.oldestDueDate,
      daysOverdue: row.oldestDueDate
        ? Math.max(0, Math.floor((today.getTime() - row.oldestDueDate.getTime()) / 86_400_000))
        : 0,
      overdueDays: row.oldestDueDate
        ? Math.max(0, Math.floor((today.getTime() - row.oldestDueDate.getTime()) / 86_400_000))
        : 0,
    }));
  return {
    data,
    summary: {
      overdueShopCount: data.length,
      totalOverdueMinor: data.reduce((sum, row) => sum + row.overdueMinor, 0),
    },
  };
}

export async function getCollectionReport(options: {
  from?: string;
  to?: string;
  status?: string;
  collectedBy?: string;
  shopId?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const filter: Record<string, unknown> = {};
  if (options.from || options.to) {
    filter.collectedAt = {
      ...(options.from ? { $gte: dhakaDayBoundary(options.from) } : {}),
      ...(options.to ? { $lte: dhakaDayBoundary(options.to, true) } : {}),
    };
  }
  if (options.status) filter.status = options.status;
  if (options.collectedBy) filter.collectedBy = new Types.ObjectId(options.collectedBy);
  if (options.shopId) filter.shopId = new Types.ObjectId(options.shopId);
  const [data, total, totals] = await Promise.all([
    Payment.find(filter)
      .populate('shopId', 'reference name')
      .populate('invoiceId', 'reference')
      .populate('deliveryId', 'reference')
      .populate('collectedBy', 'firstName lastName')
      .sort({ collectedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
    Payment.aggregate<{ _id: string; amountMinor: number; count: number }>([
      { $match: filter },
      { $group: { _id: '$status', amountMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
    ]),
  ]);
  const rows = data.map((payment) => {
    const shop = payment.shopId as unknown as { reference?: string; name?: string };
    const invoice = payment.invoiceId as unknown as { reference?: string } | undefined;
    const collector = payment.collectedBy as unknown as
      { firstName?: string; lastName?: string } | undefined;
    return {
      ...payment,
      paymentReference: payment.reference,
      shopReference: shop?.reference,
      shopName: shop?.name,
      invoiceReference: invoice?.reference,
      collectorName: collector
        ? `${collector.firstName ?? ''} ${collector.lastName ?? ''}`.trim()
        : undefined,
      collectionTime: payment.collectedAt,
      collectedAmountMinor: payment.amountMinor,
    };
  });
  return {
    data: rows,
    summary: {
      totalCount: total,
      totalCollectedMinor: totals
        .filter((row) => row._id !== PaymentStatus.FAILED && row._id !== PaymentStatus.REVERSED)
        .reduce((sum, row) => sum + row.amountMinor, 0),
      byStatus: Object.fromEntries(
        totals.map((row) => [row._id, { count: row.count, amountMinor: row.amountMinor }]),
      ),
    },
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

export async function getFinanceDashboardSummary() {
  const [outstanding, overdue, pending, posted] = await Promise.all([
    getOutstandingReport(),
    getOverdueReport(),
    Payment.aggregate<{ amountMinor: number; count: number }>([
      { $match: { source: PaymentSource.DELIVERY_COLLECTION, status: PaymentStatus.PENDING } },
      { $group: { _id: null, amountMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate<{ amountMinor: number; count: number }>([
      { $match: { status: PaymentStatus.POSTED } },
      { $group: { _id: null, amountMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
    ]),
  ]);
  return {
    totalOutstandingMinor: outstanding.summary.totalOutstandingMinor,
    totalOverdueMinor: overdue.summary.totalOverdueMinor,
    pendingCollectionsMinor: pending[0]?.amountMinor ?? 0,
    pendingCollectionsCount: pending[0]?.count ?? 0,
    overdueShopCount: overdue.summary.overdueShopCount,
    outstandingBalanceMinor: outstanding.summary.totalOutstandingMinor,
    overdueBalanceMinor: overdue.summary.totalOverdueMinor,
    collectedAmountMinor: posted[0]?.amountMinor ?? 0,
    pendingCollectionMinor: pending[0]?.amountMinor ?? 0,
  };
}

export async function getCollectorSummary(actorId: string, page = 1, limit = 30) {
  const today = dhakaDateString();
  const result = await getCollectionReport({
    collectedBy: actorId,
    page,
    limit,
  });
  const daily = await Payment.aggregate<{ amountMinor: number; count: number }>([
    {
      $match: {
        collectedBy: new Types.ObjectId(actorId),
        collectedAt: { $gte: dhakaDayBoundary(today), $lte: dhakaDayBoundary(today, true) },
        status: { $nin: [PaymentStatus.FAILED, PaymentStatus.REVERSED] },
      },
    },
    { $group: { _id: null, amountMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
  ]);
  const pendingHandover = await Payment.aggregate<{ amountMinor: number }>([
    {
      $match: {
        collectedBy: new Types.ObjectId(actorId),
        handoverStatus: 'PENDING',
        status: { $nin: [PaymentStatus.FAILED, PaymentStatus.REVERSED] },
      },
    },
    { $group: { _id: null, amountMinor: { $sum: '$amountMinor' } } },
  ]);
  return {
    ...result,
    items: result.data,
    summary: {
      ...result.summary,
      todayCollectedMinor: daily[0]?.amountMinor ?? 0,
      todayCount: daily[0]?.count ?? 0,
      pendingHandoverMinor: pendingHandover[0]?.amountMinor ?? 0,
    },
  };
}

export async function reconcileShopFinance(shopId: string, actor: FinanceActor, repair: boolean) {
  const shop = await Shop.findById(shopId);
  if (!shop) throw financeError('Shop not found', 'NOT_FOUND', 404);
  const [invoices, postedPayments, deliverySnapshots] = await Promise.all([
    Invoice.find({ shopId, status: 'ISSUED' }).select('_id reference').lean(),
    Payment.find({ shopId, status: PaymentStatus.POSTED }).select('_id reference').lean(),
    Delivery.find({ shopId, 'paymentCollection.status': 'PENDING_POSTING' })
      .select('_id reference paymentCollection')
      .lean(),
  ]);
  const [invoiceSources, paymentSources, deliveryPayments] = await Promise.all([
    LedgerTransaction.find({
      invoiceId: { $in: invoices.map((invoice) => invoice._id) },
      type: 'INVOICE_CHARGE',
    }).distinct('invoiceId'),
    LedgerTransaction.find({
      paymentId: { $in: postedPayments.map((payment) => payment._id) },
      type: 'PAYMENT',
    }).distinct('paymentId'),
    Payment.find({
      deliveryId: { $in: deliverySnapshots.map((delivery) => delivery._id) },
    }).distinct('deliveryId'),
  ]);
  const invoiceSet = new Set(invoiceSources.map(String));
  const paymentSet = new Set(paymentSources.map(String));
  const deliverySet = new Set(deliveryPayments.map(String));
  const missingInvoiceCharges = invoices.filter((invoice) => !invoiceSet.has(String(invoice._id)));
  const postedPaymentsWithoutLedger = postedPayments.filter(
    (payment) => !paymentSet.has(String(payment._id)),
  );
  const deliveryCollectionsWithoutPayment = deliverySnapshots.filter(
    (delivery) => !deliverySet.has(String(delivery._id)),
  );
  if (repair) {
    for (const missing of missingInvoiceCharges) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const invoice = await Invoice.findById(missing._id).session(session);
          if (invoice) await postInvoiceCharge(invoice, actor, session);
        });
      } finally {
        await session.endSession();
      }
    }
  }
  const ledgerBalanceMinor = await getLedgerBalance(shopId);
  const projectionDifferenceMinor = shop.outstandingBalance - ledgerBalanceMinor;
  if (repair && projectionDifferenceMinor !== 0) {
    await Shop.updateOne({ _id: shop._id }, { $set: { outstandingBalance: ledgerBalanceMinor } });
  }
  const result = {
    shopId,
    ledgerBalanceMinor,
    cachedBalanceMinor: shop.outstandingBalance,
    projectionDifferenceMinor,
    missingInvoiceCharges: missingInvoiceCharges.map((value) => value.reference),
    postedPaymentsWithoutLedger: postedPaymentsWithoutLedger.map((value) => value.reference),
    deliveryCollectionsWithoutPayment: deliveryCollectionsWithoutPayment.map(
      (value) => value.reference,
    ),
    repairedInvoiceCharges: repair ? missingInvoiceCharges.length : 0,
    repairedProjection: repair && projectionDifferenceMinor !== 0,
  };
  await AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    action: repair ? 'FINANCE_RECONCILIATION_REPAIRED' : 'FINANCE_RECONCILIATION_RUN',
    entityType: 'Shop',
    entityId: shop._id,
    after: result,
  });
  return result;
}

export async function backfillCreditReservation(
  input: { orderId: string; reason: string; idempotencyKey: string },
  actor: FinanceActor,
) {
  const normalised = {
    ...input,
    reason: input.reason.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
  };
  const requestHash = createHash('sha256')
    .update(`${normalised.orderId}:${normalised.reason}`)
    .digest('hex');
  const session = await mongoose.startSession();
  try {
    let result: InstanceType<typeof CreditReservation> | undefined;
    let idempotentReplay = false;
    await session.withTransaction(async () => {
      result = undefined;
      idempotentReplay = false;
      const existing = await CreditReservation.findOne({
        $or: [
          { orderId: normalised.orderId },
          { 'migrationBackfill.idempotencyKey': normalised.idempotencyKey },
        ],
      }).session(session);
      if (existing) {
        const metadata = existing.migrationBackfill;
        if (existing.source !== CreditReservationSource.MIGRATION_BACKFILL || !metadata) {
          throw financeError(
            'This Order already has a non-migration credit reservation',
            'CREDIT_RESERVATION_CONFLICT',
            409,
          );
        }
        if (
          String(existing.orderId) !== normalised.orderId ||
          metadata.idempotencyKey !== normalised.idempotencyKey ||
          metadata.requestHash !== requestHash
        ) {
          throw financeError(
            'This idempotency key or Order was already used for a different backfill request',
            'IDEMPOTENCY_CONFLICT',
            409,
          );
        }
        const activeReservedMinor = await getActiveReservedExposure(existing.shopId, session);
        const replayShop = await Shop.findById(existing.shopId).session(session);
        if (!replayShop)
          throw financeError('Reservation Shop is missing', 'FINANCE_DATA_INCOMPLETE', 409);
        const cachedReservedMinor = replayShop.reservedCreditMinor ?? 0;
        if (cachedReservedMinor !== activeReservedMinor) {
          const repaired = await Shop.findOneAndUpdate(
            { _id: replayShop._id, reservedCreditMinor: cachedReservedMinor },
            { $set: { reservedCreditMinor: activeReservedMinor } },
            { returnDocument: 'after', session },
          );
          if (!repaired)
            throw financeError(
              'Credit projection changed concurrently',
              'CONCURRENT_CREDIT_CHANGE',
              409,
            );
          await AuditLog.create(
            [
              {
                actorId: actor._id,
                actorRole: actor.role,
                action: 'CREDIT_RESERVATION_PROJECTION_REPAIRED',
                entityType: 'Order',
                entityId: existing.orderId,
                before: { reservedCreditMinor: cachedReservedMinor },
                after: { reservedCreditMinor: activeReservedMinor },
                ipAddress: actor.ipAddress,
                userAgent: actor.userAgent,
                correlationId: actor.correlationId ?? normalised.idempotencyKey,
              },
            ],
            { session },
          );
        }
        result = existing;
        idempotentReplay = true;
        return;
      }
      const order = await Order.findOne({
        _id: normalised.orderId,
        requestedPaymentMethod: 'CREDIT',
        status: { $in: ['APPROVED', 'PARTIALLY_APPROVED', 'PREPARING', 'PACKING', 'PACKED'] },
      }).session(session);
      if (!order) throw financeError('Eligible approved credit Order not found', 'NOT_FOUND', 404);
      if (await Invoice.exists({ orderId: order._id }).session(session))
        throw financeError(
          'An invoiced Order no longer needs a credit reservation',
          'ORDER_INVOICED',
          409,
        );
      const approval = await OrderApproval.findOne({ orderId: order._id }).session(session);
      const shop = await Shop.findById(order.shopId).session(session);
      if (!approval || !shop)
        throw financeError('Order approval or Shop is missing', 'FINANCE_DATA_INCOMPLETE', 409);
      const currentReserved = await getActiveReservedExposure(shop._id, session);
      const credit = await getCreditSummary(String(shop._id), {
        proposedExposureMinor: approval.totalMinor,
        reservedExposureMinor: currentReserved,
        session,
      });
      const targetReserved = currentReserved + approval.totalMinor;
      if (!Number.isSafeInteger(targetReserved))
        throw financeError(
          'Reserved exposure exceeds the safe integer range',
          'MONEY_OVERFLOW',
          409,
        );
      const cachedReserved = shop.reservedCreditMinor ?? 0;
      const locked = await Shop.findOneAndUpdate(
        {
          _id: shop._id,
          $or: [
            { reservedCreditMinor: cachedReserved },
            ...(cachedReserved === 0 ? [{ reservedCreditMinor: { $exists: false } }] : []),
          ],
        },
        { $set: { reservedCreditMinor: targetReserved } },
        { returnDocument: 'after', session },
      );
      if (!locked)
        throw financeError(
          'Credit projection changed concurrently',
          'CONCURRENT_CREDIT_CHANGE',
          409,
        );
      const created = await reserveCredit(
        {
          orderId: order._id,
          shopId: shop._id,
          approvedExposureMinor: approval.totalMinor,
          decisionSnapshot: {
            creditLimitMinor: credit.creditLimitMinor,
            outstandingMinor: credit.outstandingMinor,
            reservedMinor: currentReserved,
            overdueMinor: credit.overdueMinor,
            availableCreditMinor: credit.availableCreditMinor,
            proposedExposureMinor: approval.totalMinor,
            blockedReasons: credit.blockReasons,
          },
          override: { applied: false },
          source: CreditReservationSource.MIGRATION_BACKFILL,
          migrationBackfill: {
            reason: normalised.reason,
            idempotencyKey: normalised.idempotencyKey,
            requestHash,
            originalManagerId: approval.managerId,
            originalCreditOverride: Boolean(approval.creditOverride),
            originalOverrideReason: approval.creditOverride
              ? (approval.internalNotes ?? approval.reason ?? undefined)
              : undefined,
          },
        },
        actor,
        session,
      );
      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'CREDIT_RESERVATION_BACKFILLED',
            entityType: 'Order',
            entityId: order._id,
            before: { reservedCreditMinor: cachedReserved },
            after: {
              reservationId: created.reservation._id,
              approvedExposureMinor: approval.totalMinor,
              reservedCreditMinor: targetReserved,
              source: CreditReservationSource.MIGRATION_BACKFILL,
              reason: normalised.reason,
              idempotencyKey: normalised.idempotencyKey,
            },
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
            correlationId: actor.correlationId ?? normalised.idempotencyKey,
          },
        ],
        { session },
      );
      result = created.reservation;
    });
    return { reservation: result!, idempotentReplay };
  } catch (error) {
    if ((error as { code?: number }).code === 11_000) {
      throw financeError(
        'This Order or idempotency key already has a credit backfill',
        'IDEMPOTENCY_CONFLICT',
        409,
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
