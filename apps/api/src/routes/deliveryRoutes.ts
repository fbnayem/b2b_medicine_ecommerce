import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import {
  acknowledge,
  arrived,
  assign,
  cancel,
  complete,
  deliveryPersonnel,
  failed,
  getDelivery,
  getOrderDelivery,
  handover,
  listDeliveries,
  pickup,
  proofFile,
  returned,
  returning,
  sendOtp,
  start,
} from '../controllers/deliveryController';

const router = Router();
router.use(requireAuth);
const readers = Object.values(UserRole);
const managers = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
router.get('/', requireRole(readers), listDeliveries);
router.get('/personnel', requireRole(managers), deliveryPersonnel);
router.get('/order/:orderId', requireRole(readers), getOrderDelivery);
router.get('/proof/:fileId', requireRole(readers), proofFile);
router.get('/:id', requireRole(readers), getDelivery);
router.post('/:id/assign', requireRole(managers), assign);
router.post('/:id/handover', requireRole([UserRole.STOREKEEPER]), handover);
router.post('/:id/acknowledge', requireRole([UserRole.DELIVERY_PERSON]), acknowledge);
router.post('/:id/pickup', requireRole([UserRole.DELIVERY_PERSON]), pickup);
router.post('/:id/start', requireRole([UserRole.DELIVERY_PERSON]), start);
router.post('/:id/arrived', requireRole([UserRole.DELIVERY_PERSON]), arrived);
router.post('/:id/send-otp', requireRole([UserRole.DELIVERY_PERSON]), sendOtp);
router.post('/:id/complete', requireRole([UserRole.DELIVERY_PERSON]), complete);
router.post('/:id/fail', requireRole([UserRole.DELIVERY_PERSON]), failed);
router.post('/:id/returning', requireRole([...managers, UserRole.DELIVERY_PERSON]), returning);
router.post('/:id/returned', requireRole([UserRole.STOREKEEPER]), returned);
router.post('/:id/cancel', requireRole(managers), cancel);

export default router;
