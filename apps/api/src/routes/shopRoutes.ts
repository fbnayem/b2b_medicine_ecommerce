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

/*
 * A rep reads the customer list, because it is their order-entry picker.
 *
 * This was management-only, so `SALES` — the role added specifically to take
 * orders for somebody else — could not list a single shop, and the order-entry
 * screen opened with a picker that answered 403. The controller narrows the
 * result to the rep's own territories using the same rule the submission
 * enforces, so the list and `POST /orders/submit` cannot disagree about which
 * customers are theirs.
 */
const shopReaders = [...managementRoles, UserRole.SALES];

router.get('/', requireRole(shopReaders as UserRole[]), listShops);
router.post('/', requireRole(adminRoles as UserRole[]), createShop);
// `listShops` already returns only the signed-in owner's shop; this is the name
// the shop-owner clients ask for.
router.get('/my', requireRole([UserRole.SHOP_OWNER]), listShops);

router.get('/:id', requireRole([...managementRoles, UserRole.SHOP_OWNER] as UserRole[]), getShop);
router.patch('/:id', requireRole(adminRoles as UserRole[]), updateShop);
router.post('/:id/assign-owner', requireRole(adminRoles as UserRole[]), assignOwner);
router.post('/:id/assign-manager', requireRole(adminRoles as UserRole[]), assignManager);
router.patch('/:id/status', requireRole(managementRoles as UserRole[]), setShopStatus);

export default router;
