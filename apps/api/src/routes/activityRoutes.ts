import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import { feed, timeline } from '../controllers/activityController';

const router = Router();
router.use(requireAuth);

// Results are visibility-filtered per record, so every role may call these.
const everyone = Object.values(UserRole);

router.get('/', requireRole(everyone), feed);
router.get('/timeline', requireRole(everyone), timeline);

export default router;
