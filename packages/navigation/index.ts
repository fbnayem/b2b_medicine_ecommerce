import { UserRole } from '@medsupply/shared-types';

/**
 * Navigation **policy**, shared. Navigation **rendering**, not shared.
 *
 * The web route manifest carries `React.lazy` components and Lucide icons, and
 * Metro can import neither. What both clients genuinely have in common is the
 * answer to two questions — what exists, and who may see it — so that is what
 * lives here, as plain data.
 *
 * The same matrix was previously written out three times: ten inline role
 * arrays in `App.tsx`, a hand-written tile grid in `Dashboard.tsx`, and mobile's
 * own guards. Three copies of a permission matrix is three chances to disagree
 * about who can see a customer's ledger.
 */

/** Icon names, resolved by each client to its own icon set. */
export type NavIcon =
  | 'home'
  | 'orders'
  | 'cart'
  | 'approvals'
  | 'warehouse'
  | 'delivery'
  | 'money'
  | 'reports'
  | 'shops'
  | 'catalogue'
  | 'returns'
  | 'settings'
  | 'purchasing'
  | 'recall'
  | 'bell'
  | 'activity'
  | 'account';

export type NavGroup =
  'work' | 'catalogue' | 'purchasing' | 'money' | 'insight' | 'administration' | 'account';

export const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  work: 'Work',
  catalogue: 'Catalogue',
  purchasing: 'Buying in',
  money: 'Money',
  insight: 'Reports',
  administration: 'Administration',
  account: 'My account',
};

export interface NavItem {
  /**
   * Stable identity, not a path. `/payments/:id` and `/account/payments/:id`
   * are the same component with different roles and different labels, so a path
   * cannot serve as the key.
   */
  id: string;
  label: string;
  path: string;
  roles: readonly UserRole[];
  group: NavGroup;
  icon: NavIcon;
  /** Hidden from the sidebar but still a real, permitted destination. */
  hidden?: boolean;
  /** Breadcrumb parent, **by id** — `/shops/:shopId/ledger`'s parent is not a path prefix of it. */
  parent?: string;
}

const MANAGEMENT = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER] as const;
const ADMINS = [UserRole.SUPER_ADMIN, UserRole.ADMIN] as const;
const EVERYONE = Object.values(UserRole);
const WAREHOUSE = [...MANAGEMENT, UserRole.STOREKEEPER] as const;

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'dashboard',
    label: 'Home',
    path: '/dashboard',
    roles: EVERYONE,
    group: 'work',
    icon: 'home',
  },

  // ── Work ──────────────────────────────────────────────────────────────────
  {
    /*
     * A rep works out of the order book; the list is scoped server-side.
     *
     * **Not `STOREKEEPER`.** They were offered this and `GET /api/v1/orders`
     * has never admitted them, so the menu item opened onto a 403. The API is
     * right and the menu was wrong: a storekeeper works from a pick list, and
     * the order behind it carries the customer's prices, credit terms and
     * discounts — commercial information that is not part of picking a box.
     * `fulfilment` already gives them the lines.
     */
    id: 'orders',
    label: 'Orders',
    path: '/orders',
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
    group: 'work',
    icon: 'orders',
  },
  {
    /*
     * Taking an order for somebody else.
     *
     * Not open to `SHOP_OWNER`: they have the cart, which submits for their own
     * shop, and this screen's first field asks which customer the order is for.
     * Offering them a customer picker they can only answer one way would be a
     * worse version of the screen they already have.
     */
    id: 'order-entry',
    label: 'Take an order',
    path: '/orders/new',
    roles: [...MANAGEMENT, UserRole.SALES],
    group: 'work',
    icon: 'orders',
  },
  {
    id: 'order-detail',
    label: 'Order',
    path: '/orders/:id',
    // Follows `orders` above, for the same reason.
    roles: [...MANAGEMENT, UserRole.SALES, UserRole.SHOP_OWNER],
    group: 'work',
    icon: 'orders',
    hidden: true,
    parent: 'orders',
  },
  {
    id: 'approvals',
    label: 'Approvals',
    path: '/approvals',
    roles: MANAGEMENT,
    group: 'work',
    icon: 'approvals',
  },
  {
    id: 'approval-review',
    label: 'Review order',
    path: '/approvals/:id',
    roles: MANAGEMENT,
    group: 'work',
    icon: 'approvals',
    hidden: true,
    parent: 'approvals',
  },
  {
    id: 'fulfilment',
    label: 'Picking',
    path: '/fulfilment',
    roles: WAREHOUSE,
    group: 'work',
    icon: 'warehouse',
  },
  {
    id: 'fulfilment-work',
    label: 'Pick list',
    path: '/fulfilment/:id',
    roles: WAREHOUSE,
    group: 'work',
    icon: 'warehouse',
    hidden: true,
    parent: 'fulfilment',
  },
  {
    id: 'fulfilment-ready',
    label: 'Ready to hand over',
    path: '/fulfilment/ready',
    roles: WAREHOUSE,
    group: 'work',
    icon: 'warehouse',
  },
  {
    id: 'deliveries',
    label: 'Deliveries',
    path: '/deliveries',
    // U10: DELIVERY_PERSON could reach 7 of 51 routes and could not open the
    // delivery board — their own work — on the web at all.
    roles: [...WAREHOUSE, UserRole.DELIVERY_PERSON, UserRole.SHOP_OWNER],
    group: 'work',
    icon: 'delivery',
  },
  {
    id: 'delivery-detail',
    label: 'Delivery',
    path: '/deliveries/:id',
    roles: [...WAREHOUSE, UserRole.DELIVERY_PERSON, UserRole.SHOP_OWNER],
    group: 'work',
    icon: 'delivery',
    hidden: true,
    parent: 'deliveries',
  },
  {
    /*
     * A rider reads their own round; the office plans it. The list is scoped
     * server-side, so this one entry serves both — a rider opening it sees
     * today's stops and nobody else's.
     */
    id: 'trips',
    label: 'Delivery rounds',
    path: '/deliveries/trips',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
    group: 'work',
    icon: 'delivery',
  },
  {
    id: 'trip-new',
    label: 'Plan a round',
    path: '/deliveries/trips/new',
    roles: MANAGEMENT,
    group: 'work',
    icon: 'delivery',
    hidden: true,
    parent: 'trips',
  },
  {
    id: 'trip-detail',
    label: 'Delivery round',
    path: '/deliveries/trips/:id',
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
    group: 'work',
    icon: 'delivery',
    hidden: true,
    parent: 'trips',
  },
  {
    /*
     * Everybody with a step in the return workflow, which is everybody except
     * a rep.
     *
     * This said `EVERYONE`, and `GET /api/v1/returns` admits six of the seven
     * roles: a shop owner raises a return, management reviews and decides it, a
     * rider collects it, the warehouse receives it. `SALES` has no step — they
     * cannot even raise one on a customer's behalf, which is the thing a rep
     * would most plausibly want to do — so offering them a menu item that 403s
     * is the worst of both. Taking returns on behalf of a customer, the way
     * orders already work, is a feature to decide on rather than a role to
     * widen quietly.
     */
    id: 'returns',
    label: 'Returns',
    path: '/returns',
    roles: [...WAREHOUSE, UserRole.DELIVERY_PERSON, UserRole.SHOP_OWNER],
    group: 'work',
    icon: 'returns',
  },
  {
    id: 'return-detail',
    label: 'Return',
    path: '/returns/:id',
    // Follows `returns` above, for the same reason.
    roles: [...WAREHOUSE, UserRole.DELIVERY_PERSON, UserRole.SHOP_OWNER],
    group: 'work',
    icon: 'returns',
    hidden: true,
    parent: 'returns',
  },
  {
    id: 'return-new',
    label: 'Request a return',
    path: '/returns/new',
    roles: [UserRole.SHOP_OWNER],
    group: 'work',
    icon: 'returns',
    hidden: true,
    parent: 'returns',
  },

  // ── Catalogue ─────────────────────────────────────────────────────────────
  {
    id: 'medicines',
    label: 'Medicines',
    path: '/medicines',
    roles: [...WAREHOUSE, UserRole.SALES, UserRole.SHOP_OWNER],
    group: 'catalogue',
    icon: 'catalogue',
  },
  {
    /*
     * `SALES` reads the catalogue list, both pricing screens and every scheme —
     * and until now could not open a medicine, so a rep who searched the
     * catalogue and clicked a result was refused by their own client. The
     * server's `catalogueReaders` has always allowed them the read.
     */
    id: 'medicine-detail',
    label: 'Medicine',
    path: '/medicines/:id',
    roles: [...WAREHOUSE, UserRole.SALES, UserRole.SHOP_OWNER],
    group: 'catalogue',
    icon: 'catalogue',
    hidden: true,
    parent: 'medicines',
  },
  {
    id: 'medicine-new',
    label: 'Add a medicine',
    path: '/medicines/new',
    roles: MANAGEMENT,
    group: 'catalogue',
    icon: 'catalogue',
    hidden: true,
    parent: 'medicines',
  },
  {
    /*
     * Changing a medicine, which nothing in this product could do.
     *
     * `PATCH /inventory/medicines/:id` has existed, been documented and been
     * tested since the catalogue was built, and no screen has ever called it —
     * so a typo in a stock code, a missing MRP or a line that should be
     * withdrawn could only be fixed by somebody with database access.
     *
     * `MANAGEMENT`, matching the server's `catalogueManagers`. A storekeeper
     * reads the catalogue and moves stock; the price on the pack is not theirs.
     */
    id: 'medicine-edit',
    label: 'Edit this medicine',
    path: '/medicines/:id/edit',
    roles: MANAGEMENT,
    group: 'catalogue',
    icon: 'catalogue',
    hidden: true,
    parent: 'medicine-detail',
  },
  /*
   * A rep reads the terms; a manager sets them.
   *
   * Quoting a customer means knowing what they pay and what offer is running,
   * so `SALES` reads both lists. The forms stay with management, because a
   * price list is the revenue of every order placed after it.
   */
  {
    id: 'price-lists',
    label: 'Price lists',
    path: '/pricing/price-lists',
    roles: [...MANAGEMENT, UserRole.SALES],
    group: 'catalogue',
    icon: 'money',
  },
  {
    id: 'price-list-new',
    label: 'Add a price list',
    path: '/pricing/price-lists/new',
    roles: MANAGEMENT,
    group: 'catalogue',
    icon: 'money',
    hidden: true,
    parent: 'price-lists',
  },
  {
    id: 'price-list-detail',
    label: 'Price list',
    path: '/pricing/price-lists/:id',
    roles: [...MANAGEMENT, UserRole.SALES],
    group: 'catalogue',
    icon: 'money',
    hidden: true,
    parent: 'price-lists',
  },
  {
    id: 'schemes',
    label: 'Free-goods offers',
    path: '/pricing/schemes',
    roles: [...MANAGEMENT, UserRole.SALES],
    group: 'catalogue',
    icon: 'money',
  },
  {
    id: 'scheme-new',
    label: 'Add an offer',
    path: '/pricing/schemes/new',
    roles: MANAGEMENT,
    group: 'catalogue',
    icon: 'money',
    hidden: true,
    parent: 'schemes',
  },
  {
    id: 'scheme-detail',
    label: 'Offer',
    path: '/pricing/schemes/:id',
    roles: [...MANAGEMENT, UserRole.SALES],
    group: 'catalogue',
    icon: 'money',
    hidden: true,
    parent: 'schemes',
  },
  {
    id: 'inventory',
    label: 'Stock',
    path: '/inventory',
    roles: WAREHOUSE,
    group: 'catalogue',
    icon: 'warehouse',
  },
  {
    id: 'warehouses',
    label: 'Warehouses',
    path: '/inventory/warehouses',
    roles: WAREHOUSE,
    group: 'catalogue',
    icon: 'warehouse',
  },
  {
    id: 'warehouse-new',
    label: 'Add a warehouse',
    path: '/inventory/warehouses/new',
    roles: MANAGEMENT,
    group: 'catalogue',
    icon: 'warehouse',
    hidden: true,
    parent: 'warehouses',
  },
  {
    /*
     * Counting is warehouse work; approving is not. The route is open to both,
     * and the server refuses a storekeeper who tries to post their own sheet —
     * because the whole value of a count as a control is that somebody else
     * accepts it.
     */
    id: 'stocktakes',
    label: 'Stock counts',
    path: '/inventory/stocktakes',
    roles: WAREHOUSE,
    group: 'catalogue',
    icon: 'warehouse',
  },
  {
    id: 'stocktake-new',
    label: 'Start a count',
    path: '/inventory/stocktakes/new',
    roles: WAREHOUSE,
    group: 'catalogue',
    icon: 'warehouse',
    hidden: true,
    parent: 'stocktakes',
  },
  {
    id: 'stocktake-detail',
    label: 'Stock count',
    path: '/inventory/stocktakes/:id',
    roles: WAREHOUSE,
    group: 'catalogue',
    icon: 'warehouse',
    hidden: true,
    parent: 'stocktakes',
  },
  {
    id: 'cart',
    label: 'Cart',
    path: '/cart',
    roles: [UserRole.SHOP_OWNER],
    group: 'catalogue',
    icon: 'cart',
  },
  {
    id: 'checkout',
    label: 'Checkout',
    path: '/checkout',
    roles: [UserRole.SHOP_OWNER],
    group: 'catalogue',
    icon: 'cart',
    hidden: true,
    parent: 'cart',
  },

  // ── Money ─────────────────────────────────────────────────────────────────
  {
    id: 'payments',
    label: 'Payments',
    path: '/payments',
    roles: MANAGEMENT,
    group: 'money',
    icon: 'money',
  },
  {
    id: 'payment-detail',
    label: 'Payment',
    path: '/payments/:id',
    roles: MANAGEMENT,
    group: 'money',
    icon: 'money',
    hidden: true,
    parent: 'payments',
  },
  {
    id: 'payment-new',
    label: 'Record a payment',
    path: '/payments/new',
    roles: MANAGEMENT,
    group: 'money',
    icon: 'money',
    hidden: true,
    parent: 'payments',
  },
  {
    id: 'collections',
    label: 'Rider collections',
    path: '/payments/collections',
    roles: MANAGEMENT,
    group: 'money',
    icon: 'money',
  },
  {
    id: 'shop-ledger',
    label: 'Customer ledger',
    path: '/shops/:shopId/ledger',
    roles: MANAGEMENT,
    group: 'money',
    icon: 'money',
    hidden: true,
    parent: 'shops',
  },
  {
    id: 'shop-statement',
    label: 'Customer statement',
    path: '/shops/:shopId/statement',
    roles: MANAGEMENT,
    group: 'money',
    icon: 'money',
    hidden: true,
    parent: 'shops',
  },
  {
    id: 'report-outstanding',
    label: 'Outstanding money',
    path: '/reports/outstanding',
    roles: MANAGEMENT,
    group: 'money',
    icon: 'reports',
  },
  {
    id: 'report-overdue',
    label: 'Overdue money',
    path: '/reports/overdue',
    roles: MANAGEMENT,
    group: 'money',
    icon: 'reports',
  },
  {
    id: 'report-collections',
    label: 'Collection summary',
    path: '/reports/collections',
    roles: MANAGEMENT,
    group: 'money',
    icon: 'reports',
  },

  // ── Purchasing ────────────────────────────────────────────────────────────
  /*
   * Suppliers, purchase orders, goods receipt, the recall trace and the
   * controlled-substance register.
   *
   * All five were built in phase 6, all five are covered by integration tests,
   * and **none of them appeared in any of the 51 navigation items** — so for
   * four phases the only way to reach them was curl. The two that matter most
   * for a DGDA-inspected distributor are the two that were hardest to reach:
   * the trace somebody needs under pressure, and the register an inspector
   * asks for.
   */
  {
    id: 'suppliers',
    label: 'Suppliers',
    path: '/purchasing/suppliers',
    roles: WAREHOUSE,
    group: 'purchasing',
    icon: 'purchasing',
  },
  {
    id: 'supplier-new',
    label: 'Add a supplier',
    path: '/purchasing/suppliers/new',
    roles: MANAGEMENT,
    group: 'purchasing',
    icon: 'purchasing',
    hidden: true,
    parent: 'suppliers',
  },
  {
    id: 'purchase-orders',
    label: 'Purchase orders',
    path: '/purchasing/orders',
    roles: WAREHOUSE,
    group: 'purchasing',
    icon: 'purchasing',
  },
  {
    id: 'purchase-order-new',
    label: 'Raise a purchase order',
    path: '/purchasing/orders/new',
    roles: MANAGEMENT,
    group: 'purchasing',
    icon: 'purchasing',
    hidden: true,
    parent: 'purchase-orders',
  },
  {
    id: 'purchase-order-detail',
    label: 'Purchase order',
    path: '/purchasing/orders/:id',
    roles: WAREHOUSE,
    group: 'purchasing',
    icon: 'purchasing',
    hidden: true,
    parent: 'purchase-orders',
  },
  {
    /*
     * Open to the warehouse, not only to management. The person who first hears
     * that a batch is suspect is usually the storekeeper holding the supplier's
     * notice, and making them find a manager before they can even look it up is
     * how an hour gets lost. Looking has no side effects.
     */
    id: 'recall',
    label: 'Trace a batch',
    path: '/purchasing/recall',
    roles: WAREHOUSE,
    group: 'purchasing',
    icon: 'recall',
  },
  {
    id: 'controlled-register',
    label: 'Prescription register',
    path: '/purchasing/controlled-register',
    roles: MANAGEMENT,
    group: 'purchasing',
    icon: 'recall',
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  {
    id: 'analytics',
    label: 'Overview',
    path: '/analytics',
    roles: MANAGEMENT,
    group: 'insight',
    icon: 'reports',
  },
  {
    id: 'analytics-sales',
    label: 'Sales report',
    path: '/analytics/sales',
    roles: [...MANAGEMENT, UserRole.SHOP_OWNER],
    group: 'insight',
    icon: 'reports',
  },
  {
    id: 'analytics-returns',
    label: 'Returns report',
    path: '/analytics/returns',
    roles: [...MANAGEMENT, UserRole.SHOP_OWNER],
    group: 'insight',
    icon: 'reports',
  },
  {
    id: 'analytics-inventory',
    label: 'Stock report',
    path: '/analytics/inventory',
    roles: WAREHOUSE,
    group: 'insight',
    icon: 'reports',
  },
  {
    id: 'analytics-deliveries',
    label: 'Delivery report',
    path: '/analytics/deliveries',
    roles: MANAGEMENT,
    group: 'insight',
    icon: 'reports',
  },
  {
    id: 'analytics-receivables',
    label: 'Receivables report',
    path: '/analytics/receivables',
    roles: MANAGEMENT,
    group: 'insight',
    icon: 'reports',
  },

  // ── Administration ────────────────────────────────────────────────────────
  {
    id: 'shops',
    label: 'Shops',
    path: '/shops',
    // A rep sees their territory here; the list is scoped server-side.
    roles: [...MANAGEMENT, UserRole.SALES],
    group: 'administration',
    icon: 'shops',
  },
  {
    id: 'shop-detail',
    label: 'Shop',
    path: '/shops/:id',
    roles: [...MANAGEMENT, UserRole.SALES],
    group: 'administration',
    icon: 'shops',
    hidden: true,
    parent: 'shops',
  },
  {
    id: 'shop-new',
    label: 'Add a shop',
    path: '/shops/new',
    roles: ADMINS,
    group: 'administration',
    icon: 'shops',
    hidden: true,
    parent: 'shops',
  },
  {
    id: 'users',
    label: 'People',
    path: '/admin/users',
    roles: MANAGEMENT,
    group: 'administration',
    icon: 'account',
  },
  {
    /*
     * Adding somebody, which nothing in this product could do.
     *
     * `POST /api/v1/users` has worked and been tested since phase 22 and never
     * had a caller: riders, storekeepers and administrators existed only
     * because the seed script made them.
     *
     * `MANAGEMENT`, matching the route. Which roles each of them may actually
     * grant is narrower and is decided by `assertAdministrable` — a manager
     * gets a delivery person or a storekeeper and nothing else.
     */
    id: 'user-new',
    label: 'Add a person',
    path: '/admin/users/new',
    roles: MANAGEMENT,
    group: 'administration',
    icon: 'account',
    hidden: true,
    parent: 'users',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/admin/settings',
    roles: ADMINS,
    group: 'administration',
    icon: 'settings',
  },
  {
    id: 'audit',
    label: 'Audit log',
    path: '/admin/audit',
    roles: ADMINS,
    group: 'administration',
    icon: 'activity',
  },

  // ── My account ────────────────────────────────────────────────────────────
  {
    id: 'shop-account',
    label: 'My account',
    path: '/account',
    roles: [UserRole.SHOP_OWNER],
    group: 'account',
    icon: 'account',
  },
  {
    id: 'my-payments',
    label: 'My payments',
    path: '/account/payments',
    roles: [UserRole.SHOP_OWNER],
    group: 'account',
    icon: 'money',
  },
  {
    id: 'my-payment-detail',
    label: 'Payment',
    path: '/account/payments/:id',
    roles: [UserRole.SHOP_OWNER],
    group: 'account',
    icon: 'money',
    hidden: true,
    parent: 'my-payments',
  },
  {
    id: 'my-statement',
    label: 'My statement',
    path: '/account/statement',
    roles: [UserRole.SHOP_OWNER],
    group: 'account',
    icon: 'money',
  },
  {
    /*
     * Where a customer's deliveries go, maintained by the customer.
     *
     * Shop owner only, and deliberately not staff: an administrator changes the
     * same field through `PATCH /shops/{id}`, which carries the credit limit,
     * payment terms, discount and price list with it. Two doors onto one fact
     * is acceptable when they are genuinely different decisions; giving staff
     * this one as well would be two doors onto the *same* decision with
     * different audit actions behind them.
     */
    id: 'addresses',
    label: 'Delivery addresses',
    path: '/account/addresses',
    roles: [UserRole.SHOP_OWNER],
    group: 'account',
    icon: 'shops',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: '/notifications',
    roles: EVERYONE,
    group: 'account',
    icon: 'bell',
  },
  {
    id: 'notification-preferences',
    label: 'Notification settings',
    path: '/notifications/preferences',
    roles: EVERYONE,
    group: 'account',
    icon: 'bell',
    hidden: true,
    parent: 'notifications',
  },
  {
    id: 'activity',
    label: 'Activity',
    path: '/activity',
    roles: EVERYONE,
    group: 'account',
    icon: 'activity',
  },
  {
    id: 'change-password',
    label: 'Change your password',
    path: '/account/password',
    roles: EVERYONE,
    group: 'account',
    icon: 'settings',
    hidden: true,
    parent: 'security',
  },
  {
    id: 'security',
    label: 'Sign-in and security',
    path: '/account/security',
    roles: EVERYONE,
    group: 'account',
    icon: 'settings',
  },
];

export const NAV_BY_ID: Readonly<Record<string, NavItem>> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.id, item]),
);

export function navItemsFor(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.hidden && item.roles.includes(role));
}

/**
 * The five items in a role's bottom tab bar.
 *
 * A fixed-length tuple, so `AGENTS.md`'s "5 items per role" is a **compile-time**
 * guarantee rather than a rule somebody remembers. Mobile had no tab navigation
 * at all — one `Stack` of thirty screens and a vertical list of buttons.
 */
export type MobileTabs = readonly [string, string, string, string, string];

export const MOBILE_TABS: Record<UserRole, MobileTabs> = {
  [UserRole.SUPER_ADMIN]: ['dashboard', 'approvals', 'orders', 'payments', 'settings'],
  [UserRole.ADMIN]: ['dashboard', 'approvals', 'orders', 'payments', 'settings'],
  [UserRole.MANAGER]: ['dashboard', 'approvals', 'orders', 'payments', 'analytics'],
  [UserRole.STOREKEEPER]: ['dashboard', 'fulfilment', 'fulfilment-ready', 'inventory', 'returns'],
  [UserRole.DELIVERY_PERSON]: ['dashboard', 'deliveries', 'returns', 'notifications', 'security'],
  /*
   * A rep takes orders, so taking an order is a tab.
   *
   * This was `medicines`, the catalogue, because placing an order was web-only:
   * the mobile cart submits for the signed-in owner's own shop, so a rep who
   * filled it was told no shop is assigned to their account. That is now a real
   * screen, and a rep standing in a shop with a phone in one hand needs it in
   * one tap rather than on a desktop they are nowhere near.
   *
   * The catalogue is not lost by the swap — order entry's first control is a
   * search across the same medicines, so it is now where a rep actually uses it
   * rather than a list they browse and then cannot act on.
   */
  [UserRole.SALES]: ['dashboard', 'order-entry', 'orders', 'notifications', 'security'],
  [UserRole.SHOP_OWNER]: ['dashboard', 'medicines', 'cart', 'orders', 'shop-account'],
};

/** Where each role lands after signing in. */
export const LANDING_ROUTE: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: '/dashboard',
  [UserRole.ADMIN]: '/dashboard',
  [UserRole.MANAGER]: '/dashboard',
  [UserRole.STOREKEEPER]: '/dashboard',
  [UserRole.DELIVERY_PERSON]: '/dashboard',
  [UserRole.SALES]: '/dashboard',
  [UserRole.SHOP_OWNER]: '/dashboard',
};

export function landingRouteFor(role: UserRole): string {
  return LANDING_ROUTE[role] ?? '/dashboard';
}

/** The breadcrumb trail for a route id, outermost first. */
export function breadcrumbFor(id: string): NavItem[] {
  const trail: NavItem[] = [];
  let current: NavItem | undefined = NAV_BY_ID[id];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift(current);
    current = current.parent ? NAV_BY_ID[current.parent] : undefined;
  }
  return trail;
}

// ── Three applications, one codebase ─────────────────────────────────────────

/**
 * Which of the three mobile applications a build is.
 *
 * Mobile has always been **one** application that changed shape after sign-in.
 * That is defensible for a desktop browser, where the product is a URL and the
 * person choosing it is at a keyboard. It is not what gets installed on a
 * phone: a pharmacy owner should find the shop in a store listing that talks
 * about ordering medicines, and a rider should open an icon that is about
 * today's round and contains nothing else. One binary called "MedSupply B2B"
 * serving all three means every store listing, every notification, every icon
 * and every permission prompt is written for an audience of nobody in
 * particular.
 *
 * So there are three, built from this one codebase and separated at build time
 * by `APP_VARIANT`. What differs is identity — name, bundle identifier, icon,
 * store listing — and **who may sign in**. What is shared is every screen, the
 * navigation policy above, and the whole of `packages/`.
 *
 * The split is written here rather than in `apps/mobile` for the same reason
 * `MOBILE_TABS` is: it is a statement about who sees what, and this is the file
 * that is allowed to make those.
 */
export const AppVariant = {
  /** For the pharmacy that buys. */
  SHOP: 'shop',
  /** For the distributor's own people — the office and the warehouse. */
  STAFF: 'staff',
  /** For the person carrying the boxes. */
  RIDER: 'rider',
} as const;

export type AppVariant = (typeof AppVariant)[keyof typeof AppVariant];

export const APP_VARIANTS: readonly AppVariant[] = Object.values(AppVariant);

export function isAppVariant(value: unknown): value is AppVariant {
  return typeof value === 'string' && (APP_VARIANTS as readonly string[]).includes(value);
}

/**
 * Who may sign in to each application.
 *
 * **Every role appears exactly once**, and `navigationRules.test.ts` asserts
 * it — a role in neither has an account that opens nothing, and a role in two
 * makes "which app do I install?" unanswerable at the moment somebody is
 * standing in a store listing trying to decide.
 *
 * The two judgement calls, stated rather than left to be inferred:
 *
 *   - **A storekeeper and a rep are staff, not their own apps.** Both work for
 *     the distributor, both are salaried, and both are handed a phone by the
 *     same person who hands one to a manager. Three apps was the ask; five
 *     would be three store listings nobody asked for and two more icons on the
 *     same warehouse handset.
 *   - **A rider is separate even though a rider is also staff.** A round is the
 *     whole job for eight hours, one-handed, outdoors, on a handset that is
 *     often not the rider's own. That app should contain deliveries, returns
 *     and proof capture — and being unable to reach an approvals queue is a
 *     feature of it, not a limitation.
 */
export const VARIANT_ROLES: Record<AppVariant, readonly UserRole[]> = {
  [AppVariant.SHOP]: [UserRole.SHOP_OWNER],
  [AppVariant.STAFF]: [
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.STOREKEEPER,
    UserRole.SALES,
  ],
  [AppVariant.RIDER]: [UserRole.DELIVERY_PERSON],
};

/**
 * English names, resolved through the catalogue by each client.
 *
 * Same arrangement as `NAV_GROUP_LABEL` and for the same reason: Metro imports
 * this package, so it cannot depend on `@medsupply/i18n`. These are the
 * fallback, not the string a person reads.
 */
export const APP_VARIANT_NAME: Record<AppVariant, string> = {
  [AppVariant.SHOP]: 'MedSupply Shop',
  [AppVariant.STAFF]: 'MedSupply Manage',
  [AppVariant.RIDER]: 'MedSupply Rider',
};

/** Which application a person with this role should be holding. */
export function variantForRole(role: UserRole): AppVariant | undefined {
  return APP_VARIANTS.find((variant) => VARIANT_ROLES[variant].includes(role));
}

export function rolesForVariant(variant: AppVariant): readonly UserRole[] {
  return VARIANT_ROLES[variant];
}

export function isRoleInVariant(role: UserRole, variant: AppVariant): boolean {
  return VARIANT_ROLES[variant].includes(role);
}

/**
 * Every tab id any of this application's roles can be given, de-duplicated.
 *
 * This is the answer to "what is in the rider app?" — the sentence a store
 * listing is written from, and what the build guide documents. It is
 * deliberately **not** a router-level filter: Expo Router registers a route for
 * every file present, and a file omitted from the tab layout's list is
 * auto-registered into the bar with a default title, which is worse than
 * `href: null`. Membership of the bar is decided by role, and roles partition
 * across variants, so the two agree by construction — `navigationRules.test.ts`
 * asserts that rather than trusting it.
 */
export function tabIdsForVariant(variant: AppVariant): readonly string[] {
  return [...new Set(VARIANT_ROLES[variant].flatMap((role) => MOBILE_TABS[role]))];
}
