import { navItemsFor } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { DeliveryStatus } from '@medsupply/shared-types';
import { keys } from './queryKeys';
import { approvalsQueue, pickingQueue } from './workQueues';

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

/**
 * The hue a kind of work keeps, everywhere it appears.
 *
 * These are the tones the badge palette already uses and the contrast test
 * already holds to 4.5:1 against their own tints in both themes, so spending
 * them here costs nothing and buys the thing colour is actually for: a
 * storekeeper learns that teal means picking, and then recognises the teal tile
 * before reading a word of it.
 *
 * Not one hue per tile chosen to look pretty — one hue per *stage of an order*,
 * in the order an order passes through them: waiting on a person, being picked,
 * packed, gone.
 */
export type SignalTone = 'info' | 'progress' | 'warning' | 'transit' | 'brand';

/** The icon each tile carries, named from the shared navigation icon set. */
export type SignalIcon = 'approvals' | 'warehouse' | 'orders' | 'delivery' | 'money';

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
  tone: SignalTone;
  icon: SignalIcon;
}

/**
 * Deliberately four, and deliberately all queues.
 *
 * Every one of these is a list whose length is a backlog somebody can shorten
 * today. That is why there is no "Orders" or "Medicines" card here: their
 * totals are inventory of the system rather than work outstanding, and a number
 * nobody can act on trains people to stop reading the numbers that matter.
 *
 * **The filter is part of the request, not an afterthought.** This used to say
 * that each of these was a list whose *unfiltered* length was the backlog, and
 * for two of the four that was simply untrue: `/approvals/queue` returns
 * approved and rejected orders as well as undecided ones, and
 * `/fulfilment/queue` returns every picking list ever made. So the home screen
 * reported 3 orders "waiting for your decision" when one was, and 15 "to pick"
 * when one was — the rest had been decided and packed days earlier.
 *
 * The two that were right — packed-awaiting-handover and out-for-delivery —
 * were right because their endpoints filter server-side, which is to say by
 * accident of where the filter happened to live. `workQueues.ts` now names the
 * outstanding set for the other two, and the screen each tile links to reads
 * the same constant, so a number and the list behind it cannot drift apart.
 */
const SIGNALS: readonly HomeSignal[] = [
  {
    id: 'approvals',
    navId: 'approvals',
    key: keys.approvals.queue(approvalsQueue.outstanding),
    url: approvalsQueue.url(approvalsQueue.outstanding),
    labelKey: 'home.awaitingDecision',
    path: '/approvals',
    tone: 'info',
    icon: 'approvals',
  },
  {
    id: 'picking',
    navId: 'fulfilment',
    key: keys.fulfilment.queue(pickingQueue.outstanding),
    url: pickingQueue.url(pickingQueue.outstanding),
    labelKey: 'home.toPick',
    path: '/fulfilment',
    tone: 'progress',
    icon: 'warehouse',
  },
  {
    id: 'ready',
    navId: 'fulfilment-ready',
    key: keys.fulfilment.ready(),
    url: '/fulfilment/ready',
    labelKey: 'home.readyToHandOver',
    path: '/fulfilment/ready',
    tone: 'warning',
    icon: 'orders',
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
    tone: 'transit',
    icon: 'delivery',
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
  tone: 'brand',
  icon: 'money',
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

/**
 * Whether this role is shown the charts under the figures.
 *
 * `GET /reports/overview` is management-only on the server, and the analytics
 * navigation entry carries exactly that set — so asking the manifest is asking
 * the same question the server will answer, rather than keeping a second copy
 * of it here and waiting for the two to drift.
 */
export function showsTrade(role: UserRole): boolean {
  return navItemsFor(role).some((item) => item.id === 'analytics');
}
