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
router.get('/shops/:shopId/summary', requireRole(finance), shopSummary);
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
