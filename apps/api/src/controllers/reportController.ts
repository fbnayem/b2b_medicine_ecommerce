import { NextFunction, Response } from 'express';
import { ReportGranularity, UserRole } from '@medsupply/shared-types';
import {
  AgeingReportQuerySchema,
  InventoryReportQuerySchema,
  ReportRangeSchema,
  SalesDimensionQuerySchema,
} from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import { csvFilename, csvMinor, toCsv, type CsvColumn } from '../services/csv';
import { dhakaDateString } from '../services/ledgerService';
import {
  analyticsOverview,
  deliveryPerformance,
  inventoryAnalytics,
  orderFunnel,
  receivablesAgeing,
  returnsAnalytics,
  reportableShopIds,
  salesByDimension,
  salesSummary,
  stockMovementSummary,
  type RangeInput,
} from '../services/reportService';

/**
 * A Shop Owner may only ever see their own shop. Rather than rejecting the
 * request we narrow it, so the same report screen works for every role.
 */
async function scopedRange(req: AuthRequest): Promise<RangeInput> {
  const today = dhakaDateString();
  const parsed = ReportRangeSchema.parse({
    from: req.query.from ?? `${today.slice(0, 8)}01`,
    to: req.query.to ?? today,
    granularity: req.query.granularity ?? ReportGranularity.DAY,
    shopId: req.query.shopId,
    format: req.query.format ?? 'json',
  });
  if (req.user!.role !== UserRole.SHOP_OWNER) return parsed;
  const owned = await reportableShopIds(String(req.user!._id));
  if (!owned.length) {
    throw Object.assign(new Error('No shop account is assigned to this user'), {
      statusCode: 404,
      code: 'SHOP_NOT_FOUND',
    });
  }
  if (parsed.shopId && !owned.includes(parsed.shopId)) {
    throw Object.assign(new Error('This report covers another shop'), {
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  }
  return { ...parsed, shopId: parsed.shopId ?? owned[0] };
}

function sendCsv<T>(
  res: Response,
  name: string,
  columns: Array<CsvColumn<T>>,
  rows: T[],
  range?: { from: string; to: string },
) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${csvFilename(name, range?.from, range?.to)}"`,
  );
  res.send(toCsv(columns, rows));
}

const wantsCsv = (req: AuthRequest) => req.query.format === 'csv';

export async function overview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await analyticsOverview(await scopedRange(req)) });
  } catch (error) {
    next(error);
  }
}

export async function sales(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const range = await scopedRange(req);
    const report = await salesSummary(range);
    if (wantsCsv(req)) {
      sendCsv(
        res,
        'sales-summary',
        [
          { header: 'Period', value: (row) => row.bucket },
          { header: 'Invoices', value: (row) => row.invoiceCount },
          { header: 'Gross', value: (row) => csvMinor(row.grossMinor) },
          { header: 'Discount', value: (row) => csvMinor(row.discountMinor) },
          { header: 'Tax', value: (row) => csvMinor(row.taxMinor) },
          { header: 'Net', value: (row) => csvMinor(row.netMinor) },
          { header: 'Returned', value: (row) => csvMinor(row.returnedMinor) },
          { header: 'Net after returns', value: (row) => csvMinor(row.netAfterReturnsMinor) },
        ],
        report.series,
        range,
      );
      return;
    }
    res.json({ data: report });
  } catch (error) {
    next(error);
  }
}

export async function salesBreakdown(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const range = await scopedRange(req);
    const parsed = SalesDimensionQuerySchema.parse({
      from: range.from,
      to: range.to,
      granularity: range.granularity,
      shopId: range.shopId,
      dimension: req.query.dimension,
      limit: req.query.limit,
      format: req.query.format ?? 'json',
    });
    const report = await salesByDimension({
      ...range,
      dimension: parsed.dimension,
      limit: parsed.limit,
    });
    if (wantsCsv(req)) {
      sendCsv(
        res,
        `sales-by-${parsed.dimension.toLowerCase()}`,
        [
          { header: 'Name', value: (row) => row.label },
          { header: 'Detail', value: (row) => row.secondaryLabel ?? '' },
          { header: 'Invoices', value: (row) => row.invoiceCount },
          { header: 'Units', value: (row) => row.quantity },
          { header: 'Net', value: (row) => csvMinor(row.netMinor) },
          { header: 'Returned', value: (row) => csvMinor(row.returnedMinor) },
          { header: 'Share %', value: (row) => (row.sharePercentBasisPoints / 100).toFixed(2) },
        ],
        report.data,
        range,
      );
      return;
    }
    res.json({ data: report });
  } catch (error) {
    next(error);
  }
}

export async function orders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const range = await scopedRange(req);
    const report = await orderFunnel(range);
    if (wantsCsv(req)) {
      sendCsv(
        res,
        'order-funnel',
        [
          { header: 'Period', value: (row) => row.bucket },
          { header: 'Submitted', value: (row) => row.submitted },
          { header: 'Approved', value: (row) => row.approved },
          { header: 'Delivered', value: (row) => row.delivered },
        ],
        report.series,
        range,
      );
      return;
    }
    res.json({ data: report });
  } catch (error) {
    next(error);
  }
}

export async function inventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = InventoryReportQuerySchema.parse(req.query);
    const report = await inventoryAnalytics({
      asOf: parsed.asOf,
      deadStockDays: parsed.deadStockDays,
    });
    if (wantsCsv(req)) {
      sendCsv(
        res,
        'inventory-valuation',
        [
          { header: 'Category', value: (row) => row.label },
          { header: 'Batches', value: (row) => row.batchCount },
          { header: 'On hand', value: (row) => row.onHand },
          { header: 'Available', value: (row) => row.available },
          { header: 'Cost value', value: (row) => csvMinor(row.costValueMinor) },
          { header: 'Retail value', value: (row) => csvMinor(row.retailValueMinor) },
        ],
        report.byCategory,
        { from: report.asOf.slice(0, 10), to: report.asOf.slice(0, 10) },
      );
      return;
    }
    res.json({ data: report });
  } catch (error) {
    next(error);
  }
}

export async function deliveries(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const range = await scopedRange(req);
    const report = await deliveryPerformance(range);
    if (wantsCsv(req)) {
      sendCsv(
        res,
        'delivery-performance',
        [
          { header: 'Delivery person', value: (row) => row.name },
          { header: 'Assigned', value: (row) => row.assigned },
          { header: 'Delivered', value: (row) => row.delivered },
          { header: 'Failed', value: (row) => row.failed },
          { header: 'On time', value: (row) => row.onTime },
          { header: 'Success %', value: (row) => (row.successBasisPoints / 100).toFixed(2) },
          { header: 'Collected', value: (row) => csvMinor(row.collectedMinor) },
        ],
        report.byPerson,
        range,
      );
      return;
    }
    res.json({ data: report });
  } catch (error) {
    next(error);
  }
}

export async function returns(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const range = await scopedRange(req);
    const report = await returnsAnalytics(range);
    if (wantsCsv(req)) {
      sendCsv(
        res,
        'returns-analysis',
        [
          { header: 'Reason', value: (row) => row.reason.replaceAll('_', ' ') },
          { header: 'Returns', value: (row) => row.returnCount },
          { header: 'Units', value: (row) => row.quantity },
          { header: 'Credited', value: (row) => csvMinor(row.creditedMinor) },
        ],
        report.byReason,
        range,
      );
      return;
    }
    res.json({ data: report });
  } catch (error) {
    next(error);
  }
}

export async function ageing(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = AgeingReportQuerySchema.parse(req.query);
    const report = await receivablesAgeing({ asOf: parsed.asOf });
    if (wantsCsv(req)) {
      sendCsv(
        res,
        'receivables-ageing',
        [
          { header: 'Shop', value: (row) => row.shopName },
          { header: 'Reference', value: (row) => row.shopReference },
          { header: 'Current', value: (row) => csvMinor(row.currentMinor) },
          { header: '1-30 days', value: (row) => csvMinor(row.days1to30Minor) },
          { header: '31-60 days', value: (row) => csvMinor(row.days31to60Minor) },
          { header: '61-90 days', value: (row) => csvMinor(row.days61to90Minor) },
          { header: '90+ days', value: (row) => csvMinor(row.days90PlusMinor) },
          { header: 'Total', value: (row) => csvMinor(row.totalMinor) },
        ],
        report.rows,
        { from: report.asOf.slice(0, 10), to: report.asOf.slice(0, 10) },
      );
      return;
    }
    res.json({ data: report });
  } catch (error) {
    next(error);
  }
}

export async function stockMovements(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await stockMovementSummary(await scopedRange(req)) });
  } catch (error) {
    next(error);
  }
}
