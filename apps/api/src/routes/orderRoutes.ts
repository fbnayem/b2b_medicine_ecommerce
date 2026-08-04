import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import {
  deleteDraft,
  duplicateOrder,
  getOrder,
  listOrders,
  decideCancellationRequest,
  requestCancellation,
  saveDraft,
  submitOrder,
  updateDraft,
} from '../controllers/orderController';
const router = Router();
router.use(requireAuth);
const readers = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.SALES,
  UserRole.SHOP_OWNER,
];
/*
 * Who may place an order at all.
 *
 * These were `SHOP_OWNER`-only, so the volume that actually arrives in this
 * trade — by phone, by WhatsApp, through a rep with a paper book — had no path
 * in. The route opens it to the roles that can act for somebody else; the
 * service decides whether this actor may act for *that* shop, because a route
 * guard is not where a territory rule belongs.
 */
const placers = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.SALES,
  UserRole.SHOP_OWNER,
];
router.get('/', requireRole(readers), listOrders);
router.post('/drafts', requireRole(placers), saveDraft);
router.patch('/drafts/:id', requireRole(placers), updateDraft);
router.delete('/drafts/:id', requireRole(placers), deleteDraft);
router.post('/submit', requireRole(placers), submitOrder);
router.post('/drafts/:id/submit', requireRole(placers), submitOrder);
router.get('/:id', requireRole(readers), getOrder);
router.post('/:id/duplicate', requireRole(placers), duplicateOrder);
router.post('/:id/cancellation-request', requireRole([UserRole.SHOP_OWNER]), requestCancellation);
// The decision the request never had. Management only; the service checks the
// role again, because a route guard is not where a money-shaped rule belongs.
router.post(
  '/:id/cancellation-decision',
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]),
  decideCancellationRequest,
);
export default router;
