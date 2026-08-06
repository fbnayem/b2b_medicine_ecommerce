import { z } from 'zod';
import {
  AdminPasswordResetSchema,
  AbandonStocktakeSchema,
  CancelTripSchema,
  CreatePurchaseOrderSchema,
  CreateWarehouseSchema,
  OpenStocktakeSchema,
  PlanTripSchema,
  PostStocktakeSchema,
  RecordCountsSchema,
  ResequenceTripSchema,
  StartTripSchema,
  SubmitStocktakeSchema,
  CreateSupplierSchema,
  ReceiveGoodsSchema,
  CancellationDecisionSchema,
  CancellationRequestSchema,
  ChangePasswordSchema,
  DeliveryAddressSchema,
  RegisterShopSchema,
  UpdateDeliveryAddressSchema,
  AdminUserUpdateSchema,
  ApprovalSchema,
  CreateMedicineSchema,
  CreatePaymentSchema,
  CreatePriceListSchema,
  CreateSchemeSchema,
  QuoteOrderSchema,
  UpdatePriceListSchema,
  UpdateSchemeSchema,
  CreateReturnSchema,
  CreateShopSchema,
  CreateUserSchema,
  CreditNoteIssueSchema,
  DeliveryAssignmentSchema,
  DeliveryCompletionSchema,
  DeliveryFailureSchema,
  LedgerAdjustmentSchema,
  LoginSchema,
  PackingSchema,
  PaymentPostSchema,
  PaymentReverseSchema,
  ReceiveStockSchema,
  RejectOrderSchema,
  ReturnDecisionSchema,
  ReturnReceiptSchema,
  SettingsUpdateSchema,
  SubmitOrderSchema,
  AdjustmentSchema,
  BatchBlockSchema,
  AdminSessionRevokeSchema,
  AllocationSchema,
  CreditReservationBackfillSchema,
  DeliveryHandoverSchema,
  DeliverySimpleActionSchema,
  DiscrepancyResolutionSchema,
  DiscrepancySchema,
  HoldOrderSchema,
  NotificationIdsSchema,
  NotificationMarkAllReadSchema,
  NotificationPreferenceUpdateSchema,
  NotificationTestSendSchema,
  PaymentFailSchema,
  PaymentHandoverSchema,
  PickingActionSchema,
  PickingProgressSchema,
  PushDeviceRegisterSchema,
  PushDeviceUnregisterSchema,
  ReturnCancelSchema,
  ReturnCollectionSchema,
  ReturnRejectionSchema,
  ReturnReviewStartSchema,
  ReviewVersionSchema,
  SaveOrderDraftSchema,
  SettingsResetSchema,
  StockOperationSchema,
  UpdateMedicineSchema,
  UpdateShopSchema,
} from '@medsupply/validation';
import { UserRole } from '@medsupply/shared-types';

/**
 * Read directly rather than through the validated environment.
 *
 * Generating the specification is a documentation task and must work from a
 * checkout, without a database URI or a signing secret. Importing `env` would
 * make `pnpm openapi` refuse to run outside a configured deployment.
 */
const version = process.env.APP_VERSION ?? '1.0.0';

/**
 * The OpenAPI 3.1 description of this API.
 *
 * It is generated from the same Zod schemas the server validates with, so a
 * request body documented here is the request body that is actually enforced —
 * a hand-maintained specification drifts from the implementation within a
 * release or two, and a wrong specification is worse than none.
 *
 * The route table is declared rather than reflected off the Express router:
 * Express knows a path and a method but nothing about who may call it or what
 * it means, and the permission column is the part a reader most needs.
 */

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface Operation {
  method: Method;
  path: string;
  summary: string;
  tag: string;
  /** Empty means the endpoint is reachable without signing in. */
  roles?: UserRole[];
  body?: z.ZodType;
  /** Query parameters worth naming; the full set is validated server-side. */
  query?: string[];
  /** Response media type when it is not JSON. */
  produces?: string;
}

const ALL_ROLES = Object.values(UserRole);
const MANAGEMENT = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
const ADMINS = [UserRole.SUPER_ADMIN, UserRole.ADMIN];
const RANGE = ['from', 'to', 'granularity', 'shopId', 'format'];

/**
 * Exported so the reconciliation test can read the **roles** column.
 *
 * `buildOpenApiDocument()` renders the roles into a prose sentence in each
 * operation's description, which is right for a reader and useless to a check.
 * The list itself is the thing that has now drifted from the mounted route
 * twice — order submission stayed documented as `SHOP_OWNER`-only for a phase
 * after it opened to `SALES`, and `GET /shops` claimed every role while the
 * router allowed three — so it has to be readable as data.
 */
export const OPERATIONS: Operation[] = [
  // ── Health ────────────────────────────────────────────────────────────────
  { method: 'get', path: '/health', summary: 'Liveness probe', tag: 'Health' },
  {
    method: 'get',
    path: '/health/ready',
    summary: 'Readiness probe including the database',
    tag: 'Health',
  },
  { method: 'get', path: '/health/version', summary: 'Deployed version and commit', tag: 'Health' },
  {
    method: 'get',
    path: '/metrics',
    summary: 'Prometheus metrics, including the ledger-imbalance gauge',
    tag: 'Health',
  },
  {
    method: 'get',
    path: '/api/v1/admin/runtime',
    summary: 'Effective security and performance configuration',
    tag: 'Health',
    roles: ADMINS,
  },

  // ── Authentication ────────────────────────────────────────────────────────
  {
    method: 'post',
    path: '/api/v1/auth/login',
    summary: 'Sign in and open a session',
    tag: 'Authentication',
    body: LoginSchema,
  },
  {
    method: 'post',
    path: '/api/v1/auth/refresh',
    summary: 'Rotate the refresh token and issue a new access token',
    tag: 'Authentication',
  },
  {
    /*
     * No `roles`, which is how this document says "reachable without signing
     * in" — and the only write in the API that is. It creates an ACTIVE shop
     * with a credit limit of zero, no payment terms, no discount and no price
     * list, so it can trade prepaid while every credit order it places is
     * refused at approval until a manager sets terms deliberately.
     */
    method: 'post',
    path: '/api/v1/auth/register',
    summary: 'Register a pharmacy and its first owner, on prepaid terms only',
    tag: 'Authentication',
    body: RegisterShopSchema,
  },
  {
    method: 'post',
    path: '/api/v1/auth/logout',
    summary: 'End the current session',
    tag: 'Authentication',
    roles: ALL_ROLES,
  },
  {
    method: 'post',
    path: '/api/v1/auth/logout-all',
    summary: 'End every session for the signed-in user',
    tag: 'Authentication',
    roles: ALL_ROLES,
  },
  {
    method: 'get',
    path: '/api/v1/auth/sessions',
    summary: 'List the signed-in user’s own sessions',
    tag: 'Authentication',
    roles: ALL_ROLES,
  },
  {
    method: 'delete',
    path: '/api/v1/auth/sessions/{id}',
    summary: 'Revoke one of the signed-in user’s sessions',
    tag: 'Authentication',
    roles: ALL_ROLES,
  },

  // ── Users and shops ───────────────────────────────────────────────────────
  { method: 'get', path: '/api/v1/users', summary: 'List users', tag: 'Users', roles: MANAGEMENT },
  {
    method: 'post',
    path: '/api/v1/users',
    summary: 'Create a user',
    /*
     * `MANAGEMENT`, with a narrower rule inside. The route admits a manager;
     * `assertAdministrable` then permits them exactly DELIVERY_PERSON and
     * STOREKEEPER and refuses everything else — including their own role, which
     * is not privileged and would otherwise pass. The document states who may
     * call it, which is what a caller needs; which roles they may then grant is
     * a rule about privilege and lives in one place.
     */
    tag: 'Users',
    roles: MANAGEMENT,
    body: CreateUserSchema,
  },
  {
    method: 'get',
    path: '/api/v1/shops',
    summary: 'The customer list, narrowed to the caller’s own territories',
    tag: 'Shops',
    // Not every role: a shop owner uses `/shops/my`, and the warehouse and
    // delivery roles have no business reading the customer book at all. This
    // said ALL_ROLES while the route said management-only — the drift the role
    // reconciliation assertion is being added to catch.
    roles: [...MANAGEMENT, UserRole.SALES],
    // `awaitingTerms=true` narrows to the shops that registered themselves and
    // still have no credit limit and no payment terms — the queue a manager
    // works so that a self-registered customer is met deliberately rather than
    // discovered as a refused order.
    query: ['status', 'territory', 'search', 'awaitingTerms', 'page', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/shops/{id}',
    summary: 'One customer, if the caller may act for them',
    tag: 'Shops',
    // A rep opens a customer from the list above, which is already narrowed to
    // their territories; the handler applies the same rule, so the detail is
    // scoped exactly as tightly as the list that leads to it. A shop owner
    // reaches only their own record.
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
  },
  {
    method: 'post',
    path: '/api/v1/shops',
    summary: 'Register a shop',
    tag: 'Shops',
    roles: ADMINS,
    body: CreateShopSchema,
  },

  // ── Catalogue and inventory ───────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/v1/inventory/medicines',
    summary: 'Search the medicine catalogue',
    tag: 'Inventory',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER, UserRole.SHOP_OWNER, UserRole.SALES],
    query: ['search', 'category', 'active', 'page', 'limit'],
  },
  {
    method: 'post',
    path: '/api/v1/inventory/medicines',
    summary: 'Add a medicine',
    tag: 'Inventory',
    roles: MANAGEMENT,
    body: CreateMedicineSchema,
  },
  {
    method: 'get',
    path: '/api/v1/inventory/batches',
    summary: 'List batches with expiry and stock warnings',
    tag: 'Inventory',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    query: ['medicineId', 'warning', 'days', 'threshold'],
  },
  {
    method: 'post',
    path: '/api/v1/inventory/batches/receive',
    summary: 'Receive stock into a batch',
    tag: 'Inventory',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    body: ReceiveStockSchema,
  },
  {
    method: 'patch',
    path: '/api/v1/inventory/medicines/{id}',
    summary: 'Amend a catalogue line',
    tag: 'Inventory',
    roles: MANAGEMENT,
    body: UpdateMedicineSchema,
  },
  {
    method: 'get',
    path: '/api/v1/inventory/batches/{id}',
    summary: 'One batch, with its quantities by state',
    tag: 'Inventory',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
  },
  {
    method: 'post',
    path: '/api/v1/inventory/batches/{id}/operations',
    summary: 'Move stock between states — reserve, release, damage, quarantine',
    tag: 'Inventory',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    body: StockOperationSchema,
  },
  {
    method: 'post',
    path: '/api/v1/inventory/batches/{id}/adjust',
    summary: 'Correct a batch quantity against a stated reason',
    tag: 'Inventory',
    // Not the storekeeper who counted it. An adjustment writes the stock
    // record to whatever a person says it is, which is the one inventory
    // operation with no arithmetic behind it.
    roles: MANAGEMENT,
    body: AdjustmentSchema,
  },
  {
    method: 'patch',
    path: '/api/v1/inventory/batches/{id}/block',
    summary: 'Block or unblock a batch from being allocated',
    tag: 'Inventory',
    roles: MANAGEMENT,
    // Was hand-validated, and is documented from its schema now — this phase
    // ships the endpoint's first caller anywhere.
    body: BatchBlockSchema,
  },
  {
    method: 'post',
    path: '/api/v1/inventory/allocations/reserve',
    summary: 'Reserve stock for an order by FEFO',
    tag: 'Inventory',
    roles: MANAGEMENT,
    body: AllocationSchema,
  },
  {
    method: 'get',
    path: '/api/v1/inventory/movements',
    summary: 'Immutable stock movement history',
    tag: 'Inventory',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    query: ['medicineId', 'batchId', 'type', 'page', 'limit'],
  },

  // ── Orders and approval ───────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/v1/orders',
    summary: 'List orders; a Shop Owner sees only their own',
    tag: 'Orders',
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
    query: ['status', 'page', 'limit'],
  },
  {
    method: 'post',
    path: '/api/v1/orders/quote',
    summary: 'Price a basket without placing it, so order entry can show what will be charged',
    tag: 'Orders',
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
    body: QuoteOrderSchema,
  },
  {
    method: 'post',
    path: '/api/v1/orders/submit',
    summary: 'Submit an order request, optionally on behalf of a named shop',
    tag: 'Orders',
    // Opened to the roles that can act for somebody else when the SALES role
    // landed; this document still said SHOP_OWNER, which is the kind of drift
    // that makes a specification worse than none.
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
    body: SubmitOrderSchema,
  },
  {
    method: 'post',
    path: '/api/v1/orders/drafts',
    summary: 'Save a basket server-side so it survives a device change',
    tag: 'Orders',
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
    body: SaveOrderDraftSchema,
  },
  {
    method: 'patch',
    path: '/api/v1/orders/drafts/{id}',
    summary: 'Amend a saved draft',
    tag: 'Orders',
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
    body: SaveOrderDraftSchema,
  },
  {
    method: 'post',
    path: '/api/v1/orders/drafts/{id}/submit',
    summary: 'Submit a saved draft as an order',
    tag: 'Orders',
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
    body: SubmitOrderSchema,
  },
  {
    method: 'post',
    path: '/api/v1/orders/{id}/duplicate',
    summary: 'Start a new draft from a previous order',
    tag: 'Orders',
    // Prices are not copied: the draft is rebuilt from today's catalogue, so
    // repeating last month's order does not repeat last month's price.
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
  },
  {
    method: 'post',
    path: '/api/v1/orders/{id}/cancellation-request',
    summary: 'Ask for an order to be cancelled',
    tag: 'Orders',
    roles: [UserRole.SHOP_OWNER],
    body: CancellationRequestSchema,
  },
  {
    method: 'get',
    path: '/api/v1/approvals/{id}',
    summary: 'One order under review, with its credit and licence position',
    tag: 'Approvals',
    roles: MANAGEMENT,
  },
  {
    method: 'post',
    path: '/api/v1/approvals/{id}/start',
    summary: 'Claim an order for review',
    tag: 'Approvals',
    // The body carries the version the reviewer was looking at, so two managers
    // opening the same order cannot both claim it.
    roles: MANAGEMENT,
    body: ReviewVersionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/approvals/{id}/hold',
    summary: 'Put an order on hold with a reason',
    tag: 'Approvals',
    roles: MANAGEMENT,
    body: HoldOrderSchema,
  },
  {
    method: 'post',
    path: '/api/v1/approvals/{id}/clarify',
    summary: 'Ask the customer for something before deciding',
    tag: 'Approvals',
    roles: MANAGEMENT,
    body: HoldOrderSchema,
  },
  {
    method: 'post',
    path: '/api/v1/orders/{id}/cancellation-decision',
    summary: 'Grant or refuse a cancellation request, releasing stock and credit',
    tag: 'Orders',
    roles: MANAGEMENT,
    body: CancellationDecisionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/auth/change-password',
    summary: 'Change your own password, revoking every other session',
    tag: 'Authentication',
    roles: ALL_ROLES,
    body: ChangePasswordSchema,
  },
  {
    method: 'get',
    path: '/api/v1/purchasing/suppliers',
    summary: 'List suppliers',
    tag: 'Purchasing',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    query: ['page', 'limit', 'includeInactive'],
  },
  {
    method: 'post',
    path: '/api/v1/purchasing/suppliers',
    summary: 'Add a supplier',
    tag: 'Purchasing',
    roles: MANAGEMENT,
    body: CreateSupplierSchema,
  },
  {
    method: 'get',
    path: '/api/v1/purchasing/orders',
    summary: 'List purchase orders',
    tag: 'Purchasing',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    query: ['status', 'supplierId', 'page', 'limit'],
  },
  {
    method: 'post',
    path: '/api/v1/purchasing/orders',
    summary: 'Raise a purchase order',
    tag: 'Purchasing',
    roles: MANAGEMENT,
    body: CreatePurchaseOrderSchema,
  },
  {
    method: 'get',
    path: '/api/v1/purchasing/orders/{id}',
    summary: 'A purchase order with its goods receipts',
    tag: 'Purchasing',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
  },
  {
    method: 'post',
    path: '/api/v1/purchasing/orders/{id}/receipts',
    summary: 'Book a delivery in against a purchase order, recording any shortfall',
    tag: 'Purchasing',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    body: ReceiveGoodsSchema,
  },
  {
    method: 'get',
    path: '/api/v1/purchasing/recall/batches',
    summary: 'Find batches by the number printed on the carton',
    tag: 'Purchasing',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    query: ['batchNumber'],
  },
  {
    method: 'get',
    path: '/api/v1/purchasing/recall/batches/{batchId}',
    summary: 'Trace a batch: every shop that received it, and where it came from',
    tag: 'Purchasing',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
  },
  {
    method: 'get',
    path: '/api/v1/purchasing/controlled-register',
    summary: 'Prescription-medicine movement return for a period',
    tag: 'Purchasing',
    roles: MANAGEMENT,
    query: ['from', 'to'],
  },
  {
    method: 'get',
    path: '/api/v1/stocktakes',
    summary: 'Physical counts, with how far each has got',
    tag: 'Stocktake',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    query: ['status', 'page', 'limit'],
  },
  {
    method: 'post',
    path: '/api/v1/stocktakes',
    summary: 'Open a count over a location or a set of medicines',
    tag: 'Stocktake',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    body: OpenStocktakeSchema,
  },
  {
    method: 'get',
    path: '/api/v1/stocktakes/{id}',
    summary: 'One count sheet. Expected quantities are withheld while it is being counted',
    tag: 'Stocktake',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
  },
  {
    method: 'post',
    path: '/api/v1/stocktakes/{id}/counts',
    summary: 'Record what was counted on one or more lines',
    tag: 'Stocktake',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    body: RecordCountsSchema,
  },
  {
    method: 'post',
    path: '/api/v1/stocktakes/{id}/submit',
    summary: 'Finish counting and send the sheet for review',
    tag: 'Stocktake',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    body: SubmitStocktakeSchema,
  },
  {
    method: 'post',
    path: '/api/v1/stocktakes/{id}/post',
    summary: 'Approve the sheet and post every variance in one transaction',
    tag: 'Stocktake',
    roles: MANAGEMENT,
    body: PostStocktakeSchema,
  },
  {
    method: 'post',
    path: '/api/v1/stocktakes/{id}/abandon',
    summary: 'Abandon a count without posting anything',
    tag: 'Stocktake',
    roles: MANAGEMENT,
    body: AbandonStocktakeSchema,
  },
  {
    method: 'get',
    path: '/api/v1/trips',
    summary: 'Delivery rounds. A rider sees only their own',
    tag: 'Deliveries',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
    query: ['status', 'deliveryPersonId', 'page', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/trips/plannable',
    summary: 'Deliveries that could go on a round and are not already on one',
    tag: 'Deliveries',
    roles: MANAGEMENT,
    query: ['deliveryPersonId'],
  },
  {
    method: 'get',
    path: '/api/v1/trips/{id}',
    summary: 'One round, with each stop and its live delivery',
    tag: 'Deliveries',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
  },
  {
    method: 'post',
    path: '/api/v1/trips',
    summary: 'Plan a round for one rider on one day',
    tag: 'Deliveries',
    roles: MANAGEMENT,
    body: PlanTripSchema,
  },
  {
    method: 'post',
    path: '/api/v1/trips/{id}/sequence',
    summary: 'Reorder the stops',
    tag: 'Deliveries',
    roles: MANAGEMENT,
    body: ResequenceTripSchema,
  },
  {
    method: 'post',
    path: '/api/v1/trips/{id}/start',
    summary: 'The rider records that they have left',
    tag: 'Deliveries',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
    body: StartTripSchema,
  },
  {
    method: 'post',
    path: '/api/v1/trips/{id}/cancel',
    summary: 'Call a round off. Every delivery is left exactly as it was',
    tag: 'Deliveries',
    roles: MANAGEMENT,
    body: CancelTripSchema,
  },
  {
    method: 'get',
    path: '/api/v1/inventory/warehouses',
    summary: 'Every warehouse, with what it is holding',
    tag: 'Inventory',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
  },
  {
    method: 'post',
    path: '/api/v1/inventory/warehouses',
    summary: 'Add a warehouse. The first one becomes the default',
    tag: 'Inventory',
    roles: MANAGEMENT,
    body: CreateWarehouseSchema,
  },
  {
    method: 'get',
    path: '/api/v1/pricing/price-lists',
    summary: 'Price lists, with how many customers each one prices',
    tag: 'Pricing',
    roles: [...MANAGEMENT, UserRole.SALES],
    query: ['page', 'limit', 'activeOnly'],
  },
  {
    method: 'post',
    path: '/api/v1/pricing/price-lists',
    summary: 'Create a price list',
    tag: 'Pricing',
    roles: MANAGEMENT,
    body: CreatePriceListSchema,
  },
  {
    method: 'get',
    path: '/api/v1/pricing/price-lists/{id}',
    summary: 'One price list, with each line naming its medicine',
    tag: 'Pricing',
    roles: [...MANAGEMENT, UserRole.SALES],
  },
  {
    method: 'patch',
    path: '/api/v1/pricing/price-lists/{id}',
    summary: 'Replace a price list, under an optimistic version',
    tag: 'Pricing',
    roles: MANAGEMENT,
    body: UpdatePriceListSchema,
  },
  {
    method: 'get',
    path: '/api/v1/pricing/schemes',
    summary: 'Free-goods offers',
    tag: 'Pricing',
    roles: [...MANAGEMENT, UserRole.SALES],
    query: ['page', 'limit', 'activeOnly'],
  },
  {
    method: 'post',
    path: '/api/v1/pricing/schemes',
    summary: 'Create a free-goods offer, such as buy ten get one',
    tag: 'Pricing',
    roles: MANAGEMENT,
    body: CreateSchemeSchema,
  },
  {
    method: 'get',
    path: '/api/v1/pricing/schemes/{id}',
    summary: 'One offer',
    tag: 'Pricing',
    roles: [...MANAGEMENT, UserRole.SALES],
  },
  {
    method: 'patch',
    path: '/api/v1/pricing/schemes/{id}',
    summary: 'Change an offer. Orders already placed keep the terms they were given',
    tag: 'Pricing',
    roles: MANAGEMENT,
    body: UpdateSchemeSchema,
  },
  {
    method: 'get',
    path: '/api/v1/approvals/queue',
    summary: 'Orders awaiting review',
    tag: 'Approvals',
    roles: MANAGEMENT,
    query: ['status'],
  },
  {
    method: 'post',
    path: '/api/v1/approvals/{id}/approve',
    summary: 'Approve or partially approve, reserving stock',
    tag: 'Approvals',
    roles: MANAGEMENT,
    body: ApprovalSchema,
  },
  {
    method: 'post',
    path: '/api/v1/approvals/{id}/reject',
    summary: 'Reject an order',
    tag: 'Approvals',
    roles: MANAGEMENT,
    body: RejectOrderSchema,
  },

  // ── Fulfilment ────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/v1/fulfilment/queue',
    summary: 'Picking and packing queues',
    tag: 'Fulfilment',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    query: ['status'],
  },
  {
    method: 'get',
    path: '/api/v1/fulfilment/ready',
    summary: 'Packed orders waiting to be handed to a rider',
    tag: 'Fulfilment',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
  },
  {
    method: 'get',
    path: '/api/v1/fulfilment/picking/{id}',
    summary: 'One picking list, with its lines and current progress',
    tag: 'Fulfilment',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
  },
  {
    method: 'post',
    path: '/api/v1/fulfilment/picking/{id}/start',
    summary: 'Claim a picking list and begin work on it',
    tag: 'Fulfilment',
    // Only a storekeeper picks. A manager can read the list and resolve a
    // discrepancy on it, and cannot claim it — the person holding the list is
    // the person standing in the aisle.
    roles: [UserRole.STOREKEEPER],
    body: PickingActionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/fulfilment/picking/{id}/progress',
    summary: 'Record what has been picked, by batch',
    tag: 'Fulfilment',
    roles: [UserRole.STOREKEEPER],
    body: PickingProgressSchema,
  },
  {
    method: 'post',
    path: '/api/v1/fulfilment/picking/{id}/resume',
    summary: 'Resume a paused picking list',
    tag: 'Fulfilment',
    roles: [UserRole.STOREKEEPER],
    body: PickingActionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/fulfilment/picking/{id}/discrepancies',
    summary: 'Report a shortfall or a damaged batch against a line',
    tag: 'Fulfilment',
    roles: [UserRole.STOREKEEPER],
    body: DiscrepancySchema,
  },
  {
    method: 'post',
    path: '/api/v1/fulfilment/picking/{id}/discrepancies/resolve',
    summary: 'Decide a reported discrepancy so picking can continue',
    tag: 'Fulfilment',
    // The split that makes the discrepancy mechanism worth having: the person
    // who found the problem cannot also wave it through.
    roles: MANAGEMENT,
    body: DiscrepancyResolutionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/fulfilment/picking/{id}/pack',
    summary: 'Pack actual quantities and generate the final invoice',
    tag: 'Fulfilment',
    roles: [UserRole.STOREKEEPER],
    body: PackingSchema,
  },
  {
    method: 'get',
    path: '/api/v1/fulfilment/invoices/{id}',
    summary: 'Read an issued invoice',
    tag: 'Fulfilment',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER, UserRole.SHOP_OWNER],
  },
  {
    method: 'get',
    path: '/api/v1/fulfilment/invoices/{id}/pdf',
    summary: 'Invoice as A4 or 80 mm thermal PDF',
    tag: 'Fulfilment',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER, UserRole.SHOP_OWNER],
    query: ['layout'],
    produces: 'application/pdf',
  },

  // ── Delivery ──────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/v1/deliveries',
    summary: 'Delivery board, filtered by role',
    tag: 'Deliveries',
    roles: ALL_ROLES,
    query: ['status', 'priority', 'assignedTo', 'q', 'page', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/deliveries/{id}',
    summary: 'One delivery, scoped by role',
    tag: 'Deliveries',
    roles: ALL_ROLES,
  },
  {
    method: 'get',
    path: '/api/v1/deliveries/order/{orderId}',
    summary: 'The delivery attached to an order, if there is one',
    tag: 'Deliveries',
    roles: ALL_ROLES,
  },
  {
    method: 'get',
    path: '/api/v1/deliveries/personnel',
    summary: 'Riders available to be assigned, with their current load',
    tag: 'Deliveries',
    roles: MANAGEMENT,
  },
  {
    method: 'get',
    path: '/api/v1/deliveries/proof/{fileId}',
    summary: 'A stored proof-of-delivery photograph or signature',
    tag: 'Deliveries',
    roles: ALL_ROLES,
    produces: 'image/*',
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/assign',
    summary: 'Assign a delivery to a delivery person',
    tag: 'Deliveries',
    roles: MANAGEMENT,
    body: DeliveryAssignmentSchema,
  },
  /*
   * The custody chain, in the order it happens.
   *
   * Each step is a separate endpoint with its own role because each is a
   * different person physically holding the goods: the warehouse hands over,
   * the rider acknowledges and picks up, drives, arrives, and completes. A
   * single "status" field a client could set to anything would let a rider mark
   * a delivery handed over before it left the building.
   */
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/handover',
    summary: 'The warehouse hands the packed goods to the rider',
    tag: 'Deliveries',
    roles: [UserRole.STOREKEEPER],
    body: DeliveryHandoverSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/acknowledge',
    summary: 'The rider accepts custody',
    tag: 'Deliveries',
    roles: [UserRole.DELIVERY_PERSON],
    body: DeliverySimpleActionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/pickup',
    summary: 'The rider collects the consignment',
    tag: 'Deliveries',
    roles: [UserRole.DELIVERY_PERSON],
    body: DeliverySimpleActionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/start',
    summary: 'The rider sets off',
    tag: 'Deliveries',
    roles: [UserRole.DELIVERY_PERSON],
    body: DeliverySimpleActionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/arrived',
    summary: 'The rider reaches the shop',
    tag: 'Deliveries',
    roles: [UserRole.DELIVERY_PERSON],
    body: DeliverySimpleActionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/send-otp',
    summary: 'Send the receiver a one-time code to confirm handover',
    tag: 'Deliveries',
    roles: [UserRole.DELIVERY_PERSON],
    body: DeliverySimpleActionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/returning',
    summary: 'Mark undelivered goods as coming back',
    tag: 'Deliveries',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
    body: DeliverySimpleActionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/returned',
    summary: 'The warehouse receives returning goods back into stock',
    tag: 'Deliveries',
    roles: [UserRole.STOREKEEPER],
    body: DeliverySimpleActionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/cancel',
    summary: 'Cancel a delivery before it leaves',
    tag: 'Deliveries',
    roles: MANAGEMENT,
    body: DeliverySimpleActionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/complete',
    summary: 'Complete a delivery with receiver proof and any collection',
    tag: 'Deliveries',
    roles: [UserRole.DELIVERY_PERSON],
    body: DeliveryCompletionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/fail',
    summary: 'Record a failed delivery attempt',
    tag: 'Deliveries',
    roles: [UserRole.DELIVERY_PERSON],
    body: DeliveryFailureSchema,
  },

  // ── Payments, ledger and finance ──────────────────────────────────────────
  {
    method: 'post',
    path: '/api/v1/payments',
    summary: 'Record a payment',
    tag: 'Payments',
    roles: MANAGEMENT,
    body: CreatePaymentSchema,
  },
  {
    method: 'post',
    path: '/api/v1/payments/{id}/post',
    summary: 'Verify and post a pending payment',
    tag: 'Payments',
    roles: MANAGEMENT,
    body: PaymentPostSchema,
  },
  /*
   * Reading payments. `MANAGEMENT` runs the finance desk; a `DELIVERY_PERSON`
   * is here because they collect cash at the door and must be able to see what
   * they took; a `SHOP_OWNER` sees what they paid. All three are narrowed by
   * the handler to their own records — the role list is who may ask, not what
   * they get back.
   */
  {
    method: 'get',
    path: '/api/v1/payments',
    summary: 'Payments, scoped to what the caller may see',
    tag: 'Payments',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON, UserRole.SHOP_OWNER],
    query: ['status', 'method', 'shopId', 'from', 'to', 'page', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/payments/{id}',
    summary: 'One payment',
    tag: 'Payments',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON, UserRole.SHOP_OWNER],
  },
  {
    method: 'get',
    path: '/api/v1/payments/{id}/receipt',
    summary: 'The receipt for a posted payment',
    tag: 'Payments',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON, UserRole.SHOP_OWNER],
    query: ['layout'],
    produces: 'application/pdf',
  },
  {
    method: 'get',
    path: '/api/v1/payments/{id}/attachment',
    summary: 'The deposit slip or transfer screenshot supporting a payment',
    tag: 'Payments',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON, UserRole.SHOP_OWNER],
    produces: 'image/*',
  },
  {
    /*
     * A rider's own collections, and the second endpoint whose path prefix
     * reads as ownership it does not have — `/payments/my-collections` sits
     * among the finance desk's endpoints and belongs to one rider, exactly as
     * `/finance/my/collections` does.
     */
    method: 'get',
    path: '/api/v1/payments/my-collections',
    summary: 'What the signed-in rider has collected and not yet handed in',
    tag: 'Payments',
    roles: [UserRole.DELIVERY_PERSON],
  },
  {
    method: 'post',
    path: '/api/v1/payments/{id}/fail',
    summary: 'Record that a pending payment did not clear',
    tag: 'Payments',
    roles: MANAGEMENT,
    body: PaymentFailSchema,
  },
  {
    method: 'post',
    path: '/api/v1/payments/{id}/handover',
    summary: 'A rider hands collected cash to the office',
    tag: 'Payments',
    roles: [UserRole.DELIVERY_PERSON],
    body: PaymentHandoverSchema,
  },
  {
    method: 'post',
    path: '/api/v1/payments/{id}/reverse',
    summary: 'Reverse a posted payment with a balancing journal',
    tag: 'Payments',
    roles: ADMINS,
    body: PaymentReverseSchema,
  },
  {
    method: 'get',
    path: '/api/v1/finance/shops/{shopId}/summary',
    summary: 'What one customer owes, and how overdue it is',
    tag: 'Finance',
    roles: MANAGEMENT,
  },
  {
    method: 'get',
    path: '/api/v1/finance/shops/{shopId}/invoices',
    summary: 'One customer’s invoices and what remains on each',
    tag: 'Finance',
    roles: MANAGEMENT,
    query: ['status', 'from', 'to', 'page', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/finance/shops/{shopId}/ledger',
    summary: 'One customer’s ledger entries, newest first',
    tag: 'Finance',
    roles: MANAGEMENT,
    query: ['from', 'to', 'page', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/finance/shops/{shopId}/statement',
    summary: 'Customer statement for a period',
    tag: 'Finance',
    roles: MANAGEMENT,
    query: ['from', 'to', 'format'],
  },
  {
    method: 'get',
    path: '/api/v1/finance/reports/summary',
    summary: 'Receivables, collections and exposure across all customers',
    tag: 'Finance',
    roles: MANAGEMENT,
    query: ['from', 'to'],
  },
  {
    method: 'get',
    path: '/api/v1/finance/reports/outstanding',
    summary: 'Everything invoiced and not yet settled',
    tag: 'Finance',
    roles: MANAGEMENT,
    query: ['from', 'to', 'shopId', 'format'],
  },
  {
    method: 'get',
    path: '/api/v1/finance/reports/overdue',
    summary: 'Outstanding balances past their due date, by age',
    tag: 'Finance',
    roles: MANAGEMENT,
    query: ['from', 'to', 'shopId', 'format'],
  },
  {
    method: 'get',
    path: '/api/v1/finance/reports/collections',
    summary: 'What was collected in a period, by method and by collector',
    tag: 'Finance',
    roles: MANAGEMENT,
    query: ['from', 'to', 'shopId', 'format'],
  },
  {
    method: 'post',
    path: '/api/v1/finance/adjustments',
    summary: 'Post a ledger adjustment',
    tag: 'Finance',
    roles: ADMINS,
    body: LedgerAdjustmentSchema,
  },
  {
    /*
     * The two repair endpoints. Both exist because the ledger is derived and
     * derivations can go wrong; both are `ADMINS` rather than `MANAGEMENT`,
     * because a repair rewrites the record the business is audited against.
     */
    method: 'get',
    path: '/api/v1/finance/reconciliation/{shopId}',
    summary: 'Whether one customer’s ledger balances against its documents',
    tag: 'Finance',
    roles: MANAGEMENT,
  },
  {
    method: 'post',
    path: '/api/v1/finance/reconciliation/{shopId}/repair',
    summary: 'Rebuild one customer’s derived balances from their documents',
    tag: 'Finance',
    roles: ADMINS,
    // No schema: the handler takes no body. See the note on hand-validated
    // bodies in `docs/TESTING.md`.
  },
  {
    method: 'post',
    path: '/api/v1/finance/credit-reservations/backfill',
    summary: 'Recreate missing credit reservations for orders that predate them',
    tag: 'Finance',
    roles: ADMINS,
    body: CreditReservationBackfillSchema,
  },

  // ── Notifications and activity ────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/v1/notifications',
    summary: 'Notification inbox',
    tag: 'Notifications',
    roles: ALL_ROLES,
    query: ['category', 'unread', 'page', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/notifications/catalogue',
    summary: 'Every notification type, so preferences can be shown by name',
    tag: 'Notifications',
    roles: ALL_ROLES,
  },
  {
    method: 'put',
    path: '/api/v1/notifications/preferences',
    summary: 'Choose which notifications reach which channel',
    tag: 'Notifications',
    roles: ALL_ROLES,
    body: NotificationPreferenceUpdateSchema,
  },
  {
    method: 'post',
    path: '/api/v1/notifications/read',
    summary: 'Mark named notifications as read',
    tag: 'Notifications',
    roles: ALL_ROLES,
    body: NotificationIdsSchema,
  },
  {
    method: 'post',
    path: '/api/v1/notifications/read-all',
    summary: 'Mark everything the caller had already seen as read',
    tag: 'Notifications',
    roles: ALL_ROLES,
    body: NotificationMarkAllReadSchema,
  },
  {
    method: 'post',
    path: '/api/v1/notifications/archive',
    summary: 'Archive named notifications out of the inbox',
    tag: 'Notifications',
    roles: ALL_ROLES,
    body: NotificationIdsSchema,
  },
  {
    method: 'post',
    path: '/api/v1/notifications/devices',
    summary: 'Register a device for push',
    tag: 'Notifications',
    roles: ALL_ROLES,
    body: PushDeviceRegisterSchema,
  },
  {
    method: 'delete',
    path: '/api/v1/notifications/devices',
    summary: 'Forget a device, so a signed-out handset stops receiving push',
    tag: 'Notifications',
    roles: ALL_ROLES,
    body: PushDeviceUnregisterSchema,
  },
  {
    method: 'get',
    path: '/api/v1/notifications/{id}/deliveries',
    summary: 'Per-channel delivery attempts for one notification',
    tag: 'Notifications',
    // Administrators only: this is the diagnostic view of whether an SMS
    // actually left, and it names recipients and providers.
    roles: ADMINS,
  },
  {
    method: 'post',
    path: '/api/v1/notifications/test',
    summary: 'Send a test notification through a chosen channel',
    tag: 'Notifications',
    roles: ADMINS,
    body: NotificationTestSendSchema,
  },
  {
    method: 'get',
    path: '/api/v1/activity',
    summary: 'Organisation activity feed, filtered by permission',
    tag: 'Activity',
    roles: ALL_ROLES,
    query: ['category', 'shopId', 'page', 'limit'],
  },

  // ── Settings and administration ───────────────────────────────────────────
  {
    method: 'get',
    path: '/api/v1/settings/branding',
    summary: 'Product identity for any signed-in client',
    tag: 'Settings',
    roles: ALL_ROLES,
  },
  {
    method: 'get',
    path: '/api/v1/settings',
    summary: 'Every settings group with its effective values and provenance',
    tag: 'Settings',
    roles: ADMINS,
  },
  {
    method: 'put',
    path: '/api/v1/settings/{group}',
    summary: 'Save a settings group',
    tag: 'Settings',
    roles: ADMINS,
    body: SettingsUpdateSchema,
  },
  {
    method: 'get',
    path: '/api/v1/admin/users',
    summary: 'Administrative user directory',
    tag: 'Administration',
    roles: MANAGEMENT,
    query: ['q', 'role', 'status', 'page', 'limit'],
  },
  {
    method: 'patch',
    path: '/api/v1/admin/users/{id}',
    summary: 'Change a user’s profile, role or status',
    tag: 'Administration',
    roles: ADMINS,
    body: AdminUserUpdateSchema,
  },
  {
    method: 'post',
    path: '/api/v1/admin/users/{id}/reset-password',
    summary: 'Issue a temporary password',
    tag: 'Administration',
    roles: ADMINS,
    body: AdminPasswordResetSchema,
  },
  {
    method: 'post',
    path: '/api/v1/settings/{group}/reset',
    summary: 'Discard a group’s saved values and fall back to the code defaults',
    tag: 'Settings',
    roles: ADMINS,
    body: SettingsResetSchema,
  },
  {
    method: 'get',
    path: '/api/v1/admin/users/{id}',
    summary: 'One user, with their sessions and recent activity',
    tag: 'Administration',
    // Readable by `MANAGER`, changeable only by an administrator: a manager
    // needs to know who a delivery person is without being able to make one.
    roles: MANAGEMENT,
  },
  {
    method: 'post',
    path: '/api/v1/admin/users/{id}/revoke-sessions',
    summary: 'Sign a user out of every device',
    tag: 'Administration',
    roles: ADMINS,
    body: AdminSessionRevokeSchema,
  },
  {
    method: 'get',
    path: '/api/v1/admin/audit',
    summary: 'Read-only audit log',
    tag: 'Administration',
    roles: ADMINS,
    query: ['action', 'entityType', 'from', 'to', 'page', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/admin/audit/actions',
    summary: 'The action names present in the audit log, for its filter',
    tag: 'Administration',
    roles: ADMINS,
  },
  {
    method: 'get',
    path: '/api/v1/users/me',
    summary: 'The signed-in user’s own profile',
    tag: 'Authentication',
    // No role guard: this is "who am I", and every authenticated caller has an
    // answer. Authentication is still required — it is applied router-wide.
    roles: ALL_ROLES,
  },
  {
    method: 'patch',
    path: '/api/v1/shops/{id}',
    summary: 'Amend a customer’s details or price list',
    tag: 'Shops',
    roles: ADMINS,
    body: UpdateShopSchema,
  },
  {
    method: 'patch',
    path: '/api/v1/shops/{id}/status',
    summary: 'Suspend or reinstate a customer',
    tag: 'Shops',
    // `MANAGER` as well as an administrator: suspending a customer who has
    // stopped paying is a credit decision, and it is reversible.
    roles: MANAGEMENT,
    // No schema: this handler reads `status` and `reason` off the body by hand.
  },
  {
    method: 'post',
    path: '/api/v1/shops/{id}/assign-owner',
    summary: 'Attach a shop-owner account to a customer',
    tag: 'Shops',
    roles: ADMINS,
    // No schema: this handler reads `userId` off the body by hand.
  },
  {
    method: 'post',
    path: '/api/v1/shops/{id}/assign-manager',
    summary: 'Name the internal manager responsible for a customer',
    tag: 'Shops',
    roles: ADMINS,
    // No schema: this handler reads `userId` off the body by hand.
  },
  {
    /*
     * The API describes itself. Both are deliberately unauthenticated — a
     * specification a caller must already hold a token to read is no use for
     * writing the client that gets the token. Neither returns any data.
     */
    method: 'get',
    path: '/api/v1/docs',
    summary: 'Human-readable API reference',
    tag: 'Documentation',
    produces: 'text/html',
  },
  {
    method: 'get',
    path: '/api/v1/docs/openapi.json',
    summary: 'This document, served by the running API',
    tag: 'Documentation',
  },

  // ── Returns ───────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/v1/returns',
    summary: 'List returns, filtered by role',
    tag: 'Returns',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER, UserRole.SHOP_OWNER, UserRole.DELIVERY_PERSON],
    query: ['status', 'q', 'page', 'limit'],
  },
  {
    method: 'post',
    path: '/api/v1/returns',
    summary: 'Request a return against an issued invoice',
    tag: 'Returns',
    roles: [...MANAGEMENT, UserRole.SHOP_OWNER],
    body: CreateReturnSchema,
  },
  {
    method: 'get',
    path: '/api/v1/returns/credit-notes/{id}',
    summary: 'An issued credit note',
    tag: 'Returns',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER, UserRole.SHOP_OWNER, UserRole.DELIVERY_PERSON],
  },
  {
    method: 'post',
    path: '/api/v1/returns/{id}/review',
    summary: 'Claim a return for review',
    tag: 'Returns',
    roles: MANAGEMENT,
    body: ReturnReviewStartSchema,
  },
  {
    method: 'post',
    path: '/api/v1/returns/{id}/decision',
    summary: 'Approve, partially approve or reject requested lines',
    tag: 'Returns',
    roles: MANAGEMENT,
    body: ReturnDecisionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/returns/{id}/reject',
    summary: 'Refuse a return outright, with a reason the customer sees',
    tag: 'Returns',
    roles: MANAGEMENT,
    body: ReturnRejectionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/returns/{id}/cancel',
    summary: 'Withdraw a return before it has been collected',
    tag: 'Returns',
    // The customer who raised it may withdraw it; a rep may not, which is the
    // same boundary that keeps `SALES` out of the workflow entirely.
    roles: [...MANAGEMENT, UserRole.SHOP_OWNER],
    body: ReturnCancelSchema,
  },
  {
    method: 'post',
    path: '/api/v1/returns/{id}/collect',
    summary: 'A rider collects approved goods from the shop',
    tag: 'Returns',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
    body: ReturnCollectionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/returns/{id}/receive',
    summary: 'Receive returned goods and record their disposition',
    tag: 'Returns',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    body: ReturnReceiptSchema,
  },
  {
    method: 'post',
    path: '/api/v1/returns/{id}/credit-note',
    summary: 'Issue the credit note and post it to the ledger',
    tag: 'Returns',
    roles: MANAGEMENT,
    body: CreditNoteIssueSchema,
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/v1/reports/overview',
    summary: 'Composed analytics overview',
    tag: 'Reports',
    roles: MANAGEMENT,
    query: RANGE,
  },
  {
    method: 'get',
    path: '/api/v1/reports/sales',
    summary: 'Sales summary and time series',
    tag: 'Reports',
    roles: [...MANAGEMENT, UserRole.SHOP_OWNER],
    query: RANGE,
  },
  {
    method: 'get',
    path: '/api/v1/reports/sales/breakdown',
    summary: 'Sales by medicine, category, manufacturer, customer or territory',
    tag: 'Reports',
    roles: [...MANAGEMENT, UserRole.SHOP_OWNER],
    query: [...RANGE, 'dimension', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/reports/orders',
    summary: 'Order funnel with conversion and cycle times',
    tag: 'Reports',
    roles: [...MANAGEMENT, UserRole.SHOP_OWNER],
    query: RANGE,
  },
  {
    method: 'get',
    path: '/api/v1/reports/inventory',
    summary: 'Inventory valuation, expiry buckets and dead stock',
    tag: 'Reports',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    query: ['asOf', 'format'],
  },
  {
    method: 'get',
    path: '/api/v1/reports/stock-movements',
    summary: 'Stock movements over a period, by medicine and by reason',
    tag: 'Reports',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    query: ['from', 'to', 'medicineId', 'format'],
  },
  {
    method: 'get',
    path: '/api/v1/reports/deliveries',
    summary: 'Delivery performance by person',
    tag: 'Reports',
    roles: MANAGEMENT,
    query: RANGE,
  },
  {
    method: 'get',
    path: '/api/v1/reports/returns',
    summary: 'Returns analytics with return rate and recovery',
    tag: 'Reports',
    roles: [...MANAGEMENT, UserRole.SHOP_OWNER],
    query: RANGE,
  },
  {
    method: 'get',
    path: '/api/v1/reports/receivables-ageing',
    summary: 'Receivables ageing buckets',
    tag: 'Reports',
    roles: MANAGEMENT,
    query: ['asOf', 'shopId', 'format'],
  },

  /*
   * ── The shop owner's own journey ────────────────────────────────────────
   *
   * First tranche of the documentation burn-down, ordered by what a real
   * user's journey touches rather than by what is easy to write. A shop owner
   * signs in, finds their shop, browses a medicine, tidies a draft, reads an
   * order they placed, chases a return, and checks what they owe — and until
   * now not one of those endpoints appeared in the specification, so the
   * published API described a product a customer cannot actually use.
   *
   * The roles below are checked against the mounted router by
   * `routeCoverage.test.ts`, so they are the server's answer rather than an
   * intention. Two of them are worth reading twice: `/finance/my/collections`
   * sits among the shop owner's endpoints and belongs to a **delivery rider**,
   * and `/orders/drafts/{id}` admits `SALES` because a rep tidying a draft they
   * built for a customer is the same action.
   */
  {
    method: 'get',
    path: '/api/v1/shops/my',
    summary: 'The signed-in owner’s own shop',
    tag: 'Shops',
    roles: [UserRole.SHOP_OWNER],
  },
  /*
   * The three writes a customer may make about themselves, and the whole list
   * is the response to each. Exactly one address carries `isDefault` after any
   * of them — the server decides that, not the request.
   */
  {
    method: 'post',
    path: '/api/v1/shops/my/addresses',
    summary: 'Add a delivery address to the signed-in owner’s own shop',
    tag: 'Shops',
    roles: [UserRole.SHOP_OWNER],
    body: DeliveryAddressSchema,
  },
  {
    method: 'patch',
    path: '/api/v1/shops/my/addresses/{addressId}',
    summary: 'Change one of the signed-in owner’s delivery addresses',
    tag: 'Shops',
    roles: [UserRole.SHOP_OWNER],
    body: UpdateDeliveryAddressSchema,
  },
  {
    method: 'delete',
    path: '/api/v1/shops/my/addresses/{addressId}',
    summary: 'Remove one of the signed-in owner’s delivery addresses',
    tag: 'Shops',
    roles: [UserRole.SHOP_OWNER],
  },
  /*
   * And the staff equivalent, which is an **add and nothing else**: the order
   * screen needs an address for a customer standing at a counter, and a rep has
   * no business changing one that is already on file.
   */
  {
    method: 'post',
    path: '/api/v1/shops/{id}/addresses',
    summary: 'Add a delivery address to a named customer',
    tag: 'Shops',
    roles: [...MANAGEMENT, UserRole.SALES],
    body: DeliveryAddressSchema,
  },
  {
    method: 'get',
    path: '/api/v1/inventory/medicines/{id}',
    summary: 'One medicine, with its current availability',
    tag: 'Inventory',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER, UserRole.SHOP_OWNER, UserRole.SALES],
  },
  {
    method: 'get',
    path: '/api/v1/orders/{id}',
    summary: 'One order, scoped to what the caller may see',
    tag: 'Orders',
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
  },
  {
    method: 'delete',
    path: '/api/v1/orders/drafts/{id}',
    summary: 'Discard a draft order that was never submitted',
    tag: 'Orders',
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
  },
  {
    method: 'get',
    path: '/api/v1/returns/{id}',
    summary: 'One return, scoped to what the caller may see',
    tag: 'Returns',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER, UserRole.SHOP_OWNER, UserRole.DELIVERY_PERSON],
  },
  {
    method: 'get',
    path: '/api/v1/finance/my/summary',
    summary: 'What the signed-in owner’s shop owes, and by when',
    tag: 'Finance',
    roles: [UserRole.SHOP_OWNER],
  },
  {
    method: 'get',
    path: '/api/v1/finance/my/invoices',
    summary: 'The signed-in owner’s own invoices',
    tag: 'Finance',
    roles: [UserRole.SHOP_OWNER],
    query: ['status', 'page', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/finance/my/statement',
    summary: 'The signed-in owner’s account statement over a period',
    tag: 'Finance',
    roles: [UserRole.SHOP_OWNER],
    query: ['from', 'to', 'format'],
  },
  {
    method: 'get',
    path: '/api/v1/finance/my/collections',
    summary: 'The cash a rider has collected and not yet handed over',
    tag: 'Finance',
    // Not the shop owner's, despite the path it shares with the three above.
    roles: [UserRole.DELIVERY_PERSON],
  },
  {
    method: 'get',
    path: '/api/v1/notifications/unread-count',
    summary: 'How many notifications the signed-in user has not read',
    tag: 'Notifications',
    roles: ALL_ROLES,
  },
  {
    method: 'get',
    path: '/api/v1/notifications/preferences',
    summary: 'The signed-in user’s own notification settings',
    tag: 'Notifications',
    roles: ALL_ROLES,
  },
  {
    method: 'get',
    path: '/api/v1/activity/timeline',
    summary: 'The signed-in user’s recent activity',
    tag: 'Activity',
    roles: ALL_ROLES,
    query: ['entityType', 'entityId', 'page', 'limit'],
  },
];

/** An instant, as `new Date().toISOString()` writes one. */
const GENERATED_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Replaces a defaulted timestamp with a sentence saying what it means.
 *
 * `z.toJSONSchema` evaluates a Zod default to produce its JSON Schema
 * counterpart, which is right for `.default(30)` and wrong for
 * `.default(() => new Date())`: the second is not a value, it is the server's
 * clock, and freezing it produces a published contract telling every client the
 * field defaults to one particular instant in August 2026.
 *
 * `POST /payments`'s `collectedAt` and `POST /finance/adjustments`'s
 * `occurredAt` are the two. Between them they also made the document
 * unreproducible — two regenerations minutes apart differ — which is why the
 * committed copy could not be gated against the source until now.
 */
function withoutGeneratedInstants(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const entry of node) withoutGeneratedInstants(entry);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.default === 'string' && GENERATED_INSTANT.test(record.default)) {
    delete record.default;
    const existing = typeof record.description === 'string' ? `${record.description} ` : '';
    record.description = `${existing}Defaults to the moment the server receives the request.`;
  }
  for (const value of Object.values(record)) withoutGeneratedInstants(value);
}

/** JSON Schema for a Zod schema, expressed for a request body. */
function bodySchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  // The dialect marker belongs on the document, not on every operation.
  delete generated.$schema;
  withoutGeneratedInstants(generated);
  return generated;
}

const ENVELOPE = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', description: 'Stable machine-readable failure code' },
          message: { type: 'string' },
          correlationId: {
            type: 'string',
            description: 'Matches the x-request-id response header and the server log line',
          },
          details: { description: 'Present on validation failures: the offending paths' },
        },
      },
    },
  },
  Success: {
    type: 'object',
    required: ['data'],
    properties: {
      data: { description: 'The result. Lists also carry a meta object with paging.' },
      meta: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          pages: { type: 'integer' },
        },
      },
    },
  },
} as const;

const FAILURES = {
  '400': { description: 'The request was rejected by validation' },
  '401': { description: 'No valid access token was presented' },
  '403': { description: 'The signed-in role may not perform this action' },
  '404': { description: 'No such record, or none the caller may see' },
  '409': { description: 'A conflicting change was made since the record was loaded' },
  '429': { description: 'Rate limited; see the RateLimit-Reset and Retry-After headers' },
  '500': { description: 'Unexpected failure; quote the correlation identifier' },
} as const;

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of OPERATIONS) {
    const pathParameters = [...operation.path.matchAll(/\{(\w+)}/g)].map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    const queryParameters = (operation.query ?? []).map((name) => ({
      name,
      in: 'query',
      required: false,
      schema: { type: 'string' },
    }));

    const responseType = operation.produces ?? 'application/json';

    paths[operation.path] ??= {};
    paths[operation.path][operation.method] = {
      tags: [operation.tag],
      summary: operation.summary,
      description: operation.roles
        ? `Permitted roles: ${operation.roles.join(', ')}.`
        : 'Available without authentication.',
      ...(operation.roles ? { security: [{ bearerAuth: [] }] } : { security: [] }),
      ...(pathParameters.length || queryParameters.length
        ? { parameters: [...pathParameters, ...queryParameters] }
        : {}),
      ...(operation.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: bodySchema(operation.body) } },
            },
          }
        : {}),
      responses: {
        '200': {
          description: 'Success',
          content: {
            [responseType]:
              responseType === 'application/json'
                ? { schema: { $ref: '#/components/schemas/Success' } }
                : { schema: { type: 'string', format: 'binary' } },
          },
        },
        ...Object.fromEntries(
          Object.entries(FAILURES).map(([status, value]) => [
            status,
            {
              ...value,
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          ]),
        ),
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'MedSupply B2B API',
      version,
      description: [
        'B2B medicine supply management. Every response is enveloped: `{ data }` on success,',
        '`{ error: { code, message, correlationId } }` on failure.',
        '',
        'Monetary values are integer minor units (poisha). Timestamps are UTC ISO 8601 and are',
        'presented in Asia/Dhaka. Business actions that change state accept an `idempotencyKey`,',
        'and records under concurrent edit accept a `version` that is rejected when stale.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'This deployment' }],
    tags: [...new Set(OPERATIONS.map((operation) => operation.tag))].map((name) => ({ name })),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Access token from POST /api/v1/auth/login. The refresh token is delivered as an HTTP-only, SameSite=Strict cookie scoped to /api/v1/auth, and additionally in the body for the mobile client, which stores it in Expo SecureStore.',
        },
      },
      schemas: ENVELOPE,
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

/** Endpoint count, used by the reference page and the specification test. */
export const documentedOperationCount = OPERATIONS.length;
