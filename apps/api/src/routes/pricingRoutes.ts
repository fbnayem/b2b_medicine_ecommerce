import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  getPriceListDetail,
  getPriceLists,
  getSchemeDetail,
  getSchemes,
  patchPriceList,
  patchScheme,
  postPriceList,
  postScheme,
} from '../controllers/pricingController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';

const router = Router();
router.use(requireAuth);

const management = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];

/**
 * A rep reads the terms; a manager sets them.
 *
 * Reading is what makes `SALES` usable — quoting a customer means knowing what
 * they pay and what offer is running, and a rep who has to ask somebody else
 * quotes from memory. Writing stays with management because a price list is the
 * revenue of every order placed after it.
 */
const readers = [...management, UserRole.SALES];

router.get('/price-lists', requireRole(readers), getPriceLists);
router.post('/price-lists', requireRole(management), postPriceList);
router.get('/price-lists/:id', requireRole(readers), getPriceListDetail);
router.patch('/price-lists/:id', requireRole(management), patchPriceList);

router.get('/schemes', requireRole(readers), getSchemes);
router.post('/schemes', requireRole(management), postScheme);
router.get('/schemes/:id', requireRole(readers), getSchemeDetail);
router.patch('/schemes/:id', requireRole(management), patchScheme);

export default router;
