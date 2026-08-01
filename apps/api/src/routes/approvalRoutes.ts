import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import {
  approve,
  clarify,
  hold,
  queue,
  reject,
  reviewDetail,
  start,
} from '../controllers/approvalController';
const router = Router();
router.use(requireAuth, requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]));
router.get('/queue', queue);
router.get('/:id', reviewDetail);
router.post('/:id/start', start);
router.post('/:id/hold', hold);
router.post('/:id/reject', reject);
router.post('/:id/clarify', clarify);
router.post('/:id/approve', approve);
export default router;
