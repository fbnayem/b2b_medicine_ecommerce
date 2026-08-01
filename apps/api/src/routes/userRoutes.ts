import { Router } from 'express';
import { getMe, listUsers, createUser } from '../controllers/userController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import { UserRole } from '@medsupply/shared-types';

const router = Router();

router.use(requireAuth);

router.get('/me', getMe);
router.get('/', requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]), listUsers);
router.post('/', requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]), createUser);

export default router;
