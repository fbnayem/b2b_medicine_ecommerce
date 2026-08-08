import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  attachment,
  createPayment,
  fail,
  getPayment,
  handover,
  listPayments,
  post,
  receipt,
  reverse,
} from '../controllers/paymentController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';

const router = Router();
router.use(requireAuth);
const readers = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.DELIVERY_PERSON,
  UserRole.SHOP_OWNER,
];
const finance = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
router.get('/', requireRole(readers), listPayments);
router.post('/', requireRole(finance), createPayment);
/*
 * `GET /my-collections` was here and is gone.
 *
 * It was a byte-for-byte duplicate of `GET /finance/my/collections` — same
 * `getCollectorSummary` call, same paging, same `DELIVERY_PERSON` guard — and
 * no client ever called it. Two paths answering one question is two things to
 * keep in step, two entries in the specification and two doors to defend, for
 * a capability that already had a door. The mobile rider screen has always
 * used the finance path; the removed handler had no other caller.
 */
router.get('/:id/receipt', requireRole(readers), receipt);
router.get('/:id/attachment', requireRole(readers), attachment);
router.get('/:id', requireRole(readers), getPayment);
router.post('/:id/post', requireRole(finance), post);
router.post('/:id/fail', requireRole(finance), fail);
router.post('/:id/reverse', requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]), reverse);
router.post('/:id/handover', requireRole([UserRole.DELIVERY_PERSON]), handover);

export default router;
