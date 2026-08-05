import { Router } from 'express';
import { getMe, listUsers, createUser } from '../controllers/userController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import { UserRole } from '@medsupply/shared-types';

const router = Router();

router.use(requireAuth);

router.get('/me', getMe);
router.get('/', requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]), listUsers);
/*
 * A manager may create an account, and `assertAdministrable` decides which.
 *
 * Trip planning and delivery assignment are `MANAGEMENT`, so until now the
 * person who needed a delivery person was exactly the person who could not
 * make one. The guard here is deliberately the wide one: *which* roles a
 * manager may grant is a rule about privilege, and that rule lives in one
 * place — restating it as a route list would be a second source of truth about
 * authorisation, and the one that disagrees quietly is the dangerous one.
 */
router.post('/', requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]), createUser);

export default router;
