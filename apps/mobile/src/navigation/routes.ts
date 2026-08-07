import { navItemsFor, type NavItem } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { TAB_ROUTE_FILE } from './tabs';

/**
 * Where this client goes for each shared navigation id.
 *
 * ## The defect this replaces
 *
 * The home screen built its menu from
 * `navItemsFor(role).filter((item) => TAB_ROUTE_FILE[item.id])` — and
 * `TAB_ROUTE_FILE` names the seventeen files that are a **tab for somebody**. So
 * the menu could only ever offer a destination that happened to be a tab, and
 * everything reached by pushing was invisible. A manager may reach 35
 * destinations and was shown 13; a storekeeper 16 and was shown 8.
 *
 * That map was doing two jobs, and the second — deciding what the whole
 * application offers — is not one it can do. It goes back to naming tab files,
 * and this decides where anything is.
 *
 * ## Why the mapping is not the identity
 *
 * Several shared ids land on one screen with a parameter: the five `analytics-*`
 * reports are one screen with chips, and so are the three finance reports,
 * because a phone shows one report at a time and a chip row is how it is
 * changed. Others differ in name only — the shared `fulfilment-work` is
 * `picking.tsx` here. `TAB_ROUTE_FILE` already established the precedent
 * (`payments` → `finance-dashboard`), and writing the map out is what keeps the
 * shared ids honest instead of forcing this client to adopt web's file layout.
 */

const PUSHED: Record<string, string> = {
  // Work
  'order-detail': '/(protected)/order-detail',
  'approval-review': '/(protected)/approval-review',
  'fulfilment-work': '/(protected)/picking',
  'delivery-detail': '/(protected)/delivery-detail',
  'trip-detail': '/(protected)/trip',
  'return-detail': '/(protected)/return-detail',
  'return-new': '/(protected)/return-new',

  // Catalogue
  'medicine-detail': '/(protected)/medicine-detail',
  checkout: '/(protected)/checkout',
  stocktakes: '/(protected)/stocktakes',
  // Opening a count is a prompt on the list rather than a screen of its own: a
  // storekeeper standing in an aisle types where they are, and that is the
  // whole form.
  'stocktake-new': '/(protected)/stocktakes',
  'stocktake-detail': '/(protected)/stocktake-detail',
  warehouses: '/(protected)/warehouses',
  // Adding a warehouse is a form on its own list. Four fields do not need a
  // screen, and a phone that pushes for four fields has decided for somebody
  // standing at a goods-in door with a driver waiting.
  'warehouse-new': '/(protected)/warehouses',

  // Buying in
  suppliers: '/(protected)/suppliers',
  'supplier-new': '/(protected)/suppliers',
  'purchase-orders': '/(protected)/purchase-orders',
  'purchase-order-new': '/(protected)/purchase-order-new',
  'purchase-order-detail': '/(protected)/purchase-order-detail',
  // Seven shared ids, one screen with a chip row. A phone shows one report
  // at a time, and `MOBILE_ROUTE` exists so the manifest does not have to
  // pretend otherwise.
  'analytics-sales': '/(protected)/analytics-report?kind=sales',
  'analytics-returns': '/(protected)/analytics-report?kind=returns',
  'analytics-inventory': '/(protected)/analytics-report?kind=inventory',
  'analytics-deliveries': '/(protected)/analytics-report?kind=deliveries',
  'analytics-receivables': '/(protected)/analytics-report?kind=receivables',
  'report-outstanding': '/(protected)/finance-report?kind=outstanding',
  'report-overdue': '/(protected)/finance-report?kind=overdue',
  'report-collections': '/(protected)/finance-report?kind=collections',
  'price-lists': '/(protected)/price-lists',
  'price-list-new': '/(protected)/price-lists',
  'price-list-detail': '/(protected)/price-list-detail',
  schemes: '/(protected)/schemes',
  // The offer screen doubles as the form for a new one: an offer is four
  // fields, and a separate screen for four fields is a push nobody needs.
  'scheme-new': '/(protected)/scheme-detail',
  'scheme-detail': '/(protected)/scheme-detail',
  shops: '/(protected)/shops',
  'shop-detail': '/(protected)/shop-detail',
  'shop-ledger': '/(protected)/shop-ledger',
  'payment-new': '/(protected)/payment-new',
  trips: '/(protected)/trips',
  users: '/(protected)/users',
  'user-new': '/(protected)/user-form',
  audit: '/(protected)/audit',
  activity: '/(protected)/activity',
  'shop-statement': '/(protected)/shop-statement',
  'medicine-new': '/(protected)/medicine-form',
  // One screen for both: the difference is an identifier, and two files would
  // be two places to forget a field.
  'medicine-edit': '/(protected)/medicine-form',
  recall: '/(protected)/recall',
  'controlled-register': '/(protected)/controlled-register',

  // Money
  'payment-detail': '/(protected)/payment-detail',
  collections: '/(protected)/collections',

  // A shop owner's own account
  'my-payments': '/(protected)/payments',
  'my-payment-detail': '/(protected)/payment-detail',
  'my-statement': '/(protected)/statement',
  addresses: '/(protected)/addresses',
  'notification-preferences': '/(protected)/notification-preferences',
  'change-password': '/(protected)/change-password',
};

/** Every navigation id this client can reach, and the route it goes to. */
export const MOBILE_ROUTE: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(TAB_ROUTE_FILE).map(([id, file]) => [id, `/(protected)/(tabs)/${file}`]),
  ),
  ...PUSHED,
};

/**
 * Destinations the shared manifest permits that this client has **no screen
 * for yet**, with the slice that builds each.
 *
 * A waiver list in the same spirit as the ones next door: it is allowed to
 * shrink and never to grow, and `routes.test.ts` holds it to that. Without it
 * the menu would offer a route with no file behind it, which is a crash rather
 * than a gap — so the honest arrangement is to say what is missing and count it
 * down, not to pretend the map is complete.
 *
 * Every one of these already exists on web with a route and a page guide. This
 * is a mobile gap, not a product gap.
 */
export const NO_MOBILE_SCREEN: ReadonlySet<string> = new Set([
  /*
   * Creating a customer: fourteen fields including the credit limit, the
   * payment terms, the discount and the price list. A phone is the wrong place
   * to set somebody's credit limit while they are standing in front of you.
   * Reading, opening and suspending a customer are all here.
   */
  'shop-new',
  /*
   * Planning a round: choosing from a list of plannable deliveries and putting
   * them in an order, which is a drag on a monitor. The rounds already planned
   * are readable here, and **calling one off** — the action that has to work
   * when a van breaks down — is on the list screen.
   */
  'trip-new',
]);

/**
 * Whether a navigation id can be opened on this client.
 *
 * Used by the home menu, so a destination with no screen behind it is left out
 * rather than offered and then crashing on the push.
 */
export function reachable(id: string): boolean {
  return Boolean(MOBILE_ROUTE[id]) && !NO_MOBILE_SCREEN.has(id);
}

/**
 * Everything a role may open from the home screen, in manifest order.
 *
 * `dashboard` is excluded because it is the screen this is rendered on, and
 * hidden items because they are destinations reached from a list rather than
 * from a menu — an order detail belongs under the orders it details.
 */
export function destinationsFor(role: UserRole): NavItem[] {
  return navItemsFor(role).filter(
    (item) => item.id !== 'dashboard' && !item.hidden && reachable(item.id),
  );
}
