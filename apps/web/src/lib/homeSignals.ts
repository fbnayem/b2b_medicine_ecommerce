import { navItemsFor } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { DeliveryStatus } from '@medsupply/shared-types';
import { keys } from './queryKeys';

/**
 * What is waiting for this person, as a number they can act on.
 *
 * The home screen was a grid of every destination the sidebar already lists,
 * one card each, describing what the screen is for. Twenty cards on a manager's
 * account, none of them carrying a single fact about the business. Opening it
 * told you nothing you did not know before you opened it, and the sidebar was
 * sitting right beside it saying the same words.
 *
 * A distributor's first question in the morning is not "what screens exist" —
 * it is "what is waiting for me". These are the answers to that, and nothing
 * else goes here: a figure earns its place on this screen only if a person can
 * do something about it today.
 *
 * ## Two rules that keep the numbers honest
 *
 * **A signal reuses the key and the URL of the screen it links to.** Not a new
 * endpoint and not a cheaper count: the same request the destination makes. So
 * the number on the home screen and the list you land on cannot disagree, the
 * click is served from cache, and every invalidation already written for that
 * screen keeps this one current too.
 *
 * **The navigation manifest decides who sees each one.** A signal is shown when
 * the role has the navigation entry it points at — the same source `AppShell`,
 * `App.tsx`'s route guards and mobile all read. A card that 403s on the first
 * screen somebody sees each day would be worse than no card.
 */

export interface HomeSignal {
  /** Stable id, used for the test id and as the React key. */
  id: string;
  /** The navigation entry that decides who sees this and where it goes. */
  navId: string;
  /** The destination's own query key. Same key, same shape, same cache entry. */
  key: readonly unknown[];
  /** The destination's own request. */
  url: string;
  /** Catalogue key for the words under the number. */
  labelKey: string;
  path: string;
}

/**
 * Deliberately four, and deliberately all queues.
 *
 * Every one of these is a list whose *unfiltered length is itself the backlog*.
 * That is why there is no "Orders" or "Medicines" card here: their totals are
 * inventory of the system rather than work outstanding, and a number nobody can
 * act on trains people to stop reading the numbers that matter.
 */
const SIGNALS: readonly HomeSignal[] = [
  {
    id: 'approvals',
    navId: 'approvals',
    key: keys.approvals.queue(''),
    url: '/approvals/queue',
    labelKey: 'home.awaitingDecision',
    path: '/approvals',
  },
  {
    id: 'picking',
    navId: 'fulfilment',
    key: keys.fulfilment.queue(''),
    url: '/fulfilment/queue',
    labelKey: 'home.toPick',
    path: '/fulfilment',
  },
  {
    id: 'ready',
    navId: 'fulfilment-ready',
    key: keys.fulfilment.ready(),
    url: '/fulfilment/ready',
    labelKey: 'home.readyToHandOver',
    path: '/fulfilment/ready',
  },
  {
    id: 'on-the-road',
    navId: 'deliveries',
    /*
     * The one signal that filters, because `/deliveries` unfiltered is every
     * delivery ever made and that total answers no question anybody has. The
     * filter is written the way `DeliveryBoard` writes it so the two agree.
     */
    key: keys.deliveries.list({ status: DeliveryStatus.OUT_FOR_DELIVERY, query: '' }),
    url: `/deliveries?status=${DeliveryStatus.OUT_FOR_DELIVERY}`,
    labelKey: 'home.onTheRoad',
    path: '/deliveries',
  },
];

/** The money a shop owner owes. Their whole relationship with this business. */
export const OWN_ACCOUNT: HomeSignal = {
  id: 'owed',
  navId: 'shop-account',
  key: keys.finance.mySummary(),
  url: '/finance/my/summary',
  labelKey: 'home.youOwe',
  path: '/account',
};

/**
 * The work queues this role can both see and act on.
 *
 * A delivery person gets nothing from this list on the web, and that is
 * correct rather than an omission: their job is the mobile app, and the one
 * web screen they hold is a read-only view of their own round.
 */
export function signalsFor(role: UserRole): HomeSignal[] {
  const reachable = new Set(navItemsFor(role).map((item) => item.id));
  return SIGNALS.filter((signal) => reachable.has(signal.navId));
}

/** Whether this role is shown what they owe instead of a set of queues. */
export function showsOwnAccount(role: UserRole): boolean {
  return navItemsFor(role).some((item) => item.id === OWN_ACCOUNT.navId);
}
