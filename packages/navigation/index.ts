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
  | 'bell'
  | 'activity'
  | 'account';

export type NavGroup = 'work' | 'catalogue' | 'money' | 'insight' | 'administration' | 'account';

export const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  work: 'Work',
  catalogue: 'Catalogue',
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
    id: 'orders',
    label: 'Orders',
    path: '/orders',
    roles: [...WAREHOUSE, UserRole.SHOP_OWNER],
    group: 'work',
    icon: 'orders',
  },
  {
    id: 'order-detail',
    label: 'Order',
    path: '/orders/:id',
    roles: [...WAREHOUSE, UserRole.SHOP_OWNER],
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
    id: 'returns',
    label: 'Returns',
    path: '/returns',
    roles: EVERYONE,
    group: 'work',
    icon: 'returns',
  },
  {
    id: 'return-detail',
    label: 'Return',
    path: '/returns/:id',
    roles: EVERYONE,
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
    roles: [...WAREHOUSE, UserRole.SHOP_OWNER],
    group: 'catalogue',
    icon: 'catalogue',
  },
  {
    id: 'medicine-detail',
    label: 'Medicine',
    path: '/medicines/:id',
    roles: [...WAREHOUSE, UserRole.SHOP_OWNER],
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
    id: 'inventory',
    label: 'Stock',
    path: '/inventory',
    roles: WAREHOUSE,
    group: 'catalogue',
    icon: 'warehouse',
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
    roles: MANAGEMENT,
    group: 'administration',
    icon: 'shops',
  },
  {
    id: 'shop-detail',
    label: 'Shop',
    path: '/shops/:id',
    roles: MANAGEMENT,
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
  [UserRole.SHOP_OWNER]: ['dashboard', 'medicines', 'cart', 'orders', 'shop-account'],
};

/** Where each role lands after signing in. */
export const LANDING_ROUTE: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: '/dashboard',
  [UserRole.ADMIN]: '/dashboard',
  [UserRole.MANAGER]: '/dashboard',
  [UserRole.STOREKEEPER]: '/dashboard',
  [UserRole.DELIVERY_PERSON]: '/dashboard',
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
