import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  cancel,
  collect,
  create,
  creditNote,
  decide,
  detail,
  issueCredit,
  list,
  receive,
  reject,
  startReview,
} from '../controllers/returnController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';

const router = Router();
router.use(requireAuth);

const management = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
const requesters = [...management, UserRole.SHOP_OWNER];
const warehouse = [...management, UserRole.STOREKEEPER];
const collectors = [...management, UserRole.DELIVERY_PERSON];
// Everyone who can act on a return may also read one; the service narrows a
// Shop Owner to their own records.
const readers = [
  ...management,
  UserRole.SHOP_OWNER,
  UserRole.STOREKEEPER,
  UserRole.DELIVERY_PERSON,
];

router.get('/', requireRole(readers), list);
router.post('/', requireRole(requesters), create);
router.get('/credit-notes/:id', requireRole(readers), creditNote);
router.get('/:id', requireRole(readers), detail);
router.post('/:id/review', requireRole(management), startReview);
router.post('/:id/decision', requireRole(management), decide);
router.post('/:id/reject', requireRole(management), reject);
router.post('/:id/cancel', requireRole(requesters), cancel);
router.post('/:id/collect', requireRole(collectors), collect);
router.post('/:id/receive', requireRole(warehouse), receive);
router.post('/:id/credit-note', requireRole(management), issueCredit);

export default router;
