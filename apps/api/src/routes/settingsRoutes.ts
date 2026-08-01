import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import {
  branding,
  listSettings,
  resetSettings,
  updateSettings,
} from '../controllers/settingsController';

const router = Router();
router.use(requireAuth);

const administrators = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

// Branding and display formatting are safe for every signed-in role.
router.get('/branding', requireRole(Object.values(UserRole)), branding);
router.get('/', requireRole(administrators), listSettings);
router.put('/:group', requireRole(administrators), updateSettings);
router.post('/:group/reset', requireRole(administrators), resetSettings);

export default router;
