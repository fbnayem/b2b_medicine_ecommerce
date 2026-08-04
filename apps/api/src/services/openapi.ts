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

const OPERATIONS: Operation[] = [
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
  { method: 'get', path: '/api/v1/users', summary: 'List users', tag: 'Users', roles: ADMINS },
  {
    method: 'post',
    path: '/api/v1/users',
    summary: 'Create a user',
    tag: 'Users',
    roles: ADMINS,
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
    query: ['status', 'territory', 'search', 'page', 'limit'],
  },
  {
    method: 'post',
    path: '/api/v1/shops',
    summary: 'Register a shop',
    tag: 'Shops',
    roles: MANAGEMENT,
    body: CreateShopSchema,
  },

  // ── Catalogue and inventory ───────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/v1/inventory/medicines',
    summary: 'Search the medicine catalogue',
    tag: 'Inventory',
    roles: ALL_ROLES,
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
    roles: ALL_ROLES,
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
    path: '/api/v1/orders/{id}/cancellation-request',
    summary: 'Ask for an order to be cancelled',
    tag: 'Orders',
    roles: [UserRole.SHOP_OWNER],
    body: CancellationRequestSchema,
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
    method: 'post',
    path: '/api/v1/fulfilment/picking/{id}/pack',
    summary: 'Pack actual quantities and generate the final invoice',
    tag: 'Fulfilment',
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    body: PackingSchema,
  },
  {
    method: 'get',
    path: '/api/v1/fulfilment/invoices/{id}',
    summary: 'Read an issued invoice',
    tag: 'Fulfilment',
    roles: ALL_ROLES,
  },
  {
    method: 'get',
    path: '/api/v1/fulfilment/invoices/{id}/pdf',
    summary: 'Invoice as A4 or 80 mm thermal PDF',
    tag: 'Fulfilment',
    roles: ALL_ROLES,
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
    method: 'post',
    path: '/api/v1/deliveries/{id}/assign',
    summary: 'Assign a delivery to a delivery person',
    tag: 'Deliveries',
    roles: MANAGEMENT,
    body: DeliveryAssignmentSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/complete',
    summary: 'Complete a delivery with receiver proof and any collection',
    tag: 'Deliveries',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
    body: DeliveryCompletionSchema,
  },
  {
    method: 'post',
    path: '/api/v1/deliveries/{id}/fail',
    summary: 'Record a failed delivery attempt',
    tag: 'Deliveries',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
    body: DeliveryFailureSchema,
  },

  // ── Payments, ledger and finance ──────────────────────────────────────────
  {
    method: 'post',
    path: '/api/v1/payments',
    summary: 'Record a payment',
    tag: 'Payments',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
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
    path: '/api/v1/finance/shops/{shopId}/statement',
    summary: 'Customer statement for a period',
    tag: 'Finance',
    roles: MANAGEMENT,
    query: ['from', 'to', 'format'],
  },
  {
    method: 'post',
    path: '/api/v1/finance/adjustments',
    summary: 'Post a ledger adjustment',
    tag: 'Finance',
    roles: ADMINS,
    body: LedgerAdjustmentSchema,
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
    method: 'get',
    path: '/api/v1/admin/audit',
    summary: 'Read-only audit log',
    tag: 'Administration',
    roles: ADMINS,
    query: ['action', 'entityType', 'from', 'to', 'page', 'limit'],
  },

  // ── Returns ───────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/v1/returns',
    summary: 'List returns, filtered by role',
    tag: 'Returns',
    roles: ALL_ROLES,
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
    method: 'post',
    path: '/api/v1/returns/{id}/decision',
    summary: 'Approve, partially approve or reject requested lines',
    tag: 'Returns',
    roles: MANAGEMENT,
    body: ReturnDecisionSchema,
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
    roles: ALL_ROLES,
    query: RANGE,
  },
  {
    method: 'get',
    path: '/api/v1/reports/sales',
    summary: 'Sales summary and time series',
    tag: 'Reports',
    roles: ALL_ROLES,
    query: RANGE,
  },
  {
    method: 'get',
    path: '/api/v1/reports/sales/breakdown',
    summary: 'Sales by medicine, category, manufacturer, customer or territory',
    tag: 'Reports',
    roles: MANAGEMENT,
    query: [...RANGE, 'dimension', 'limit'],
  },
  {
    method: 'get',
    path: '/api/v1/reports/orders',
    summary: 'Order funnel with conversion and cycle times',
    tag: 'Reports',
    roles: MANAGEMENT,
    query: RANGE,
  },
  {
    method: 'get',
    path: '/api/v1/reports/inventory',
    summary: 'Inventory valuation, expiry buckets and dead stock',
    tag: 'Reports',
    roles: MANAGEMENT,
    query: ['asOf', 'format'],
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
    roles: MANAGEMENT,
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
];

/** JSON Schema for a Zod schema, expressed for a request body. */
function bodySchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  // The dialect marker belongs on the document, not on every operation.
  delete generated.$schema;
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
