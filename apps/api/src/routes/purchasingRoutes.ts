import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  batchLookup,
  batchTrace,
  controlledRegister,
  createSupplier,
  getPurchaseOrder,
  listPurchaseOrders,
  listSuppliers,
  raisePurchaseOrder,
  receiveAgainstOrder,
} from '../controllers/purchasingController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';

const router = Router();
router.use(requireAuth);

const management = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
/** The storekeeper counts the cartons on the bay, so the storekeeper books them in. */
const warehouse = [...management, UserRole.STOREKEEPER];

router.get('/suppliers', requireRole(warehouse), listSuppliers);
router.post('/suppliers', requireRole(management), createSupplier);

router.get('/orders', requireRole(warehouse), listPurchaseOrders);
router.post('/orders', requireRole(management), raisePurchaseOrder);
router.get('/orders/:id', requireRole(warehouse), getPurchaseOrder);
router.post('/orders/:id/receipts', requireRole(warehouse), receiveAgainstOrder);

/*
 * The recall trace.
 *
 * Open to the warehouse as well as management: the person who first hears that
 * a batch is suspect is often the storekeeper holding the supplier's notice,
 * and making them find a manager before they can even look it up is how an hour
 * gets lost. Looking has no side effects.
 */
router.get('/recall/batches', requireRole(warehouse), batchLookup);
router.get('/recall/batches/:batchId', requireRole(warehouse), batchTrace);

/*
 * The controlled-substance movement return. Management only: it is a
 * regulatory document, and producing one is a different act from looking a
 * batch up.
 */
router.get('/controlled-register', requireRole(management), controlledRegister);

export default router;
