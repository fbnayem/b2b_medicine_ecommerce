/**
 * One name for every cached thing.
 *
 * Nobody invalidates what they cannot name. Keys were invented at each use
 * site, so the catalogue alone was cached under five different shapes —
 * `['medicines', query]`, `['medicines','all']`, `['medicines','for-receipt']`,
 * `['medicine-search', term]`, `['medicine', id]` — of which two fetched the
 * *identical URL* into two separate entries. Shops had six roots, and two of
 * them (`['my-shops']`, `['active-shops']`) did not even share the `shops`
 * prefix, so a shop change could not be expressed as one invalidation at all.
 *
 * Worse than untidy: `['delivery-personnel']` was written as a raw array by
 * `TripForm` and as a paged collection by `DeliveryDetail`, under one key with
 * a five-minute retention. Visiting one then the other inside five minutes
 * crashed the page on `.find is not a function`.
 *
 * Two rules follow from this file existing.
 *
 * **Every query key comes from here.** `queryKeyDiscipline.test.ts` fails a
 * key array literal written anywhere else.
 *
 * **A mutation invalidates the entity family, not the row it changed.** Every
 * family's members share its `all` prefix, so
 * `invalidateQueries({ queryKey: keys.medicines.all })` reaches the list, the
 * search, the detail and that medicine's batches in one call. Narrow
 * invalidation is how nine mutations came to refresh a detail page and leave
 * the queue they were reached from showing the old answer.
 *
 * `filters` is deliberately one opaque value rather than a spread of named
 * parts. TanStack hashes it deterministically whatever shape it is, and a
 * single parameter means a screen adding a filter cannot silently change its
 * key's arity and orphan the old entry.
 */

type Filters = unknown;

const family = <T extends string>(name: T) => [name] as const;

export const keys = {
  /** The catalogue. `one(id)` is a prefix of `batches(id)` on purpose. */
  medicines: {
    all: family('medicines'),
    list: (filters: Filters) => ['medicines', 'list', filters] as const,
    /** The type-ahead in order entry. Same records, different question. */
    search: (term: string) => ['medicines', 'search', term] as const,
    /** The whole-catalogue feed behind a picker. */
    picker: () => ['medicines', 'picker'] as const,
    one: (id: string) => ['medicines', 'one', id] as const,
    batches: (id: string) => ['medicines', 'one', id, 'batches'] as const,
  },

  /** Batches, movements and where things are kept. */
  stock: {
    all: family('stock'),
    batches: (filters: Filters) => ['stock', 'batches', filters] as const,
    movements: (filters: Filters) => ['stock', 'movements', filters] as const,
    warehouses: () => ['stock', 'warehouses'] as const,
  },

  stocktakes: {
    all: family('stocktakes'),
    list: (filters: Filters) => ['stocktakes', 'list', filters] as const,
    one: (id: string) => ['stocktakes', 'one', id] as const,
  },

  /**
   * Delivery people.
   *
   * Named for what a user calls them. The endpoint says `personnel` and the
   * delivery document says `assignedTo`; neither is a word anybody speaks.
   */
  riders: {
    all: family('riders'),
    list: () => ['riders', 'list'] as const,
  },

  orders: {
    all: family('orders'),
    list: (filters: Filters) => ['orders', 'list', filters] as const,
    one: (id: string) => ['orders', 'one', id] as const,
    /** The delivery raised from an order, read from the order's own screen. */
    delivery: (id: string) => ['orders', 'one', id, 'delivery'] as const,
    /** What the server says a basket would cost. Never computed client-side. */
    quote: (shopId: string, lines: readonly string[]) =>
      ['orders', 'quote', shopId, lines] as const,
  },

  approvals: {
    all: family('approvals'),
    queue: (status: string) => ['approvals', 'queue', status] as const,
    one: (id: string) => ['approvals', 'one', id] as const,
  },

  shops: {
    all: family('shops'),
    list: (filters: Filters) => ['shops', 'list', filters] as const,
    picker: (filters: Filters) => ['shops', 'picker', filters] as const,
    one: (id: string) => ['shops', 'one', id] as const,
    /** The signed-in shop owner's own shops. */
    mine: () => ['shops', 'mine'] as const,
  },

  priceLists: {
    all: family('price-lists'),
    list: (filters: Filters) => ['price-lists', 'list', filters] as const,
    one: (id: string) => ['price-lists', 'one', id] as const,
  },

  schemes: {
    all: family('schemes'),
    list: (filters: Filters) => ['schemes', 'list', filters] as const,
    one: (id: string) => ['schemes', 'one', id] as const,
  },

  fulfilment: {
    all: family('fulfilment'),
    queue: (status: string) => ['fulfilment', 'queue', status] as const,
    ready: () => ['fulfilment', 'ready'] as const,
    picking: (id: string) => ['fulfilment', 'picking', id] as const,
  },

  deliveries: {
    all: family('deliveries'),
    list: (filters: Filters) => ['deliveries', 'list', filters] as const,
    one: (id: string) => ['deliveries', 'one', id] as const,
  },

  trips: {
    all: family('trips'),
    list: (filters: Filters) => ['trips', 'list', filters] as const,
    one: (id: string) => ['trips', 'one', id] as const,
    /** Deliveries that could go on a round, scoped to a rider. */
    plannable: (riderId: string) => ['trips', 'plannable', riderId] as const,
  },

  payments: {
    all: family('payments'),
    list: (filters: Filters) => ['payments', 'list', filters] as const,
    one: (id: string) => ['payments', 'one', id] as const,
    pending: () => ['payments', 'pending'] as const,
    mine: (page: number) => ['payments', 'mine', page] as const,
  },

  /**
   * Money owed and money received.
   *
   * One family, because a payment moves every figure in it at once — the
   * summary, the ledger, the open invoices and the statement all change
   * together or the screen is lying about a balance.
   */
  finance: {
    all: family('finance'),
    myInvoices: (filters: Filters) => ['finance', 'my-invoices', filters] as const,
    mySummary: () => ['finance', 'my-summary'] as const,
    shopSummary: (shopId: string) => ['finance', 'shop-summary', shopId] as const,
    shopLedger: (shopId: string, filters: Filters) =>
      ['finance', 'shop-ledger', shopId, filters] as const,
    shopOpenInvoices: (shopId: string) => ['finance', 'shop-open-invoices', shopId] as const,
    invoiceLines: (invoiceId: string) => ['finance', 'invoice-lines', invoiceId] as const,
    statement: (subject: string, filters: Filters) =>
      ['finance', 'statement', subject, filters] as const,
    report: (kind: string, filters: Filters) => ['finance', 'report', kind, filters] as const,
    reportSummary: (filters: Filters) => ['finance', 'report-summary', filters] as const,
  },

  returns: {
    all: family('returns'),
    list: (filters: Filters) => ['returns', 'list', filters] as const,
    one: (id: string) => ['returns', 'one', id] as const,
  },

  purchasing: {
    all: family('purchasing'),
    orders: (filters: Filters) => ['purchasing', 'orders', filters] as const,
    order: (id: string) => ['purchasing', 'order', id] as const,
    suppliers: (filters: Filters) => ['purchasing', 'suppliers', filters] as const,
    controlledRegister: (filters: Filters) =>
      ['purchasing', 'controlled-register', filters] as const,
  },

  notifications: {
    all: family('notifications'),
    list: (filters: Filters) => ['notifications', 'list', filters] as const,
    /** Which kinds of notification exist, and what each is called. */
    catalogue: () => ['notifications', 'catalogue'] as const,
    /** This person's choice of channel per kind. */
    preferences: () => ['notifications', 'preferences'] as const,
  },

  activity: {
    all: family('activity'),
    list: (filters: Filters) => ['activity', 'list', filters] as const,
  },

  users: {
    all: family('users'),
    list: (filters: Filters) => ['users', 'list', filters] as const,
  },

  audit: {
    all: family('audit'),
    list: (filters: Filters) => ['audit', 'list', filters] as const,
    actions: () => ['audit', 'actions'] as const,
  },

  /** Sessions and the runtime posture, on the security screen. */
  security: {
    all: family('security'),
    sessions: () => ['security', 'sessions'] as const,
    runtime: () => ['security', 'runtime'] as const,
  },

  settings: {
    all: family('settings'),
    current: () => ['settings', 'current'] as const,
    /** The tenant's own name, symbol, timezone and date format. */
    branding: () => ['settings', 'branding'] as const,
  },

  analytics: {
    all: family('analytics'),
    overview: (filters: Filters) => ['analytics', 'overview', filters] as const,
    report: (kind: string, filters: Filters) => ['analytics', 'report', kind, filters] as const,
    breakdown: (filters: Filters, dimension: string) =>
      ['analytics', 'breakdown', filters, dimension] as const,
  },
} as const;
