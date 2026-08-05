/**
 * What each screen asks the API for the moment it opens.
 *
 * The input to the navigation reconciliation in `navigationRules.test.ts`. It
 * lives here rather than on `NavItem` for the same reason
 * `routeCoverage.waivers.ts` does: nothing at runtime consumes it, it is a
 * statement about how two independent things line up, and it reads as a table
 * because it is one.
 *
 * **"Cannot function without", not "ever calls".** A screen that hides an
 * administrator's panel from everybody else is working correctly; a screen
 * whose own content 403s is broken. Only the second belongs here, which is why
 * `security` names the session list a person came to see and not
 * `GET /admin/runtime`, and why `order-detail` names the order and not the
 * delivery record shown beside it when one exists.
 *
 * Paths are written in the OpenAPI notation — `{id}`, not `:id` — because that
 * is the notation `OPERATIONS` uses and one of the two had to win.
 */
export const SCREEN_READS: Readonly<Record<string, readonly string[]>> = {
  // ── Work ──────────────────────────────────────────────────────────────────
  orders: ['GET /api/v1/orders'],
  'order-entry': ['GET /api/v1/shops', 'GET /api/v1/inventory/medicines'],
  'order-detail': ['GET /api/v1/orders/{id}'],
  approvals: ['GET /api/v1/approvals/queue'],
  'approval-review': ['GET /api/v1/approvals/{id}'],
  fulfilment: ['GET /api/v1/fulfilment/queue'],
  'fulfilment-work': ['GET /api/v1/fulfilment/picking/{id}'],
  'fulfilment-ready': ['GET /api/v1/fulfilment/ready'],
  deliveries: ['GET /api/v1/deliveries'],
  'delivery-detail': ['GET /api/v1/deliveries/{id}'],
  trips: ['GET /api/v1/trips'],
  'trip-new': ['GET /api/v1/deliveries/personnel', 'GET /api/v1/trips/plannable'],
  'trip-detail': ['GET /api/v1/trips/{id}'],
  returns: ['GET /api/v1/returns'],
  'return-detail': ['GET /api/v1/returns/{id}'],
  'return-new': ['GET /api/v1/finance/my/invoices'],

  // ── Catalogue ─────────────────────────────────────────────────────────────
  medicines: ['GET /api/v1/inventory/medicines'],
  'medicine-detail': ['GET /api/v1/inventory/medicines/{id}'],
  // The edit form loads the record it is about to change. A create form has
  // nothing to read; this one cannot open without it.
  'medicine-edit': ['GET /api/v1/inventory/medicines/{id}'],
  'price-lists': ['GET /api/v1/pricing/price-lists'],
  'price-list-new': ['GET /api/v1/inventory/medicines'],
  'price-list-detail': ['GET /api/v1/inventory/medicines', 'GET /api/v1/pricing/price-lists/{id}'],
  schemes: ['GET /api/v1/pricing/schemes'],
  'scheme-new': ['GET /api/v1/inventory/medicines', 'GET /api/v1/shops'],
  'scheme-detail': [
    'GET /api/v1/inventory/medicines',
    'GET /api/v1/shops',
    'GET /api/v1/pricing/schemes/{id}',
  ],
  inventory: ['GET /api/v1/inventory/medicines', 'GET /api/v1/inventory/batches'],
  warehouses: ['GET /api/v1/inventory/warehouses'],
  stocktakes: ['GET /api/v1/stocktakes'],
  'stocktake-detail': ['GET /api/v1/stocktakes/{id}'],
  /*
   * Not a GET, and it belongs here anyway.
   *
   * The cart used to price itself from whole medicine objects kept in browser
   * storage, which is why it was excused as reading nothing. It now asks the
   * server what the basket costs — the same answer the order will be charged at
   * — so a shop owner refused this endpoint would see a cart with no prices in
   * it. That is precisely what this table exists to catch, and the rule reads
   * the method rather than assuming one.
   */
  cart: ['POST /api/v1/orders/quote'],
  checkout: ['GET /api/v1/shops/my'],

  // ── Buying in ─────────────────────────────────────────────────────────────
  suppliers: ['GET /api/v1/purchasing/suppliers'],
  'purchase-orders': ['GET /api/v1/purchasing/orders'],
  'purchase-order-new': ['GET /api/v1/purchasing/suppliers', 'GET /api/v1/inventory/medicines'],
  'purchase-order-detail': ['GET /api/v1/purchasing/orders/{id}'],
  'controlled-register': ['GET /api/v1/purchasing/controlled-register'],

  // ── Money ─────────────────────────────────────────────────────────────────
  payments: ['GET /api/v1/payments'],
  'payment-detail': ['GET /api/v1/payments/{id}'],
  'payment-new': ['GET /api/v1/shops'],
  collections: ['GET /api/v1/payments'],
  'shop-ledger': ['GET /api/v1/finance/shops/{shopId}/summary'],

  // ── Reports ───────────────────────────────────────────────────────────────
  analytics: ['GET /api/v1/reports/overview'],

  // ── Administration ────────────────────────────────────────────────────────
  shops: ['GET /api/v1/shops'],
  'shop-detail': ['GET /api/v1/shops/{id}'],
  'shop-new': ['GET /api/v1/pricing/price-lists'],
  users: ['GET /api/v1/admin/users'],
  settings: ['GET /api/v1/settings'],
  audit: ['GET /api/v1/admin/audit'],

  // ── My account ────────────────────────────────────────────────────────────
  'shop-account': ['GET /api/v1/finance/my/summary', 'GET /api/v1/finance/my/invoices'],
  'my-payments': ['GET /api/v1/payments'],
  'my-payment-detail': ['GET /api/v1/payments/{id}'],
  'my-statement': ['GET /api/v1/finance/my/statement'],
  notifications: ['GET /api/v1/notifications'],
  'notification-preferences': ['GET /api/v1/notifications/preferences'],
  activity: ['GET /api/v1/activity'],
  security: ['GET /api/v1/auth/sessions'],
};

/**
 * Screens with nothing to declare, and the reason.
 *
 * Not a burn-down list: a form that posts and never reads has no opening
 * request to reconcile, and inventing one for it would make the count look
 * better while checking nothing. Every entry states why, so a screen that later
 * grows a read is a line somebody has to justify deleting rather than a gap
 * that was always there.
 */
export const SCREENS_WITHOUT_READS: Readonly<Record<string, string>> = {
  dashboard: 'assembles itself from the tiles each role is permitted, with no read of its own',
  'medicine-new': 'a create form; it posts and never reads',
  'warehouse-new': 'a create form; it posts and never reads',
  'stocktake-new': 'a create form; it posts and never reads',
  'supplier-new': 'a create form; it posts and never reads',
  recall: 'searches on demand from a batch number nobody has typed yet',
  'shop-statement': 'renders the ledger already fetched by the screen that links to it',
  'change-password': 'a form; the only request it makes is the change itself',
  'analytics-sales': 'one report component; the endpoint is chosen from the route at render time',
  'analytics-returns': 'one report component; the endpoint is chosen from the route at render time',
  'analytics-inventory':
    'one report component; the endpoint is chosen from the route at render time',
  'analytics-deliveries':
    'one report component; the endpoint is chosen from the route at render time',
  'analytics-receivables':
    'one report component; the endpoint is chosen from the route at render time',
  'report-outstanding':
    'one report component; the endpoint is chosen from the route at render time',
  'report-overdue': 'one report component; the endpoint is chosen from the route at render time',
  'report-collections':
    'one report component; the endpoint is chosen from the route at render time',
};
