import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  cancel,
  getTrip,
  listTrips,
  plan,
  plannable,
  resequence,
  start,
} from '../controllers/tripController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';

const router = Router();
router.use(requireAuth);

const management = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
/** A rider reads their own round; the office plans it. */
const riders = [...management, UserRole.DELIVERY_PERSON];

router.get('/', requireRole(riders), listTrips);
router.get('/plannable', requireRole(management), plannable);
router.get('/:id', requireRole(riders), getTrip);

router.post('/', requireRole(management), plan);
router.post('/:id/sequence', requireRole(management), resequence);

/*
 * The rider starts their own round. It is a statement about where they are —
 * "I have left" — and nobody in the office is in a position to make it.
 */
router.post('/:id/start', requireRole(riders), start);
router.post('/:id/cancel', requireRole(management), cancel);

export default router;
