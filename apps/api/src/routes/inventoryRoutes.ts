import { Router } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { create as createWarehouse, listWarehouses } from '../controllers/warehouseController';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import {
  adjust,
  allocate,
  createMedicine,
  getBatch,
  getMedicine,
  getMedicineAlternatives,
  getMedicineContent,
  listCategories,
  listBatches,
  listMedicines,
  listMovements,
  operate,
  receive,
  setBatchBlock,
  updateMedicine,
} from '../controllers/inventoryController';

const router = Router();
router.use(requireAuth);

/*
 * A rep reads the catalogue, because order entry is a search over it.
 *
 * `SALES` was missing, and both order-entry screens — the web one from last
 * week and the mobile one — open with a search box that calls
 * `GET /inventory/medicines`. So a rep could reach the screen, choose a
 * customer, type a brand name and get a 403 on the one control the screen is
 * built around. Found by the roles reconciliation in `routeCoverage.test.ts`,
 * which is the same shape of defect as `GET /shops` being management-only.
 *
 * `DELIVERY_PERSON` is deliberately still absent: a rider carries what is on
 * the delivery note and has no reason to browse what else is for sale.
 */
const catalogueReaders = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STOREKEEPER,
  UserRole.SHOP_OWNER,
  UserRole.SALES,
];
const catalogueManagers = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
const stockReaders = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.STOREKEEPER];
const stockOperators = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STOREKEEPER,
];

router.get('/medicines', requireRole(catalogueReaders), listMedicines);
/*
 * The shelf hierarchy, for anyone who may read the catalogue. It is derived
 * from the products themselves, so it needs no separate permission: it says
 * exactly what a search over the same collection would already reveal.
 */
router.get('/categories', requireRole(catalogueReaders), listCategories);
router.post('/medicines', requireRole(catalogueManagers), createMedicine);
router.get('/medicines/:id', requireRole(catalogueReaders), getMedicine);
/*
 * Declared before the `:id` PATCH purely for readability; Express matches on
 * method as well as path, so the order of these two carries no meaning.
 */
router.get('/medicines/:id/alternatives', requireRole(catalogueReaders), getMedicineAlternatives);
/*
 * The monograph is catalogue text under the catalogue's rules: whoever may
 * read the line may read its copy, and the rider exclusion above carries over
 * unchanged.
 */
router.get('/medicines/:id/content', requireRole(catalogueReaders), getMedicineContent);
router.patch('/medicines/:id', requireRole(catalogueManagers), updateMedicine);
router.get('/batches', requireRole(stockReaders), listBatches);
router.post('/batches/receive', requireRole(stockOperators), receive);
/*
 * Warehouses.
 *
 * Under inventory rather than on their own mount: a warehouse is where stock
 * is, and every caller that cares is already talking to this router.
 */
router.get('/warehouses', requireRole(stockReaders), listWarehouses);
router.post('/warehouses', requireRole(catalogueManagers), createWarehouse);

router.get('/batches/:id', requireRole(stockReaders), getBatch);
router.post('/batches/:id/operations', requireRole(stockOperators), operate);
router.post('/batches/:id/adjust', requireRole(catalogueManagers), adjust);
router.patch('/batches/:id/block', requireRole(catalogueManagers), setBatchBlock);
router.post('/allocations/reserve', requireRole(catalogueManagers), allocate);
router.get('/movements', requireRole(stockReaders), listMovements);

export default router;
