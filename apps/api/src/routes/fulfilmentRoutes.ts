import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import {
  detail,
  discrepancy,
  invoice,
  pack,
  pdf,
  progress,
  queue,
  ready,
  resolveDiscrepancy,
  resume,
  start,
} from '../controllers/fulfilmentController';

const router = Router();
const internalRoles = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STOREKEEPER,
];

router.use(requireAuth);
router.get('/queue', requireRole(internalRoles), queue);
router.get('/ready', requireRole(internalRoles), ready);
router.get('/picking/:id', requireRole(internalRoles), detail);
router.post('/picking/:id/start', requireRole([UserRole.STOREKEEPER]), start);
router.post('/picking/:id/progress', requireRole([UserRole.STOREKEEPER]), progress);
router.post('/picking/:id/resume', requireRole([UserRole.STOREKEEPER]), resume);
router.post('/picking/:id/discrepancies', requireRole([UserRole.STOREKEEPER]), discrepancy);
router.post(
  '/picking/:id/discrepancies/resolve',
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]),
  resolveDiscrepancy,
);
router.post('/picking/:id/pack', requireRole([UserRole.STOREKEEPER]), pack);
router.get('/invoices/:id', requireRole([...internalRoles, UserRole.SHOP_OWNER]), invoice);
router.get('/invoices/:id/pdf', requireRole([...internalRoles, UserRole.SHOP_OWNER]), pdf);

export default router;
