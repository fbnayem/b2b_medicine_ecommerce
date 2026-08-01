import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import {
  archive,
  catalogue,
  deliveries,
  getPreferences,
  listNotifications,
  markAllRead,
  markRead,
  registerDevice,
  testSend,
  unreadCount,
  unregisterDevice,
  updatePreferences,
} from '../controllers/notificationController';

const router = Router();
router.use(requireAuth);

// Every authenticated role owns a notification inbox; reads are scoped to the caller.
const everyone = Object.values(UserRole);
const admins = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

router.get('/', requireRole(everyone), listNotifications);
router.get('/unread-count', requireRole(everyone), unreadCount);
router.get('/catalogue', requireRole(everyone), catalogue);
router.get('/preferences', requireRole(everyone), getPreferences);
router.put('/preferences', requireRole(everyone), updatePreferences);
router.post('/read', requireRole(everyone), markRead);
router.post('/read-all', requireRole(everyone), markAllRead);
router.post('/archive', requireRole(everyone), archive);
router.post('/devices', requireRole(everyone), registerDevice);
router.delete('/devices', requireRole(everyone), unregisterDevice);
router.get('/:id/deliveries', requireRole(admins), deliveries);
router.post('/test', requireRole(admins), testSend);

export default router;
