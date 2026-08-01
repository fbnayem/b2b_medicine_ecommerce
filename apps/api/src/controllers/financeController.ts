import mongoose from 'mongoose';
import { NextFunction, Response } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { CreditReservationBackfillSchema, LedgerAdjustmentSchema } from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import { Shop } from '../models/Shop';
import {
  getCollectionReport,
  getCollectorSummary,
  getCreditSummary,
  getFinanceDashboardSummary,
  getLedger,
  getOutstandingReport,
  getOverdueReport,
  getStatement,
  invoiceBalanceRows,
  reconcileShopFinance,
  backfillCreditReservation,
} from '../services/financeService';
import { dhakaDateString, dhakaDayBoundary, postLedgerAdjustment } from '../services/ledgerService';
import { createSimplePdf } from '../services/pdfService';
import { businessSettings } from '../services/settingsService';
import { correlationId } from '../services/logger';

const actor = (req: AuthRequest) => ({
  _id: req.user!._id,
  role: req.user!.role as UserRole,
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
  correlationId: correlationId(),
});

async function myShop(req: AuthRequest) {
  const shop = await Shop.findOne({ ownerIds: req.user!._id }).select('_id');
  if (!shop)
    throw Object.assign(new Error('No shop account is assigned to this user'), {
      statusCode: 404,
      code: 'SHOP_NOT_FOUND',
    });
  return String(shop._id);
}

function statementDates(req: AuthRequest) {
  const to = String(req.query.to ?? dhakaDateString());
  const from = String(req.query.from ?? `${to.slice(0, 8)}01`);
  return { from, to };
}

async function sendStatement(req: AuthRequest, res: Response, shopId: string) {
  const dates = statementDates(req);
  const data = await getStatement(shopId, dates.from, dates.to);
  if (req.query.format === 'pdf') {
    const business = await businessSettings();
    const pdf = createSimplePdf([
      business.name,
      'CUSTOMER STATEMENT',
      `Shop: ${data.shop.reference} ${data.shop.name}`,
      `Period: ${data.from} to ${data.to}`,
      `Opening: BDT ${(data.openingBalanceMinor / 100).toFixed(2)}`,
      ...data.rows.map(
        (row) =>
          `${new Date(row.date).toISOString().slice(0, 10)} ${row.reference} Dr ${(row.debitMinor / 100).toFixed(2)} Cr ${(row.creditMinor / 100).toFixed(2)} Bal ${(row.balanceMinor / 100).toFixed(2)}`,
      ),
      `Closing: BDT ${(data.closingBalanceMinor / 100).toFixed(2)}`,
    ]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="statement-${data.shop.reference}-${data.from}-${data.to}.pdf"`,
    );
    res.send(pdf);
    return;
  }
  res.json({ data });
}

export async function mySummary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await getCreditSummary(await myShop(req)) });
  } catch (error) {
    next(error);
  }
}

export async function myInvoices(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await invoiceBalanceRows(await myShop(req), {
      page: Math.max(1, Number(req.query.page) || 1),
      limit: Math.min(100, Math.max(1, Number(req.query.limit) || 30)),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function myStatement(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await sendStatement(req, res, await myShop(req));
  } catch (error) {
    next(error);
  }
}

export async function myCollectionHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      data: await getCollectorSummary(
        String(req.user!._id),
        Math.max(1, Number(req.query.page) || 1),
        Math.min(100, Math.max(1, Number(req.query.limit) || 30)),
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function shopSummary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await getCreditSummary(String(req.params.shopId)) });
  } catch (error) {
    next(error);
  }
}

export async function shopInvoices(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await invoiceBalanceRows(String(req.params.shopId), {
      page: Math.max(1, Number(req.query.page) || 1),
      limit: Math.min(100, Math.max(1, Number(req.query.limit) || 30)),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function shopLedger(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await getLedger(
      String(req.params.shopId),
      Math.max(1, Number(req.query.page) || 1),
      Math.min(100, Math.max(1, Number(req.query.limit) || 50)),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function shopStatement(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await sendStatement(req, res, String(req.params.shopId));
  } catch (error) {
    next(error);
  }
}

export async function summaryReport(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await getFinanceDashboardSummary() });
  } catch (error) {
    next(error);
  }
}

export async function outstandingReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await getOutstandingReport(
      req.query.asOf ? dhakaDayBoundary(String(req.query.asOf), true) : new Date(),
    );
    res.json({ data: result.data, meta: result.summary });
  } catch (error) {
    next(error);
  }
}

export async function overdueReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await getOverdueReport(
      req.query.asOf ? dhakaDayBoundary(String(req.query.asOf), true) : new Date(),
    );
    res.json({ data: result.data, meta: result.summary });
  } catch (error) {
    next(error);
  }
}

export async function collectionsReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await getCollectionReport({
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      collectedBy: req.query.collectedBy ? String(req.query.collectedBy) : undefined,
      shopId: req.query.shopId ? String(req.query.shopId) : undefined,
      page: Math.max(1, Number(req.query.page) || 1),
      limit: Math.min(100, Math.max(1, Number(req.query.limit) || 30)),
    });
    res.json({ data: result.data, meta: { ...result.meta, ...result.summary } });
  } catch (error) {
    next(error);
  }
}

export async function adjustment(req: AuthRequest, res: Response, next: NextFunction) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await postLedgerAdjustment(
        LedgerAdjustmentSchema.parse(req.body),
        actor(req),
        session,
      );
    });
    res.status(result!.idempotentReplay ? 200 : 201).json({
      data: result!.transaction,
      meta: { idempotentReplay: result!.idempotentReplay },
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
}

export async function reconciliation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const shopId = String(req.params.shopId ?? req.query.shopId ?? '');
    if (!shopId)
      throw Object.assign(new Error('shopId is required'), {
        statusCode: 400,
        code: 'SHOP_REQUIRED',
      });
    res.json({ data: await reconcileShopFinance(shopId, actor(req), false) });
  } catch (error) {
    next(error);
  }
}

export async function repairReconciliation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await reconcileShopFinance(String(req.params.shopId), actor(req), true) });
  } catch (error) {
    next(error);
  }
}

export async function reservationBackfill(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await backfillCreditReservation(
      CreditReservationBackfillSchema.parse(req.body),
      actor(req),
    );
    res.status(result.idempotentReplay ? 200 : 201).json({
      data: result.reservation,
      meta: { idempotentReplay: result.idempotentReplay },
    });
  } catch (error) {
    next(error);
  }
}
