import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  ageing,
  deliveries,
  inventory,
  orders,
  overview,
  returns,
  sales,
  salesBreakdown,
  stockMovements,
} from '../controllers/reportController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';

const router = Router();
router.use(requireAuth);

const management = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
// A Shop Owner sees the same sales and returns reports narrowed to their shop.
const withOwner = [...management, UserRole.SHOP_OWNER];
const withStore = [...management, UserRole.STOREKEEPER];

router.get('/overview', requireRole(management), overview);
router.get('/sales', requireRole(withOwner), sales);
router.get('/sales/breakdown', requireRole(withOwner), salesBreakdown);
router.get('/orders', requireRole(withOwner), orders);
router.get('/inventory', requireRole(withStore), inventory);
router.get('/deliveries', requireRole(management), deliveries);
router.get('/returns', requireRole(withOwner), returns);
router.get('/receivables-ageing', requireRole(management), ageing);
router.get('/stock-movements', requireRole(withStore), stockMovements);

export default router;
