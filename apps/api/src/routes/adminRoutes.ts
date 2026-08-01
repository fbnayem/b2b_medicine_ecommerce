import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import {
  auditActions,
  getUser,
  listAuditLog,
  listUsers,
  patchUser,
  resetUserPassword,
  revokeUserSessions,
} from '../controllers/adminController';
import { runtimeStatus } from '../controllers/healthController';

const router = Router();
router.use(requireAuth);

const administrators = [UserRole.SUPER_ADMIN, UserRole.ADMIN];
// Managers may see who holds which role, but may not change any account.
const readers = [...administrators, UserRole.MANAGER];

router.get('/users', requireRole(readers), listUsers);
router.get('/users/:id', requireRole(readers), getUser);
router.patch('/users/:id', requireRole(administrators), patchUser);
router.post('/users/:id/reset-password', requireRole(administrators), resetUserPassword);
router.post('/users/:id/revoke-sessions', requireRole(administrators), revokeUserSessions);
router.get('/audit', requireRole(administrators), listAuditLog);
router.get('/audit/actions', requireRole(administrators), auditActions);
// What the deployment is actually running and how its protections are tuned.
// Read-only, and it reports whether a control is on rather than its secret.
router.get('/runtime', requireRole(administrators), runtimeStatus);

export default router;
