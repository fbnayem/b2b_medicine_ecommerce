import { Router } from 'express';
import {
  addMyAddress,
  createShop,
  getShop,
  listShops,
  removeMyAddress,
  updateMyAddress,
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

/*
 * A shop maintains its own delivery addresses, and nothing else about itself.
 *
 * These sit under `/my` rather than opening `PATCH /:id` to owners, because
 * that endpoint also carries the credit limit, the payment terms, the discount,
 * the price list and the status — five things a customer must not be able to
 * set for themselves. The path is the scope.
 *
 * Declared before `/:id` for readability only; the segment counts differ, so
 * Express could not confuse them either way.
 */
const ownersOwn = [UserRole.SHOP_OWNER];
router.post('/my/addresses', requireRole(ownersOwn as UserRole[]), addMyAddress);
router.patch('/my/addresses/:addressId', requireRole(ownersOwn as UserRole[]), updateMyAddress);
router.delete('/my/addresses/:addressId', requireRole(ownersOwn as UserRole[]), removeMyAddress);

/*
 * And may open one of them.
 *
 * The list above was opened to `SALES` without this, so a rep saw their
 * customers and could not tap one — the navigation offered the screen, the
 * route refused it, and the person met an error with no way to tell whether the
 * system was broken or they were not allowed. `getShop` applies the same
 * territory rule the list does, so the detail is scoped exactly as tightly as
 * the list that leads to it.
 */
router.get(
  '/:id',
  requireRole([...managementRoles, UserRole.SALES, UserRole.SHOP_OWNER] as UserRole[]),
  getShop,
);
router.patch('/:id', requireRole(adminRoles as UserRole[]), updateShop);
router.post('/:id/assign-owner', requireRole(adminRoles as UserRole[]), assignOwner);
router.post('/:id/assign-manager', requireRole(adminRoles as UserRole[]), assignManager);
router.patch('/:id/status', requireRole(managementRoles as UserRole[]), setShopStatus);

export default router;
