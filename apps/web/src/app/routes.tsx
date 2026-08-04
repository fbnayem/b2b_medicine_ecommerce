import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { matchPath } from 'react-router-dom';
import { NAV_BY_ID, type NavItem } from '@medsupply/navigation';

/**
 * Every route, once.
 *
 * `App.tsx` was 208 lines of nested `<Route>` elements carrying ten inline role
 * arrays, `Dashboard.tsx` hand-wrote the same matrix as a tile grid, and mobile
 * kept a third copy in its guards. Permissions written down three times are
 * permissions that will eventually disagree — and the one that disagrees
 * quietly is the one that lets the wrong person read a customer's ledger.
 *
 * Roles and paths now come from `@medsupply/navigation`, which mobile shares.
 * What stays here is the part mobile cannot use: the component, lazily loaded,
 * and any props it needs.
 */

/**
 * Every page in this application is a **named** export, and `React.lazy` wants
 * a module with a `default`. This adapts one to the other.
 *
 * The import specifier must be a literal at each call site: a variable would
 * make Rollup glob the whole directory back into one chunk, which is precisely
 * the 546 kB chunk this is meant to split.
 */
function lazyNamed<T extends ComponentType<Record<string, never>>>(
  loader: () => Promise<Record<string, unknown>>,
  name: string,
): LazyExoticComponent<T> {
  return lazy(async () => {
    const module = await loader();
    const component = module[name];
    if (!component) {
      throw new Error(
        `The route manifest expects a named export "${name}" from this module and it is absent.`,
      );
    }
    return { default: component as T };
  });
}

export interface RouteNode {
  /** Matches a `NavItem.id`, which supplies the path, the roles and the label. */
  id: string;
  element: LazyExoticComponent<ComponentType<Record<string, never>>>;
  /**
   * Props the manifest supplies. `<PaymentList ownerMode />` and
   * `<PaymentList />` are the same component with different meanings, and that
   * is not otherwise expressible declaratively.
   */
  props?: Record<string, unknown>;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- lazyNamed erases the per-page prop types. */
const page = (loader: () => Promise<Record<string, unknown>>, name: string) =>
  lazyNamed<any>(loader, name);

export const ROUTES: readonly RouteNode[] = [
  { id: 'dashboard', element: page(() => import('../pages/Dashboard'), 'Dashboard') },

  { id: 'orders', element: page(() => import('../pages/OrderList'), 'OrderList') },
  { id: 'order-detail', element: page(() => import('../pages/OrderDetail'), 'OrderDetail') },
  { id: 'approvals', element: page(() => import('../pages/ApprovalQueue'), 'ApprovalQueue') },
  {
    id: 'approval-review',
    element: page(() => import('../pages/ApprovalReview'), 'ApprovalReview'),
  },
  { id: 'fulfilment', element: page(() => import('../pages/FulfilmentQueue'), 'FulfilmentQueue') },
  {
    id: 'fulfilment-work',
    element: page(() => import('../pages/FulfilmentWork'), 'FulfilmentWork'),
  },
  { id: 'fulfilment-ready', element: page(() => import('../pages/ReadyQueue'), 'ReadyQueue') },
  { id: 'deliveries', element: page(() => import('../pages/DeliveryBoard'), 'DeliveryBoard') },
  {
    id: 'delivery-detail',
    element: page(() => import('../pages/DeliveryDetail'), 'DeliveryDetail'),
  },
  { id: 'trips', element: page(() => import('../pages/TripList'), 'TripList') },
  { id: 'trip-new', element: page(() => import('../pages/TripForm'), 'TripForm') },
  { id: 'trip-detail', element: page(() => import('../pages/TripSheet'), 'TripSheet') },
  { id: 'returns', element: page(() => import('../pages/ReturnList'), 'ReturnList') },
  { id: 'return-detail', element: page(() => import('../pages/ReturnDetail'), 'ReturnDetail') },
  { id: 'return-new', element: page(() => import('../pages/ReturnRequest'), 'ReturnRequest') },

  { id: 'medicines', element: page(() => import('../pages/MedicineList'), 'MedicineList') },
  {
    id: 'medicine-detail',
    element: page(() => import('../pages/MedicineDetail'), 'MedicineDetail'),
  },
  { id: 'medicine-new', element: page(() => import('../pages/MedicineForm'), 'MedicineForm') },
  { id: 'price-lists', element: page(() => import('../pages/PriceListList'), 'PriceListList') },
  { id: 'price-list-new', element: page(() => import('../pages/PriceListForm'), 'PriceListForm') },
  {
    id: 'price-list-detail',
    element: page(() => import('../pages/PriceListForm'), 'PriceListForm'),
    // The same form, editing rather than creating. Two ids because the label,
    // the breadcrumb and the roles differ, which is what the manifest is for.
    props: { mode: 'edit' },
  },
  { id: 'schemes', element: page(() => import('../pages/SchemeList'), 'SchemeList') },
  { id: 'scheme-new', element: page(() => import('../pages/SchemeForm'), 'SchemeForm') },
  {
    id: 'scheme-detail',
    element: page(() => import('../pages/SchemeForm'), 'SchemeForm'),
    props: { mode: 'edit' },
  },
  {
    id: 'inventory',
    element: page(() => import('../pages/InventoryDashboard'), 'InventoryDashboard'),
  },
  { id: 'warehouses', element: page(() => import('../pages/WarehouseList'), 'WarehouseList') },
  {
    id: 'warehouse-new',
    element: page(() => import('../pages/WarehouseForm'), 'WarehouseForm'),
  },
  { id: 'stocktakes', element: page(() => import('../pages/StocktakeList'), 'StocktakeList') },
  {
    id: 'stocktake-new',
    element: page(() => import('../pages/StocktakeForm'), 'StocktakeForm'),
  },
  {
    id: 'stocktake-detail',
    element: page(() => import('../pages/StocktakeSheet'), 'StocktakeSheet'),
  },
  { id: 'cart', element: page(() => import('../pages/Cart'), 'Cart') },
  { id: 'checkout', element: page(() => import('../pages/Checkout'), 'Checkout') },

  {
    id: 'suppliers',
    element: page(() => import('../pages/SupplierList'), 'SupplierList'),
  },
  {
    id: 'supplier-new',
    element: page(() => import('../pages/SupplierForm'), 'SupplierForm'),
  },
  {
    id: 'purchase-orders',
    element: page(() => import('../pages/PurchaseOrderList'), 'PurchaseOrderList'),
  },
  {
    id: 'purchase-order-new',
    element: page(() => import('../pages/PurchaseOrderForm'), 'PurchaseOrderForm'),
  },
  {
    id: 'purchase-order-detail',
    element: page(() => import('../pages/PurchaseOrderDetail'), 'PurchaseOrderDetail'),
  },
  { id: 'recall', element: page(() => import('../pages/RecallTrace'), 'RecallTrace') },
  {
    id: 'controlled-register',
    element: page(() => import('../pages/ControlledRegister'), 'ControlledRegister'),
  },

  { id: 'payments', element: page(() => import('../pages/PaymentList'), 'PaymentList') },
  { id: 'payment-detail', element: page(() => import('../pages/PaymentDetail'), 'PaymentDetail') },
  { id: 'payment-new', element: page(() => import('../pages/RecordPayment'), 'RecordPayment') },
  {
    id: 'collections',
    element: page(() => import('../pages/CollectionReview'), 'CollectionReview'),
  },
  { id: 'shop-ledger', element: page(() => import('../pages/CustomerLedger'), 'CustomerLedger') },
  {
    id: 'shop-statement',
    element: page(() => import('../pages/CustomerStatement'), 'CustomerStatement'),
  },
  {
    id: 'report-outstanding',
    element: page(() => import('../pages/FinancialReports'), 'OutstandingReport'),
  },
  {
    id: 'report-overdue',
    element: page(() => import('../pages/FinancialReports'), 'OverdueReport'),
  },
  {
    id: 'report-collections',
    element: page(() => import('../pages/FinancialReports'), 'CollectionReport'),
  },

  {
    id: 'analytics',
    element: page(() => import('../pages/AnalyticsDashboard'), 'AnalyticsDashboard'),
  },
  {
    id: 'analytics-sales',
    element: page(() => import('../pages/AnalyticsReports'), 'SalesAnalytics'),
  },
  {
    id: 'analytics-returns',
    element: page(() => import('../pages/AnalyticsReports'), 'ReturnsAnalytics'),
  },
  {
    id: 'analytics-inventory',
    element: page(() => import('../pages/AnalyticsReports'), 'InventoryAnalytics'),
  },
  {
    id: 'analytics-deliveries',
    element: page(() => import('../pages/AnalyticsReports'), 'DeliveryAnalytics'),
  },
  {
    id: 'analytics-receivables',
    element: page(() => import('../pages/AnalyticsReports'), 'ReceivablesAnalytics'),
  },

  { id: 'shops', element: page(() => import('../pages/ShopList'), 'ShopList') },
  { id: 'shop-detail', element: page(() => import('../pages/ShopDetail'), 'ShopDetail') },
  { id: 'shop-new', element: page(() => import('../pages/ShopForm'), 'ShopForm') },
  {
    id: 'users',
    element: page(() => import('../pages/UserAdministration'), 'UserAdministration'),
  },
  { id: 'settings', element: page(() => import('../pages/SystemSettings'), 'SystemSettings') },
  { id: 'audit', element: page(() => import('../pages/AuditLogViewer'), 'AuditLogViewer') },

  { id: 'shop-account', element: page(() => import('../pages/ShopAccount'), 'ShopAccount') },
  {
    id: 'my-payments',
    element: page(() => import('../pages/PaymentList'), 'PaymentList'),
    props: { ownerMode: true },
  },
  {
    id: 'my-payment-detail',
    element: page(() => import('../pages/PaymentDetail'), 'PaymentDetail'),
    props: { ownerMode: true },
  },
  {
    id: 'my-statement',
    element: page(() => import('../pages/CustomerStatement'), 'CustomerStatement'),
    props: { ownerMode: true },
  },
  { id: 'notifications', element: page(() => import('../pages/Notifications'), 'Notifications') },
  {
    id: 'notification-preferences',
    element: page(() => import('../pages/NotificationPreferences'), 'NotificationPreferences'),
  },
  { id: 'activity', element: page(() => import('../pages/ActivityFeed'), 'ActivityFeed') },
  { id: 'security', element: page(() => import('../pages/SecurityCentre'), 'SecurityCentre') },
  {
    id: 'change-password',
    element: page(() => import('../pages/ChangePassword'), 'ChangePassword'),
  },
];
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ResolvedRoute extends RouteNode {
  nav: NavItem;
}

/**
 * Which manifest entry a pathname corresponds to.
 *
 * The obvious way to answer this is `useMatches()` reading a `handle`, but that
 * is a data-router API and this application mounts `<BrowserRouter>`; calling it
 * throws at runtime while typechecking perfectly. Matching the manifest
 * directly needs no migration and keeps the manifest as the single description
 * of what exists.
 *
 * Static routes are tried before parameterised ones so `/returns/new` resolves
 * to itself rather than to `/returns/:id` — the two are different screens with
 * different permissions, and a shop owner requesting a return would otherwise
 * land on somebody's return detail.
 */
export function routeIdForPath(pathname: string): string | undefined {
  const candidates = [...ROUTES].sort((a, b) => {
    const parameterised = (route: RouteNode) => (NAV_BY_ID[route.id]?.path.includes(':') ? 1 : 0);
    return parameterised(a) - parameterised(b);
  });

  for (const route of candidates) {
    const nav = NAV_BY_ID[route.id];
    if (nav && matchPath({ path: nav.path, end: true }, pathname)) return route.id;
  }
  return undefined;
}

/**
 * Joins each route to its navigation entry, refusing loudly if one is missing.
 *
 * A route with no entry has no declared roles, and a route with no declared
 * roles would be reachable by anybody — so this must throw rather than default.
 */
export function resolvedRoutes(): ResolvedRoute[] {
  return ROUTES.map((route) => {
    const nav = NAV_BY_ID[route.id];
    if (!nav) {
      throw new Error(
        `Route "${route.id}" has no entry in @medsupply/navigation, so nothing declares ` +
          `its path or who may reach it.`,
      );
    }
    return { ...route, nav };
  });
}
