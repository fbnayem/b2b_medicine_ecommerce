import { Types, type PipelineStage } from 'mongoose';
import {
  DeliveryStatus,
  LedgerAccount,
  OrderStatus,
  PaymentStatus,
  ReportGranularity,
  ReturnStatus,
  SalesDimension,
  ShopStatus,
} from '@medsupply/shared-types';
import { CreditNote } from '../models/CreditNote';
import { Delivery } from '../models/Delivery';
import { Invoice } from '../models/Invoice';
import { LedgerTransaction } from '../models/LedgerTransaction';
import { MedicineBatch } from '../models/MedicineBatch';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { Return } from '../models/Return';
import { Shop } from '../models/Shop';
import { StockMovement } from '../models/StockMovement';
import { dhakaDateString, dhakaDayBoundary } from './ledgerService';
import {
  basisPoints,
  bucketExpression,
  bucketLabels,
  fillBuckets,
  millisToHours,
} from './reportPeriod';
import { inventorySettings } from './settingsService';

export interface RangeInput {
  from: string;
  to: string;
  granularity: ReportGranularity;
  shopId?: string;
}

function resolveRange(input: RangeInput) {
  return {
    start: dhakaDayBoundary(input.from),
    end: dhakaDayBoundary(input.to, true),
    labels: bucketLabels(input.from, input.to, input.granularity),
    period: { from: input.from, to: input.to, granularity: input.granularity },
  };
}

/**
 * One `$switch` branch. `then` is MongoDB's aggregation keyword here, not a
 * promise interface — the object is sent to the database and never awaited —
 * so the thenable rule is silenced once, at the only place the key is written.
 */
// oxlint-disable-next-line unicorn/no-thenable
const branch = (when: unknown, label: string) => ({ case: when, then: label });

const shopMatch = (shopId?: string) => (shopId ? { shopId: new Types.ObjectId(shopId) } : {});

/* ------------------------------------------------------------------ sales */

const invoiceLineGross = {
  $sum: {
    $map: {
      input: '$items',
      as: 'item',
      in: { $multiply: ['$$item.quantity', '$$item.unitPriceMinor'] },
    },
  },
};

const invoiceUnits = {
  $sum: { $map: { input: '$items', as: 'item', in: '$$item.quantity' } },
};

export async function salesSummary(input: RangeInput) {
  const { start, end, labels, period } = resolveRange(input);
  const match = {
    status: 'ISSUED',
    invoiceDate: { $gte: start, $lte: end },
    ...shopMatch(input.shopId),
  };

  const [totals, series, returnRows, returnTotal] = await Promise.all([
    Invoice.aggregate<{
      invoiceCount: number;
      shops: Types.ObjectId[];
      unitsSold: number;
      grossMinor: number;
      subtotalMinor: number;
      orderDiscountMinor: number;
      taxMinor: number;
      deliveryChargeMinor: number;
      netMinor: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          invoiceCount: { $sum: 1 },
          shops: { $addToSet: '$shopId' },
          unitsSold: { $sum: invoiceUnits },
          grossMinor: { $sum: invoiceLineGross },
          subtotalMinor: { $sum: '$subtotalMinor' },
          orderDiscountMinor: { $sum: '$orderDiscountMinor' },
          taxMinor: { $sum: '$taxMinor' },
          deliveryChargeMinor: { $sum: '$deliveryChargeMinor' },
          netMinor: { $sum: '$grandTotalMinor' },
        },
      },
    ]),
    Invoice.aggregate<{
      bucket: string;
      invoiceCount: number;
      grossMinor: number;
      subtotalMinor: number;
      orderDiscountMinor: number;
      taxMinor: number;
      netMinor: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: bucketExpression('invoiceDate', input.granularity),
          invoiceCount: { $sum: 1 },
          grossMinor: { $sum: invoiceLineGross },
          subtotalMinor: { $sum: '$subtotalMinor' },
          orderDiscountMinor: { $sum: '$orderDiscountMinor' },
          taxMinor: { $sum: '$taxMinor' },
          netMinor: { $sum: '$grandTotalMinor' },
        },
      },
      {
        $project: {
          _id: 0,
          bucket: '$_id',
          invoiceCount: 1,
          grossMinor: 1,
          subtotalMinor: 1,
          orderDiscountMinor: 1,
          taxMinor: 1,
          netMinor: 1,
        },
      },
    ]),
    CreditNote.aggregate<{ bucket: string; returnedMinor: number }>([
      { $match: { issuedAt: { $gte: start, $lte: end }, ...shopMatch(input.shopId) } },
      {
        $group: {
          _id: bucketExpression('issuedAt', input.granularity),
          returnedMinor: { $sum: '$totalMinor' },
        },
      },
      { $project: { _id: 0, bucket: '$_id', returnedMinor: 1 } },
    ]),
    CreditNote.aggregate<{ total: number }>([
      { $match: { issuedAt: { $gte: start, $lte: end }, ...shopMatch(input.shopId) } },
      { $group: { _id: null, total: { $sum: '$totalMinor' } } },
    ]),
  ]);

  const returnsByBucket = new Map(returnRows.map((row) => [row.bucket, row.returnedMinor]));
  const filled = fillBuckets(
    labels,
    series.map((row) => {
      const returnedMinor = returnsByBucket.get(row.bucket) ?? 0;
      return {
        bucket: row.bucket,
        invoiceCount: row.invoiceCount,
        grossMinor: row.grossMinor,
        discountMinor: row.grossMinor - row.subtotalMinor + row.orderDiscountMinor,
        taxMinor: row.taxMinor,
        netMinor: row.netMinor,
        returnedMinor,
        netAfterReturnsMinor: row.netMinor - returnedMinor,
      };
    }),
    (bucket) => ({
      bucket,
      invoiceCount: 0,
      grossMinor: 0,
      discountMinor: 0,
      taxMinor: 0,
      netMinor: 0,
      returnedMinor: returnsByBucket.get(bucket) ?? 0,
      netAfterReturnsMinor: -(returnsByBucket.get(bucket) ?? 0),
    }),
  );

  const summary = totals[0];
  const netMinor = summary?.netMinor ?? 0;
  const returnedMinor = returnTotal[0]?.total ?? 0;
  const invoiceCount = summary?.invoiceCount ?? 0;
  return {
    period,
    totals: {
      invoiceCount,
      shopCount: summary?.shops.length ?? 0,
      unitsSold: summary?.unitsSold ?? 0,
      grossMinor: summary?.grossMinor ?? 0,
      discountMinor: summary
        ? summary.grossMinor - summary.subtotalMinor + summary.orderDiscountMinor
        : 0,
      taxMinor: summary?.taxMinor ?? 0,
      deliveryChargeMinor: summary?.deliveryChargeMinor ?? 0,
      netMinor,
      returnedMinor,
      netAfterReturnsMinor: netMinor - returnedMinor,
      averageInvoiceMinor: invoiceCount ? Math.round(netMinor / invoiceCount) : 0,
    },
    series: filled,
  };
}

const dimensionConfig: Record<
  SalesDimension,
  {
    groupBy: string;
    label: string;
    secondary?: string;
    needsMedicine?: boolean;
    needsShop?: boolean;
  }
> = {
  [SalesDimension.MEDICINE]: {
    groupBy: '$items.medicineId',
    label: '$items.medicineSnapshot.brandName',
    secondary: '$items.medicineSnapshot.genericName',
  },
  [SalesDimension.CATEGORY]: {
    groupBy: '$medicine.category',
    label: '$medicine.category',
    needsMedicine: true,
  },
  [SalesDimension.MANUFACTURER]: {
    groupBy: '$items.medicineSnapshot.manufacturer',
    label: '$items.medicineSnapshot.manufacturer',
  },
  [SalesDimension.SHOP]: {
    groupBy: '$shopId',
    label: '$shop.name',
    secondary: '$shop.reference',
    needsShop: true,
  },
  [SalesDimension.TERRITORY]: {
    groupBy: '$shop.territory',
    label: '$shop.territory',
    needsShop: true,
  },
};

export async function salesByDimension(
  input: RangeInput & { dimension: SalesDimension; limit: number },
) {
  const { start, end, period } = resolveRange(input);
  const config = dimensionConfig[input.dimension];
  const pipeline: PipelineStage[] = [
    {
      $match: {
        status: 'ISSUED',
        invoiceDate: { $gte: start, $lte: end },
        ...shopMatch(input.shopId),
      },
    },
  ];
  if (config.needsShop) {
    pipeline.push(
      { $lookup: { from: 'shops', localField: 'shopId', foreignField: '_id', as: 'shop' } },
      { $unwind: { path: '$shop', preserveNullAndEmptyArrays: true } },
    );
  }
  pipeline.push({ $unwind: '$items' });
  if (config.needsMedicine) {
    pipeline.push(
      {
        $lookup: {
          from: 'medicines',
          localField: 'items.medicineId',
          foreignField: '_id',
          as: 'medicine',
        },
      },
      { $unwind: { path: '$medicine', preserveNullAndEmptyArrays: true } },
    );
  }
  pipeline.push(
    {
      $group: {
        _id: config.groupBy,
        label: { $first: config.label },
        secondaryLabel: { $first: config.secondary ?? null },
        invoices: { $addToSet: '$_id' },
        quantity: { $sum: '$items.quantity' },
        netMinor: { $sum: '$items.lineTotalMinor' },
      },
    },
    {
      $project: {
        _id: 0,
        key: { $toString: { $ifNull: ['$_id', 'UNSPECIFIED'] } },
        label: 1,
        secondaryLabel: 1,
        invoiceCount: { $size: '$invoices' },
        quantity: 1,
        netMinor: 1,
      },
    },
    { $sort: { netMinor: -1 } },
    { $limit: input.limit },
  );

  const [rows, totalRow] = await Promise.all([
    Invoice.aggregate<{
      key: string;
      label: string | null;
      secondaryLabel: string | null;
      invoiceCount: number;
      quantity: number;
      netMinor: number;
    }>(pipeline),
    Invoice.aggregate<{ total: number }>([
      {
        $match: {
          status: 'ISSUED',
          invoiceDate: { $gte: start, $lte: end },
          ...shopMatch(input.shopId),
        },
      },
      { $unwind: '$items' },
      { $group: { _id: null, total: { $sum: '$items.lineTotalMinor' } } },
    ]),
  ]);

  const returnsByKey = await returnedValueByDimension(
    input,
    rows.map((row) => row.key),
  );
  const total = totalRow[0]?.total ?? 0;
  return {
    period,
    dimension: input.dimension,
    totalNetMinor: total,
    data: rows.map((row) => ({
      key: row.key,
      label: row.label ?? 'Unspecified',
      secondaryLabel: row.secondaryLabel ?? undefined,
      invoiceCount: row.invoiceCount,
      quantity: row.quantity,
      netMinor: row.netMinor,
      returnedMinor: returnsByKey.get(row.key) ?? 0,
      sharePercentBasisPoints: basisPoints(row.netMinor, total),
    })),
  };
}

/**
 * Returned value for the same keys, so a dimension row shows what was sold and
 * what came back. Only MEDICINE and SHOP can be keyed from the return record
 * itself; the others would need a second catalogue join for little benefit, so
 * they report zero rather than an approximation.
 */
async function returnedValueByDimension(
  input: RangeInput & { dimension: SalesDimension },
  keys: string[],
) {
  const result = new Map<string, number>();
  if (!keys.length) return result;
  const { start, end } = resolveRange(input);
  if (input.dimension === SalesDimension.SHOP) {
    const rows = await CreditNote.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { issuedAt: { $gte: start, $lte: end }, ...shopMatch(input.shopId) } },
      { $group: { _id: '$shopId', total: { $sum: '$totalMinor' } } },
    ]);
    for (const row of rows) result.set(String(row._id), row.total);
    return result;
  }
  if (input.dimension === SalesDimension.MEDICINE) {
    const rows = await Return.aggregate<{ _id: Types.ObjectId; total: number }>([
      {
        $match: {
          status: ReturnStatus.COMPLETED,
          completedAt: { $gte: start, $lte: end },
          ...shopMatch(input.shopId),
        },
      },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.medicineId', total: { $sum: '$lines.refundMinor' } } },
    ]);
    for (const row of rows) result.set(String(row._id), row.total);
  }
  return result;
}

/* ----------------------------------------------------------------- orders */

/** Milliseconds between the first entry reaching `to` and the order's submission. */
const firstReaching = (statuses: OrderStatus[]) => ({
  $min: {
    $map: {
      input: {
        $filter: {
          input: '$statusHistory',
          as: 'entry',
          cond: { $in: ['$$entry.to', statuses] },
        },
      },
      as: 'entry',
      in: '$$entry.at',
    },
  },
});

export async function orderFunnel(input: RangeInput) {
  const { start, end, labels, period } = resolveRange(input);
  const match = {
    createdAt: { $gte: start, $lte: end },
    status: { $ne: OrderStatus.DRAFT },
    ...shopMatch(input.shopId),
  };

  const [statusCounts, milestones, series] = await Promise.all([
    Order.aggregate<{ _id: OrderStatus; count: number }>([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Order.aggregate<{
      submitted: number;
      reviewed: number;
      approved: number;
      rejected: number;
      invoiced: number;
      delivered: number;
      cancelled: number;
      submitToReview: number | null;
      reviewToInvoice: number | null;
      invoiceToDelivery: number | null;
      submitToDelivery: number | null;
    }>([
      { $match: match },
      {
        $addFields: {
          submittedAtEffective: { $ifNull: ['$submittedAt', '$createdAt'] },
          reviewedAt: firstReaching([
            OrderStatus.UNDER_REVIEW,
            OrderStatus.APPROVED,
            OrderStatus.PARTIALLY_APPROVED,
            OrderStatus.REJECTED,
          ]),
          approvedAt: firstReaching([OrderStatus.APPROVED, OrderStatus.PARTIALLY_APPROVED]),
          rejectedAt: firstReaching([OrderStatus.REJECTED]),
          invoicedAt: firstReaching([OrderStatus.INVOICE_GENERATED]),
          deliveredAt: firstReaching([OrderStatus.DELIVERED, OrderStatus.PARTIALLY_DELIVERED]),
          cancelledAt: firstReaching([OrderStatus.CANCELLED]),
        },
      },
      {
        $group: {
          _id: null,
          submitted: { $sum: 1 },
          reviewed: { $sum: { $cond: [{ $ne: ['$reviewedAt', null] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $ne: ['$approvedAt', null] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $ne: ['$rejectedAt', null] }, 1, 0] } },
          invoiced: { $sum: { $cond: [{ $ne: ['$invoicedAt', null] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $ne: ['$deliveredAt', null] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $ne: ['$cancelledAt', null] }, 1, 0] } },
          submitToReview: { $avg: { $subtract: ['$reviewedAt', '$submittedAtEffective'] } },
          reviewToInvoice: { $avg: { $subtract: ['$invoicedAt', '$approvedAt'] } },
          invoiceToDelivery: { $avg: { $subtract: ['$deliveredAt', '$invoicedAt'] } },
          submitToDelivery: { $avg: { $subtract: ['$deliveredAt', '$submittedAtEffective'] } },
        },
      },
    ]),
    Order.aggregate<{ bucket: string; submitted: number; approved: number; delivered: number }>([
      { $match: match },
      {
        $addFields: {
          approvedAt: firstReaching([OrderStatus.APPROVED, OrderStatus.PARTIALLY_APPROVED]),
          deliveredAt: firstReaching([OrderStatus.DELIVERED, OrderStatus.PARTIALLY_DELIVERED]),
        },
      },
      {
        $group: {
          _id: bucketExpression('createdAt', input.granularity),
          submitted: { $sum: 1 },
          approved: { $sum: { $cond: [{ $ne: ['$approvedAt', null] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $ne: ['$deliveredAt', null] }, 1, 0] } },
        },
      },
      { $project: { _id: 0, bucket: '$_id', submitted: 1, approved: 1, delivered: 1 } },
    ]),
  ]);

  const funnel = milestones[0] ?? {
    submitted: 0,
    reviewed: 0,
    approved: 0,
    rejected: 0,
    invoiced: 0,
    delivered: 0,
    cancelled: 0,
    submitToReview: null,
    reviewToInvoice: null,
    invoiceToDelivery: null,
    submitToDelivery: null,
  };

  return {
    period,
    statusCounts: statusCounts.map((row) => ({ status: row._id, count: row.count })),
    funnel: {
      submitted: funnel.submitted,
      reviewed: funnel.reviewed,
      approved: funnel.approved,
      rejected: funnel.rejected,
      invoiced: funnel.invoiced,
      delivered: funnel.delivered,
      cancelled: funnel.cancelled,
    },
    conversionBasisPoints: {
      approval: basisPoints(funnel.approved, funnel.submitted),
      fulfilment: basisPoints(funnel.invoiced, funnel.approved),
      delivery: basisPoints(funnel.delivered, funnel.invoiced),
    },
    cycleTimeHours: {
      submitToReview: millisToHours(funnel.submitToReview),
      reviewToInvoice: millisToHours(funnel.reviewToInvoice),
      invoiceToDelivery: millisToHours(funnel.invoiceToDelivery),
      submitToDelivery: millisToHours(funnel.submitToDelivery),
    },
    series: fillBuckets(labels, series, (bucket) => ({
      bucket,
      submitted: 0,
      approved: 0,
      delivered: 0,
    })),
  };
}

/* -------------------------------------------------------------- inventory */

export async function inventoryAnalytics(input: { asOf?: string; deadStockDays: number }) {
  const asOfDate = input.asOf ? dhakaDayBoundary(input.asOf, true) : new Date();
  const settings = await inventorySettings();
  const deadStockCutoff = new Date(asOfDate.getTime() - input.deadStockDays * 86_400_000);

  const valuationStage = [
    {
      $lookup: {
        from: 'medicines',
        localField: 'medicineId',
        foreignField: '_id',
        as: 'medicine',
      },
    },
    { $unwind: { path: '$medicine', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        sellingPriceMinor: {
          $ifNull: ['$sellingPriceOverrideMinor', '$medicine.defaultSellingPriceMinor', 0],
        },
      },
    },
  ];

  const [totals, byCategory, expiry, lowStock, deadStock] = await Promise.all([
    MedicineBatch.aggregate<{
      batchCount: number;
      onHand: number;
      available: number;
      costValueMinor: number;
      retailValueMinor: number;
      blockedBatchCount: number;
    }>([
      ...valuationStage,
      {
        $group: {
          _id: null,
          batchCount: { $sum: 1 },
          onHand: { $sum: '$quantities.onHand' },
          available: { $sum: '$quantities.available' },
          costValueMinor: { $sum: { $multiply: ['$quantities.onHand', '$costPriceMinor'] } },
          retailValueMinor: {
            $sum: { $multiply: ['$quantities.available', '$sellingPriceMinor'] },
          },
          blockedBatchCount: {
            $sum: { $cond: [{ $or: ['$isBlocked', '$isQuarantined'] }, 1, 0] },
          },
        },
      },
    ]),
    MedicineBatch.aggregate<{
      key: string;
      label: string;
      batchCount: number;
      onHand: number;
      available: number;
      costValueMinor: number;
      retailValueMinor: number;
    }>([
      ...valuationStage,
      {
        $group: {
          _id: { $ifNull: ['$medicine.category', 'Uncategorised'] },
          batchCount: { $sum: 1 },
          onHand: { $sum: '$quantities.onHand' },
          available: { $sum: '$quantities.available' },
          costValueMinor: { $sum: { $multiply: ['$quantities.onHand', '$costPriceMinor'] } },
          retailValueMinor: {
            $sum: { $multiply: ['$quantities.available', '$sellingPriceMinor'] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          key: '$_id',
          label: '$_id',
          batchCount: 1,
          onHand: 1,
          available: 1,
          costValueMinor: 1,
          retailValueMinor: 1,
        },
      },
      { $sort: { costValueMinor: -1 } },
    ]),
    MedicineBatch.aggregate<{
      bucket: string;
      batchCount: number;
      quantity: number;
      costValueMinor: number;
    }>([
      { $match: { 'quantities.onHand': { $gt: 0 } } },
      {
        $addFields: {
          daysToExpiry: {
            $dateDiff: { startDate: asOfDate, endDate: '$expiryDate', unit: 'day' },
          },
        },
      },
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                branch({ $lte: ['$daysToExpiry', 0] }, 'EXPIRED'),
                branch({ $lte: ['$daysToExpiry', 30] }, 'WITHIN_30_DAYS'),
                branch({ $lte: ['$daysToExpiry', 90] }, 'WITHIN_90_DAYS'),
              ],
              default: 'BEYOND_90_DAYS',
            },
          },
          batchCount: { $sum: 1 },
          quantity: { $sum: '$quantities.onHand' },
          costValueMinor: { $sum: { $multiply: ['$quantities.onHand', '$costPriceMinor'] } },
        },
      },
      { $project: { _id: 0, bucket: '$_id', batchCount: 1, quantity: 1, costValueMinor: 1 } },
    ]),
    MedicineBatch.aggregate<{
      medicineId: Types.ObjectId;
      reference: string;
      brandName: string;
      genericName: string;
      available: number;
    }>([
      { $group: { _id: '$medicineId', available: { $sum: '$quantities.available' } } },
      { $match: { available: { $lte: settings.lowStockThreshold } } },
      { $lookup: { from: 'medicines', localField: '_id', foreignField: '_id', as: 'medicine' } },
      { $unwind: '$medicine' },
      { $match: { 'medicine.isActive': true } },
      {
        $project: {
          _id: 0,
          medicineId: '$_id',
          reference: '$medicine.reference',
          brandName: '$medicine.brandName',
          genericName: '$medicine.genericName',
          available: 1,
        },
      },
      { $sort: { available: 1 } },
      { $limit: 50 },
    ]),
    MedicineBatch.aggregate<{
      batchId: Types.ObjectId;
      medicineId: Types.ObjectId;
      brandName: string;
      batchNumber: string;
      expiryDate: Date;
      available: number;
      costValueMinor: number;
      lastMovementAt?: Date;
    }>([
      { $match: { 'quantities.available': { $gt: 0 }, createdAt: { $lte: deadStockCutoff } } },
      {
        $lookup: {
          from: 'stockmovements',
          let: { batchId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$batchId', '$$batchId'] },
                // A reservation or a pick is demand; a receipt or adjustment is not.
                type: { $in: ['RESERVATION', 'PICKING', 'PACKING'] },
                createdAt: { $gt: deadStockCutoff },
              },
            },
            { $limit: 1 },
          ],
          as: 'recentDemand',
        },
      },
      { $match: { recentDemand: { $size: 0 } } },
      {
        $lookup: {
          from: 'stockmovements',
          let: { batchId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$batchId', '$$batchId'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            { $project: { createdAt: 1 } },
          ],
          as: 'lastMovement',
        },
      },
      {
        $lookup: {
          from: 'medicines',
          localField: 'medicineId',
          foreignField: '_id',
          as: 'medicine',
        },
      },
      { $unwind: { path: '$medicine', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          batchId: '$_id',
          medicineId: 1,
          brandName: { $ifNull: ['$medicine.brandName', 'Unknown medicine'] },
          batchNumber: 1,
          expiryDate: 1,
          available: '$quantities.available',
          costValueMinor: { $multiply: ['$quantities.available', '$costPriceMinor'] },
          lastMovementAt: { $first: '$lastMovement.createdAt' },
        },
      },
      { $sort: { costValueMinor: -1 } },
      { $limit: 50 },
    ]),
  ]);

  const bucketOrder = ['EXPIRED', 'WITHIN_30_DAYS', 'WITHIN_90_DAYS', 'BEYOND_90_DAYS'] as const;
  const expiryByBucket = new Map(expiry.map((row) => [row.bucket, row]));
  return {
    asOf: asOfDate.toISOString(),
    totals: totals[0] ?? {
      batchCount: 0,
      onHand: 0,
      available: 0,
      costValueMinor: 0,
      retailValueMinor: 0,
      blockedBatchCount: 0,
    },
    byCategory,
    expiryBuckets: bucketOrder.map(
      (bucket) =>
        expiryByBucket.get(bucket) ?? { bucket, batchCount: 0, quantity: 0, costValueMinor: 0 },
    ),
    lowStock: lowStock.map((row) => ({
      ...row,
      medicineId: String(row.medicineId),
      threshold: settings.lowStockThreshold,
    })),
    deadStock: deadStock.map((row) => ({
      ...row,
      batchId: String(row.batchId),
      medicineId: String(row.medicineId),
      expiryDate: row.expiryDate?.toISOString(),
      lastMovementAt: row.lastMovementAt?.toISOString(),
    })),
    deadStockDays: input.deadStockDays,
  };
}

/* --------------------------------------------------------------- delivery */

const DELIVERED_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.DELIVERED,
  DeliveryStatus.PARTIALLY_DELIVERED,
];

export async function deliveryPerformance(input: RangeInput) {
  const { start, end, labels, period } = resolveRange(input);
  const match = { createdAt: { $gte: start, $lte: end }, ...shopMatch(input.shopId) };
  const onTimeExpression = {
    $cond: [
      {
        $and: [
          { $in: ['$status', DELIVERED_STATUSES] },
          { $ne: ['$expectedDeliveryDate', null] },
          { $ne: ['$proof.deliveredAt', null] },
          { $lte: ['$proof.deliveredAt', '$expectedDeliveryDate'] },
        ],
      },
      1,
      0,
    ],
  };

  const [totals, failureReasons, byPerson, series] = await Promise.all([
    Delivery.aggregate<{
      total: number;
      delivered: number;
      partiallyDelivered: number;
      failed: number;
      returnedToStore: number;
      onTime: number;
      completedWithExpectation: number;
      averageCycle: number | null;
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $eq: ['$status', DeliveryStatus.DELIVERED] }, 1, 0] } },
          partiallyDelivered: {
            $sum: { $cond: [{ $eq: ['$status', DeliveryStatus.PARTIALLY_DELIVERED] }, 1, 0] },
          },
          failed: { $sum: { $cond: [{ $eq: ['$status', DeliveryStatus.FAILED] }, 1, 0] } },
          returnedToStore: {
            $sum: { $cond: [{ $eq: ['$status', DeliveryStatus.RETURNED_TO_STORE] }, 1, 0] },
          },
          onTime: { $sum: onTimeExpression },
          completedWithExpectation: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$status', DELIVERED_STATUSES] },
                    { $ne: ['$expectedDeliveryDate', null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          averageCycle: { $avg: { $subtract: ['$proof.deliveredAt', '$assignedAt'] } },
        },
      },
    ]),
    Delivery.aggregate<{ _id: string; count: number }>([
      { $match: { ...match, 'failure.reason': { $exists: true } } },
      { $group: { _id: '$failure.reason', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Delivery.aggregate<{
      userId: Types.ObjectId;
      name: string;
      assigned: number;
      delivered: number;
      failed: number;
      onTime: number;
      collectedMinor: number;
    }>([
      { $match: { ...match, assignedTo: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$assignedTo',
          assigned: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $in: ['$status', DELIVERED_STATUSES] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', DeliveryStatus.FAILED] }, 1, 0] } },
          onTime: { $sum: onTimeExpression },
          collectedMinor: {
            $sum: {
              $cond: [
                { $eq: ['$paymentCollection.status', 'POSTED'] },
                { $ifNull: ['$paymentCollection.amountMinor', 0] },
                0,
              ],
            },
          },
        },
      },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'person' } },
      { $unwind: { path: '$person', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          name: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$person.firstName', ''] },
                  ' ',
                  { $ifNull: ['$person.lastName', ''] },
                ],
              },
            },
          },
          assigned: 1,
          delivered: 1,
          failed: 1,
          onTime: 1,
          collectedMinor: 1,
        },
      },
      { $sort: { delivered: -1 } },
    ]),
    Delivery.aggregate<{ bucket: string; delivered: number; failed: number }>([
      { $match: match },
      {
        $group: {
          _id: bucketExpression('createdAt', input.granularity),
          delivered: { $sum: { $cond: [{ $in: ['$status', DELIVERED_STATUSES] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', DeliveryStatus.FAILED] }, 1, 0] } },
        },
      },
      { $project: { _id: 0, bucket: '$_id', delivered: 1, failed: 1 } },
    ]),
  ]);

  const summary = totals[0];
  const completed = (summary?.delivered ?? 0) + (summary?.partiallyDelivered ?? 0);
  return {
    period,
    totals: {
      total: summary?.total ?? 0,
      delivered: summary?.delivered ?? 0,
      partiallyDelivered: summary?.partiallyDelivered ?? 0,
      failed: summary?.failed ?? 0,
      returnedToStore: summary?.returnedToStore ?? 0,
      onTime: summary?.onTime ?? 0,
      late: Math.max(0, (summary?.completedWithExpectation ?? 0) - (summary?.onTime ?? 0)),
      successBasisPoints: basisPoints(completed, summary?.total ?? 0),
      onTimeBasisPoints: basisPoints(summary?.onTime ?? 0, summary?.completedWithExpectation ?? 0),
      averageCycleHours: millisToHours(summary?.averageCycle),
    },
    failureReasons: failureReasons.map((row) => ({ reason: row._id, count: row.count })),
    byPerson: byPerson.map((row) => ({
      ...row,
      userId: String(row.userId),
      name: row.name || 'Unnamed user',
      successBasisPoints: basisPoints(row.delivered, row.assigned),
    })),
    series: fillBuckets(labels, series, (bucket) => ({ bucket, delivered: 0, failed: 0 })),
  };
}

/* ---------------------------------------------------------------- returns */

export async function returnsAnalytics(input: RangeInput) {
  const { start, end, labels, period } = resolveRange(input);
  const match = { requestedAt: { $gte: start, $lte: end }, ...shopMatch(input.shopId) };

  const [totals, byReason, byMedicine, byStatus, series, sales] = await Promise.all([
    Return.aggregate<{
      returnCount: number;
      completedCount: number;
      pendingCount: number;
      unitsReturned: number;
      unitsRestocked: number;
      unitsWrittenOff: number;
      requestedMinor: number;
      creditedMinor: number;
      pendingCreditMinor: number;
    }>([
      { $match: match },
      {
        $addFields: {
          lineUnits: { $sum: '$lines.receivedQuantity' },
          restocked: { $sum: '$lines.restockQuantity' },
          writtenOff: {
            $sum: {
              $map: {
                input: '$lines',
                as: 'line',
                in: {
                  $add: [
                    '$$line.damagedQuantity',
                    '$$line.expiredQuantity',
                    '$$line.quarantinedQuantity',
                  ],
                },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          returnCount: { $sum: 1 },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', ReturnStatus.COMPLETED] }, 1, 0] },
          },
          pendingCount: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$status',
                    [
                      ReturnStatus.REQUESTED,
                      ReturnStatus.UNDER_REVIEW,
                      ReturnStatus.APPROVED,
                      ReturnStatus.PARTIALLY_APPROVED,
                      ReturnStatus.COLLECTED,
                      ReturnStatus.RECEIVED,
                    ],
                  ],
                },
                1,
                0,
              ],
            },
          },
          unitsReturned: { $sum: '$lineUnits' },
          unitsRestocked: { $sum: '$restocked' },
          unitsWrittenOff: { $sum: '$writtenOff' },
          requestedMinor: { $sum: '$requestedTotalMinor' },
          creditedMinor: {
            $sum: {
              $cond: [{ $eq: ['$status', ReturnStatus.COMPLETED] }, '$approvedTotalMinor', 0],
            },
          },
          pendingCreditMinor: {
            $sum: {
              $cond: [{ $eq: ['$status', ReturnStatus.RECEIVED] }, '$approvedTotalMinor', 0],
            },
          },
        },
      },
    ]),
    Return.aggregate<{ _id: string; returnCount: number; quantity: number; creditedMinor: number }>(
      [
        { $match: match },
        { $unwind: '$lines' },
        {
          $group: {
            _id: '$lines.reason',
            returns: { $addToSet: '$_id' },
            quantity: { $sum: { $max: ['$lines.receivedQuantity', '$lines.requestedQuantity'] } },
            creditedMinor: { $sum: '$lines.refundMinor' },
          },
        },
        {
          $project: {
            _id: 1,
            returnCount: { $size: '$returns' },
            quantity: 1,
            creditedMinor: 1,
          },
        },
        { $sort: { quantity: -1 } },
      ],
    ),
    Return.aggregate<{
      medicineId: Types.ObjectId;
      brandName: string;
      genericName: string;
      quantity: number;
      creditedMinor: number;
    }>([
      { $match: match },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.medicineId',
          brandName: { $first: '$lines.medicineSnapshot.brandName' },
          genericName: { $first: '$lines.medicineSnapshot.genericName' },
          quantity: { $sum: { $max: ['$lines.receivedQuantity', '$lines.requestedQuantity'] } },
          creditedMinor: { $sum: '$lines.refundMinor' },
        },
      },
      {
        $project: {
          _id: 0,
          medicineId: '$_id',
          brandName: 1,
          genericName: 1,
          quantity: 1,
          creditedMinor: 1,
        },
      },
      { $sort: { quantity: -1 } },
      { $limit: 20 },
    ]),
    Return.aggregate<{ _id: ReturnStatus; count: number }>([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Return.aggregate<{ bucket: string; returnCount: number; creditedMinor: number }>([
      { $match: match },
      {
        $group: {
          _id: bucketExpression('requestedAt', input.granularity),
          returnCount: { $sum: 1 },
          creditedMinor: {
            $sum: {
              $cond: [{ $eq: ['$status', ReturnStatus.COMPLETED] }, '$approvedTotalMinor', 0],
            },
          },
        },
      },
      { $project: { _id: 0, bucket: '$_id', returnCount: 1, creditedMinor: 1 } },
    ]),
    Invoice.aggregate<{ net: number }>([
      {
        $match: {
          status: 'ISSUED',
          invoiceDate: { $gte: start, $lte: end },
          ...shopMatch(input.shopId),
        },
      },
      { $group: { _id: null, net: { $sum: '$grandTotalMinor' } } },
    ]),
  ]);

  const summary = totals[0];
  const salesNetMinor = sales[0]?.net ?? 0;
  return {
    period,
    totals: {
      returnCount: summary?.returnCount ?? 0,
      completedCount: summary?.completedCount ?? 0,
      pendingCount: summary?.pendingCount ?? 0,
      unitsReturned: summary?.unitsReturned ?? 0,
      unitsRestocked: summary?.unitsRestocked ?? 0,
      unitsWrittenOff: summary?.unitsWrittenOff ?? 0,
      requestedMinor: summary?.requestedMinor ?? 0,
      creditedMinor: summary?.creditedMinor ?? 0,
      pendingCreditMinor: summary?.pendingCreditMinor ?? 0,
      salesNetMinor,
      returnRateBasisPoints: basisPoints(summary?.creditedMinor ?? 0, salesNetMinor),
    },
    byReason: byReason.map((row) => ({
      reason: row._id,
      returnCount: row.returnCount,
      quantity: row.quantity,
      creditedMinor: row.creditedMinor,
    })),
    byMedicine: byMedicine.map((row) => ({ ...row, medicineId: String(row.medicineId) })),
    byStatus: byStatus.map((row) => ({ status: row._id, count: row.count })),
    series: fillBuckets(labels, series, (bucket) => ({ bucket, returnCount: 0, creditedMinor: 0 })),
  };
}

/* ------------------------------------------------------------ receivables */

const AGEING_BUCKETS = [
  'CURRENT',
  'DAYS_1_30',
  'DAYS_31_60',
  'DAYS_61_90',
  'DAYS_90_PLUS',
] as const;
type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export async function receivablesAgeing(input: { asOf?: string } = {}) {
  const asOfDate = input.asOf ? dhakaDayBoundary(input.asOf, true) : new Date();
  const rows = await Invoice.aggregate<{
    shopId: Types.ObjectId;
    shopReference: string;
    shopName: string;
    bucket: AgeingBucket;
    dueMinor: number;
    invoiceCount: number;
  }>([
    { $match: { status: 'ISSUED', invoiceDate: { $lte: asOfDate } } },
    // One lookup against the ledger, replacing separate correlated joins to
    // `payments` and `creditnotes`.
    //
    // This is the same accounts-receivable movement `settlementForInvoices`
    // reads, which is the point: this report and the credit check that blocks
    // orders now compute "what is owed" from one definition. They previously
    // did not — this one subtracted credit notes and the credit check did not,
    // so a customer who had returned goods showed settled here and was refused
    // their next order there.
    //
    // The ledger also closes two gaps the old joins had: a reversed payment is
    // debited back rather than still counted as paid, and an invoice settled
    // from advance balance is recognised as paid.
    {
      $lookup: {
        from: LedgerTransaction.collection.name,
        let: { invoiceId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$invoiceId', '$$invoiceId'] },
              // Bounded by the report date. An as-of ageing report must not
              // count a payment received after the date it claims to describe.
              occurredAt: { $lte: asOfDate },
            },
          },
          { $unwind: '$entries' },
          { $match: { 'entries.account': LedgerAccount.ACCOUNTS_RECEIVABLE } },
          {
            $group: {
              _id: null,
              chargedMinor: {
                $sum: {
                  $cond: [
                    { $eq: ['$type', 'INVOICE_CHARGE'] },
                    { $subtract: ['$entries.debitMinor', '$entries.creditMinor'] },
                    0,
                  ],
                },
              },
              settledMinor: {
                $sum: {
                  $cond: [
                    { $ne: ['$type', 'INVOICE_CHARGE'] },
                    { $subtract: ['$entries.creditMinor', '$entries.debitMinor'] },
                    0,
                  ],
                },
              },
            },
          },
        ],
        as: 'settlement',
      },
    },
    {
      $addFields: {
        dueMinor: {
          $max: [
            0,
            {
              $subtract: [
                {
                  // An issued invoice with no charge in the ledger is a data
                  // fault, not a settled account, and reading the ledger alone
                  // would report it as owing nothing — the one direction a
                  // receivables report must never err in. Falling back to the
                  // invoice's own total errs the safe way.
                  $let: {
                    vars: { charged: { $ifNull: [{ $first: '$settlement.chargedMinor' }, 0] } },
                    in: {
                      $cond: [{ $gt: ['$$charged', 0] }, '$$charged', '$grandTotalMinor'],
                    },
                  },
                },
                { $ifNull: [{ $first: '$settlement.settledMinor' }, 0] },
              ],
            },
          ],
        },
        daysPastDue: { $dateDiff: { startDate: '$dueDate', endDate: asOfDate, unit: 'day' } },
      },
    },
    { $match: { dueMinor: { $gt: 0 } } },
    { $lookup: { from: 'shops', localField: 'shopId', foreignField: '_id', as: 'shop' } },
    { $unwind: { path: '$shop', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: {
          shopId: '$shopId',
          bucket: {
            $switch: {
              branches: [
                branch({ $lte: ['$daysPastDue', 0] }, 'CURRENT'),
                branch({ $lte: ['$daysPastDue', 30] }, 'DAYS_1_30'),
                branch({ $lte: ['$daysPastDue', 60] }, 'DAYS_31_60'),
                branch({ $lte: ['$daysPastDue', 90] }, 'DAYS_61_90'),
              ],
              default: 'DAYS_90_PLUS',
            },
          },
        },
        shopReference: { $first: '$shop.reference' },
        shopName: { $first: '$shop.name' },
        dueMinor: { $sum: '$dueMinor' },
        invoiceCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        shopId: '$_id.shopId',
        bucket: '$_id.bucket',
        shopReference: 1,
        shopName: 1,
        dueMinor: 1,
        invoiceCount: 1,
      },
    },
  ]);

  const bucketTotals = new Map<AgeingBucket, { invoiceCount: number; amountMinor: number }>(
    AGEING_BUCKETS.map((bucket) => [bucket, { invoiceCount: 0, amountMinor: 0 }]),
  );
  const byShop = new Map<
    string,
    {
      shopId: string;
      shopReference: string;
      shopName: string;
      currentMinor: number;
      days1to30Minor: number;
      days31to60Minor: number;
      days61to90Minor: number;
      days90PlusMinor: number;
      totalMinor: number;
    }
  >();
  const field: Record<AgeingBucket, keyof ReturnType<typeof emptyShopRow>> = {
    CURRENT: 'currentMinor',
    DAYS_1_30: 'days1to30Minor',
    DAYS_31_60: 'days31to60Minor',
    DAYS_61_90: 'days61to90Minor',
    DAYS_90_PLUS: 'days90PlusMinor',
  };
  function emptyShopRow(shopId: string, reference: string, name: string) {
    return {
      shopId,
      shopReference: reference,
      shopName: name,
      currentMinor: 0,
      days1to30Minor: 0,
      days31to60Minor: 0,
      days61to90Minor: 0,
      days90PlusMinor: 0,
      totalMinor: 0,
    };
  }

  let totalMinor = 0;
  for (const row of rows) {
    const bucketTotal = bucketTotals.get(row.bucket)!;
    bucketTotal.invoiceCount += row.invoiceCount;
    bucketTotal.amountMinor += row.dueMinor;
    totalMinor += row.dueMinor;
    const key = String(row.shopId);
    const shopRow =
      byShop.get(key) ?? emptyShopRow(key, row.shopReference ?? '', row.shopName ?? 'Unknown shop');
    (shopRow[field[row.bucket]] as number) += row.dueMinor;
    shopRow.totalMinor += row.dueMinor;
    byShop.set(key, shopRow);
  }

  return {
    asOf: asOfDate.toISOString(),
    buckets: AGEING_BUCKETS.map((bucket) => ({ bucket, ...bucketTotals.get(bucket)! })),
    rows: [...byShop.values()].sort((left, right) => right.totalMinor - left.totalMinor),
    totalMinor,
  };
}

/* --------------------------------------------------------------- overview */

/**
 * The manager dashboard, computed at most once every `OVERVIEW_CACHE_MS`.
 *
 * Eight report functions, each of which fans out into several aggregations of
 * its own, used to be launched together on a single GET. Under `Promise.all`
 * they all reach the driver at once, so one dashboard load could occupy most of
 * the connection pool — and a dashboard is the page people leave open and
 * refresh. Two changes: they run in small batches rather than all at once, and
 * the assembled result is cached briefly.
 *
 * The cache does not make the ledger less authoritative. Reports are still
 * recomputed from source every time they are actually computed; this only stops
 * five managers with the same dashboard open from computing the same answer
 * five times a second.
 */
const OVERVIEW_CACHE_MS = 60_000;
const overviewCache = new Map<
  string,
  { at: number; value: Awaited<ReturnType<typeof buildOverview>> }
>();

export function invalidateOverviewCache() {
  overviewCache.clear();
}

export async function analyticsOverview(input: RangeInput) {
  const key = JSON.stringify([input.from, input.to, input.granularity, input.shopId]);
  const cached = overviewCache.get(key);
  if (cached && Date.now() - cached.at < OVERVIEW_CACHE_MS) return cached.value;

  const value = await buildOverview(input);
  // Bounded so a report driven by a free-text date range cannot grow without
  // limit; the dashboard only ever uses a handful of ranges.
  if (overviewCache.size > 32) overviewCache.clear();
  overviewCache.set(key, { at: Date.now(), value });
  return value;
}

async function buildOverview(input: RangeInput) {
  // Two at a time. Enough to overlap the latency of independent aggregations,
  // few enough that one dashboard cannot saturate the pool.
  const [sales, orders] = await Promise.all([salesSummary(input), orderFunnel(input)]);
  const [delivery, returns] = await Promise.all([
    deliveryPerformance(input),
    returnsAnalytics(input),
  ]);
  const [ageing, inventory] = await Promise.all([
    receivablesAgeing({ asOf: input.to }),
    inventoryAnalytics({ asOf: input.to, deadStockDays: 90 }),
  ]);
  const [topMedicines, topShops] = await Promise.all([
    salesByDimension({ ...input, dimension: SalesDimension.MEDICINE, limit: 5 }),
    salesByDimension({ ...input, dimension: SalesDimension.SHOP, limit: 5 }),
  ]);

  const overdueMinor = ageing.buckets
    .filter((bucket) => bucket.bucket !== 'CURRENT')
    .reduce((sum, bucket) => sum + bucket.amountMinor, 0);
  const expiringSoonBatches = inventory.expiryBuckets
    .filter((bucket) => bucket.bucket === 'EXPIRED' || bucket.bucket === 'WITHIN_30_DAYS')
    .reduce((sum, bucket) => sum + bucket.batchCount, 0);

  return {
    period: sales.period,
    sales: sales.totals,
    salesSeries: sales.series,
    orders: orders.funnel,
    orderCycleHours: orders.cycleTimeHours,
    delivery: delivery.totals,
    returns: returns.totals,
    receivables: {
      outstandingMinor: ageing.totalMinor,
      overdueMinor,
      ageing: ageing.buckets,
    },
    inventory: {
      costValueMinor: inventory.totals.costValueMinor,
      available: inventory.totals.available,
      expiringSoonBatches,
      lowStockCount: inventory.lowStock.length,
    },
    topMedicines: topMedicines.data,
    topShops: topShops.data,
  };
}

/** Default range used when a client asks for "this month" without dates. */
export function defaultRange(granularity: ReportGranularity = ReportGranularity.DAY): RangeInput {
  const to = dhakaDateString();
  return { from: `${to.slice(0, 8)}01`, to, granularity };
}

/** Shops a report may cover; a Shop Owner is always narrowed to their own. */
export async function reportableShopIds(ownerId: string) {
  const shops = await Shop.find({ ownerIds: ownerId, status: { $ne: ShopStatus.INACTIVE } })
    .select('_id')
    .lean();
  return shops.map((shop) => String(shop._id));
}

export async function collectorPaymentTotal(from: Date, to: Date) {
  const [row] = await Payment.aggregate<{ total: number }>([
    { $match: { collectedAt: { $gte: from, $lte: to }, status: PaymentStatus.POSTED } },
    { $group: { _id: null, total: { $sum: '$amountMinor' } } },
  ]);
  return row?.total ?? 0;
}

export async function stockMovementSummary(input: RangeInput) {
  const { start, end, period } = resolveRange(input);
  const rows = await StockMovement.aggregate<{ _id: string; count: number; quantity: number }>([
    { $match: { createdAt: { $gte: start, $lte: end } } },
    { $group: { _id: '$type', count: { $sum: 1 }, quantity: { $sum: '$quantity' } } },
    { $sort: { count: -1 } },
  ]);
  return {
    period,
    data: rows.map((row) => ({ type: row._id, count: row.count, quantity: row.quantity })),
  };
}
