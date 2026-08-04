import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  abandon,
  count,
  getStocktake,
  listStocktakes,
  open,
  post,
  submit,
} from '../controllers/stocktakeController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';

const router = Router();
router.use(requireAuth);

const management = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
/** The storekeeper walks the aisle, so the storekeeper counts. */
const warehouse = [...management, UserRole.STOREKEEPER];

router.get('/', requireRole(warehouse), listStocktakes);
router.post('/', requireRole(warehouse), open);
router.get('/:id', requireRole(warehouse), getStocktake);
router.post('/:id/counts', requireRole(warehouse), count);
router.post('/:id/submit', requireRole(warehouse), submit);

/*
 * Posting is management, and counting is not.
 *
 * The whole value of a stocktake as a control is that the person who counted is
 * not the person who accepted the count. Letting a storekeeper post their own
 * variance would make the sheet a record of what they said rather than of what
 * was agreed.
 */
router.post('/:id/post', requireRole(management), post);
router.post('/:id/abandon', requireRole(management), abandon);

export default router;
