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
const readers = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.SHOP_OWNER];
router.get('/', requireRole(readers), listOrders);
router.post('/drafts', requireRole([UserRole.SHOP_OWNER]), saveDraft);
router.patch('/drafts/:id', requireRole([UserRole.SHOP_OWNER]), updateDraft);
router.delete('/drafts/:id', requireRole([UserRole.SHOP_OWNER]), deleteDraft);
router.post('/submit', requireRole([UserRole.SHOP_OWNER]), submitOrder);
router.post('/drafts/:id/submit', requireRole([UserRole.SHOP_OWNER]), submitOrder);
router.get('/:id', requireRole(readers), getOrder);
router.post('/:id/duplicate', requireRole([UserRole.SHOP_OWNER]), duplicateOrder);
router.post('/:id/cancellation-request', requireRole([UserRole.SHOP_OWNER]), requestCancellation);
// The decision the request never had. Management only; the service checks the
// role again, because a route guard is not where a money-shaped rule belongs.
router.post(
  '/:id/cancellation-decision',
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]),
  decideCancellationRequest,
);
export default router;
