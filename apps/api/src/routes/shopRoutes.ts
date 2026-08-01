import { Router } from 'express';
import {
  createShop,
  getShop,
  listShops,
  updateShop,
  assignOwner,
  assignManager,
  setShopStatus,
} from '../controllers/shopController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import { UserRole } from '@medsupply/shared-types';

const router = Router();
router.use(requireAuth);

const adminRoles = [UserRole.SUPER_ADMIN, UserRole.ADMIN];
const managementRoles = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
const allRoles = Object.values(UserRole);

router.get('/', requireRole(managementRoles as UserRole[]), listShops);
router.post('/', requireRole(adminRoles as UserRole[]), createShop);
router.get('/my', requireRole([UserRole.SHOP_OWNER]), async (req, res, next) => {
  // Convenience endpoint for shop owners
  req.params.id = ''; // will be resolved in listShops based on req.user
  listShops(req as any, res, next);
});

router.get('/:id', requireRole([...managementRoles, UserRole.SHOP_OWNER] as UserRole[]), getShop);
router.patch('/:id', requireRole(adminRoles as UserRole[]), updateShop);
router.post('/:id/assign-owner', requireRole(adminRoles as UserRole[]), assignOwner);
router.post('/:id/assign-manager', requireRole(adminRoles as UserRole[]), assignManager);
router.patch('/:id/status', requireRole(managementRoles as UserRole[]), setShopStatus);

export default router;
