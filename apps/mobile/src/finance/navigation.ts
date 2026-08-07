import { UserRole } from '@medsupply/shared-types';

/**
 * The two routes this file may name.
 *
 * Narrowed with the lists below: a union still offering `/(protected)/payments`
 * or `/(protected)/collection-review` would be an invitation to put a duplicate
 * back, and the type is the cheapest place to say no.
 */
export type FinanceRoute = '/(protected)/invoices' | '/(protected)/collections';

export type FinanceNavigationItem = {
  /**
   * The catalogue key. These were English string literals rendered straight
   * onto the home screen, so four of the six destinations a shop owner has
   * stayed in English when the language was switched — the same defect
   * `navigation/tabs.ts` records for the tab bar, one screen along.
   */
  labelKey: string;
  /** What to show if the catalogue has no such key. */
  label: string;
  route: FinanceRoute;
};

/**
 * What the shared manifest has no id for, and only that.
 *
 * ## Why this file still exists
 *
 * The manifest's `money` group is management's: `payments`, `collections`,
 * `shop-ledger`, the three finance reports. It has no id for **your own money**,
 * because a shop owner reading their own statement and a rider counting the cash
 * in their bag are not destinations a manager can be given. Those two live here.
 *
 * ## Why it stopped listing anything else
 *
 * It used to carry a manager's three finance screens and a shop owner's four,
 * and until Phase 39 that was harmless: the home menu filtered the manifest down
 * to whatever happened to be a tab, so most of it never appeared and the two
 * lists did not collide. Removing that filter turned nine of these entries into
 * duplicates — a manager offered "Collection review" and "Rider collections",
 * one screen under two names, and a shop owner offered their payments twice.
 *
 * `routes.test.ts` now holds the boundary: whatever the manifest offers a role,
 * this must not offer again. The rule is the one web has held since Phase 21.
 */
const ownerItems: FinanceNavigationItem[] = [
  /*
   * The one destination a shop owner has that the manifest does not name. Their
   * account, payment history and statement are `shop-account`, `my-payments`
   * and `my-statement` there, and were listed twice here.
   */
  { labelKey: 'screens.invoices', label: 'Invoices', route: '/(protected)/invoices' },
];

const deliveryItems: FinanceNavigationItem[] = [
  { labelKey: 'screens.myCollections', label: 'My collections', route: '/(protected)/collections' },
];

export function getFinanceNavigation(role?: UserRole): FinanceNavigationItem[] {
  if (role === UserRole.SHOP_OWNER) return ownerItems;
  if (role === UserRole.DELIVERY_PERSON) return deliveryItems;
  /*
   * Management gets nothing from here. Every finance screen they have is in the
   * manifest with an id, a web route and a page guide — `payments` (the money
   * tab), `collections` (the desk that posts what a rider handed in) and
   * `report-overdue`, which Phase 39 folded into the one finance report screen.
   */
  return [];
}
