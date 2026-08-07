import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  adjustment,
  collectionsReport,
  myCollectionHistory,
  myInvoices,
  myStatement,
  mySummary,
  outstandingReport,
  overdueReport,
  reconciliation,
  repairReconciliation,
  reservationBackfill,
  shopInvoices,
  shopLedger,
  shopStatement,
  shopSummary,
  summaryReport,
} from '../controllers/financeController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';

const router = Router();
router.use(requireAuth);
const finance = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
const administrators = [UserRole.SUPER_ADMIN, UserRole.ADMIN];
router.get('/my/summary', requireRole([UserRole.SHOP_OWNER]), mySummary);
router.get('/my/invoices', requireRole([UserRole.SHOP_OWNER]), myInvoices);
router.get('/my/statement', requireRole([UserRole.SHOP_OWNER]), myStatement);
router.get('/my/collections', requireRole([UserRole.DELIVERY_PERSON]), myCollectionHistory);
/*
 * A representative may read what a customer owes, and nothing else about it.
 *
 * They stand at a counter deciding whether to take an order, and the three
 * figures that decide it — owed, overdue, credit left — were management-only,
 * so the answer was a telephone call to the office. The **ledger, the invoices
 * and the statement stay closed to them**: those are the documents a
 * conversation about money is had from, and that conversation is a manager's.
 *
 * The controller applies the same territory rule `listShops` and `getShop` do.
 * Opening the route without it would let a rep read any customer in the country
 * by pasting an id, which is scoping that only looks like scoping.
 */
router.get('/shops/:shopId/summary', requireRole([...finance, UserRole.SALES]), shopSummary);
router.get('/shops/:shopId/invoices', requireRole(finance), shopInvoices);
router.get('/shops/:shopId/ledger', requireRole(finance), shopLedger);
router.get('/shops/:shopId/statement', requireRole(finance), shopStatement);
router.get('/reports/summary', requireRole(finance), summaryReport);
router.get('/reports/outstanding', requireRole(finance), outstandingReport);
router.get('/reports/overdue', requireRole(finance), overdueReport);
router.get('/reports/collections', requireRole(finance), collectionsReport);
router.post('/adjustments', requireRole(administrators), adjustment);
router.post('/credit-reservations/backfill', requireRole(administrators), reservationBackfill);
router.get('/reconciliation/:shopId', requireRole(finance), reconciliation);
router.post('/reconciliation/:shopId/repair', requireRole(administrators), repairReconciliation);

export default router;
