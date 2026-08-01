import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  attachment,
  createPayment,
  fail,
  getPayment,
  handover,
  listPayments,
  myCollections,
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
router.get('/my-collections', requireRole([UserRole.DELIVERY_PERSON]), myCollections);
router.get('/:id/receipt', requireRole(readers), receipt);
router.get('/:id/attachment', requireRole(readers), attachment);
router.get('/:id', requireRole(readers), getPayment);
router.post('/:id/post', requireRole(finance), post);
router.post('/:id/fail', requireRole(finance), fail);
router.post('/:id/reverse', requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]), reverse);
router.post('/:id/handover', requireRole([UserRole.DELIVERY_PERSON]), handover);

export default router;
