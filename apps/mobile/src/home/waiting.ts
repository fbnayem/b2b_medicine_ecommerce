import type { UserRole } from '@medsupply/shared-types';

/**
 * What is waiting on the person holding the phone.
 *
 * The staff home was a list of buttons — a signpost — which is the same defect
 * `CustomerHome` replaced for a pharmacy. A signpost is the right screen when
 * every destination is equally likely; it is the wrong one when four of them
 * have somebody standing at the other end waiting for an answer.
 *
 * The counting is here rather than in the screen so it can be tested without a
 * renderer, and so the **order** is a decision written down once. That order is
 * not arbitrary: a picking discrepancy has a storekeeper standing still until
 * it is resolved, and a cancellation request has a customer who has already
 * asked twice. Money owed is urgent and nobody is blocked by it, so it comes
 * last of the four.
 */

export type BlockKind =
  | 'approvals'
  | 'cancellations'
  | 'discrepancies'
  | 'overdue'
  | 'picking'
  | 'counting'
  | 'arriving'
  | 'customers'
  | 'openOrders';

export interface Block {
  kind: BlockKind;
  count: number;
  /** Where tapping it goes, as a `MOBILE_ROUTE`-shaped path. */
  route: string;
  /** True when the count is people waiting rather than work in hand. */
  blocking: boolean;
}

export interface StaffCounts {
  approvals?: number;
  cancellations?: number;
  discrepancies?: number;
  overdueShops?: number;
  overdueMinor?: number;
  picking?: number;
  counting?: number;
  arriving?: number;
  customers?: number;
  openOrders?: number;
}

const MANAGEMENT: readonly string[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

/**
 * The blocks a role sees, in the order they are asked about, with the empty
 * ones removed.
 *
 * **A zero is not shown.** A home screen listing "0 orders to approve" trains
 * somebody to stop reading it, and the whole value of this screen is that
 * anything on it is worth a tap. The one exception is when *everything* is
 * zero, which the screen says in a sentence rather than as four noughts.
 */
export function blocksFor(role: UserRole | undefined, counts: StaffCounts): Block[] {
  if (!role) return [];
  const of = (kind: BlockKind, count: number | undefined, route: string, blocking: boolean) =>
    count && count > 0 ? [{ kind, count, route, blocking }] : [];

  if (MANAGEMENT.includes(role)) {
    return [
      ...of('approvals', counts.approvals, '/(protected)/(tabs)/approvals', true),
      ...of('cancellations', counts.cancellations, '/(protected)/(tabs)/orders', true),
      ...of('discrepancies', counts.discrepancies, '/(protected)/(tabs)/fulfilment', true),
      ...of('overdue', counts.overdueShops, '/(protected)/overdue-shops', false),
    ];
  }

  if (role === 'STOREKEEPER') {
    return [
      ...of('picking', counts.picking, '/(protected)/(tabs)/fulfilment', true),
      ...of('counting', counts.counting, '/(protected)/stocktakes', false),
      ...of('arriving', counts.arriving, '/(protected)/purchase-orders', false),
    ];
  }

  if (role === 'SALES') {
    return [
      ...of('openOrders', counts.openOrders, '/(protected)/(tabs)/orders', true),
      ...of('customers', counts.customers, '/(protected)/shops', false),
      ...of('overdue', counts.overdueShops, '/(protected)/overdue-shops', false),
    ];
  }

  // A rider and a shop owner have their own home screens; reaching here with
  // either means a role was added to the staff build without a decision about
  // what it should see, which is better as nothing than as a manager's list.
  return [];
}

/**
 * How many picking lists are stopped by a discrepancy nobody has decided.
 *
 * A list carries its discrepancies inline, so this is a count over the queue
 * rather than a request of its own — there is no endpoint that answers "how
 * many are blocked", and inventing a round trip for a number already on screen
 * is how a home screen becomes slow.
 */
export function blockedByDiscrepancy(
  lists: ReadonlyArray<{ discrepancies?: ReadonlyArray<{ status: string }> }>,
): number {
  return lists.filter((list) => list.discrepancies?.some((entry) => entry.status === 'OPEN'))
    .length;
}
