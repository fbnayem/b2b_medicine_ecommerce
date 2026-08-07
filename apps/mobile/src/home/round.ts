import { DeliveryStatus } from '@medsupply/shared-types';
import type { Delivery, Trip } from '@medsupply/shared-types';

/**
 * A rider's day, as the home screen asks about it.
 *
 * ## The defect this replaces
 *
 * `dashboard.tsx` had three branches and a rider got the third: a notifications
 * button and a list of links. A signpost. The same screen a pharmacy had until
 * Phase 37 and a manager until Phase 39, and it was replaced both times for the
 * same reason — a signpost is right when every destination is equally likely,
 * and wrong when the person holding the phone has one obvious next thing to do.
 *
 * A rider's next thing is the **next stop**. Not a menu entry: a shop, with an
 * address, a phone number, and how many are left after it.
 *
 * The comment defending the old branch argued that a rider's five tabs already
 * carry their day. They carry the *lists*. They do not answer "where am I going
 * next", "how much cash am I holding" or "what have I not managed to send yet",
 * and those are the three questions a rider actually opens the phone to ask.
 *
 * Kept out of the screen so the ordering and the never-show-a-zero rule are
 * testable without a renderer, exactly as `home/waiting.ts` is for staff.
 */

/**
 * Today's round, if there is one.
 *
 * A rider has at most one round they are working. Picking it here rather than on
 * the screen means the screen has one job — showing the stops in order.
 *
 * Lived in `delivery/trips.ts` beside the fetchers, which meant asking which
 * stop comes next imported `apiClient` and through it `react-native`, whose Flow
 * sources the test bundler cannot parse. Every consumer had to mock a network
 * client to answer a question about an array.
 */
export function currentTrip(trips: readonly Trip[]): Trip | undefined {
  return (
    trips.find((trip) => trip.status === 'IN_PROGRESS') ??
    trips.find((trip) => trip.status === 'PLANNED')
  );
}

/** The stops, in the sequence the office planned them. */
export function orderedStops(trip: Trip) {
  return [...trip.stops].sort((left, right) => left.sequence - right.sequence);
}

/** The statuses a stop has finished in, one way or another. */
const SETTLED: readonly DeliveryStatus[] = [
  DeliveryStatus.DELIVERED,
  DeliveryStatus.PARTIALLY_DELIVERED,
  DeliveryStatus.FAILED,
  DeliveryStatus.RETURNING,
  DeliveryStatus.RETURNED_TO_STORE,
  DeliveryStatus.CANCELLED,
];

export function isSettled(status: DeliveryStatus): boolean {
  return SETTLED.includes(status);
}

export interface Stop {
  deliveryId: string;
  reference: string;
  /** Where this stop is on the round: "4 of 11". */
  position: number;
  total: number;
  name: string;
  address: string;
  phone?: string;
  status: DeliveryStatus;
}

function named(value: Delivery['shopId'] | undefined): string | undefined {
  return typeof value === 'object' && value ? value.name : undefined;
}

function addressOf(snapshot?: { line1: string; city: string }): string {
  return snapshot ? `${snapshot.line1}, ${snapshot.city}` : '';
}

/**
 * Where the rider is going next.
 *
 * From the planned round when there is one, because the office put the stops in
 * an order for a reason and a rider who drives them in a different one is doing
 * the day twice. When there is no round — deliveries assigned one at a time, the
 * way this worked before rounds existed — the earliest expected delivery, which
 * is the same question with less information behind it.
 *
 * A settled stop is skipped rather than shown as done: the point of this is what
 * is left, and a screen that opens on somewhere the rider has already been is
 * worse than no screen.
 */
export function nextStop(
  trip: Trip | undefined,
  deliveries: readonly Delivery[],
): Stop | undefined {
  if (trip) {
    const stops = orderedStops(trip).filter((stop) => stop.delivery);
    const at = stops.findIndex((stop) => !isSettled(stop.delivery!.status));
    if (at < 0) return undefined;
    const stop = stops[at]!;
    const delivery = stop.delivery!;
    return {
      deliveryId: delivery._id,
      reference: delivery.reference,
      position: at + 1,
      total: stops.length,
      name: named(delivery.shopId as Delivery['shopId']) ?? delivery.contactSnapshot?.name ?? '',
      address: addressOf(delivery.addressSnapshot),
      phone: delivery.contactSnapshot?.phone,
      status: delivery.status,
    };
  }

  const outstanding = deliveries
    .filter((delivery) => !isSettled(delivery.status))
    .sort((left, right) =>
      (left.expectedDeliveryDate ?? '').localeCompare(right.expectedDeliveryDate ?? ''),
    );
  const first = outstanding[0];
  if (!first) return undefined;
  return {
    deliveryId: first._id,
    reference: first.reference,
    position: 1,
    total: outstanding.length,
    name: named(first.shopId) ?? first.contactSnapshot.name,
    address: addressOf(first.addressSnapshot),
    phone: first.contactSnapshot.phone,
    status: first.status,
  };
}

export type RoundFactKind = 'remaining' | 'carrying' | 'unsent' | 'toReturn';

export interface RoundFact {
  kind: RoundFactKind;
  /** A count, except for `carrying`, which is money in minor units. */
  value: number;
  /** Where tapping it goes. */
  route: string;
  /** True when somebody else is waiting on it. */
  blocking: boolean;
}

export interface RoundCounts {
  /** Stops not yet settled, the next one included. */
  remaining?: number;
  /** Cash taken and not yet handed in, in minor units. */
  carryingMinor?: number;
  /** Actions this handset is holding because it had no signal. */
  unsent?: number;
  /** Failed stops whose goods are still in the van. */
  toReturn?: number;
}

/**
 * The facts worth a line on the home screen, in the order they are asked.
 *
 * **A zero is not shown**, the rule `waiting.ts` holds for staff and for the
 * same reason: a home screen listing "0 waiting to send" trains somebody to stop
 * reading it, and everything here is meant to be worth a tap.
 *
 * The order is a decision. Unsent work comes first because the office cannot see
 * it at all — as far as anybody at a desk knows, those stops have not happened —
 * and a rider who does not notice it before going home has left the day's record
 * on a handset. Cash follows, because they are answerable for it until it is
 * handed in. Goods to take back are last: nobody is waiting, but the van is not
 * empty.
 */
export function roundFacts(counts: RoundCounts): RoundFact[] {
  const of = (kind: RoundFactKind, value: number | undefined, route: string, blocking: boolean) =>
    value && value > 0 ? [{ kind, value, route, blocking }] : [];

  return [
    ...of('unsent', counts.unsent, '/(protected)/(tabs)/deliveries', true),
    ...of('carrying', counts.carryingMinor, '/(protected)/collections', true),
    ...of('remaining', counts.remaining, '/(protected)/trip', false),
    ...of('toReturn', counts.toReturn, '/(protected)/(tabs)/deliveries', false),
  ];
}

/** How many stops are still to do, whether or not a round was planned. */
export function remainingStops(trip: Trip | undefined, deliveries: readonly Delivery[]): number {
  if (trip) {
    return orderedStops(trip).filter((stop) => stop.delivery && !isSettled(stop.delivery.status))
      .length;
  }
  return deliveries.filter((delivery) => !isSettled(delivery.status)).length;
}

/**
 * Goods that failed and are still in the van.
 *
 * `FAILED` and not `RETURNING`: the second means the rider has already said they
 * are bringing it back, so it is in hand rather than outstanding.
 */
export function goodsToReturn(deliveries: readonly Delivery[]): number {
  return deliveries.filter((delivery) => delivery.status === DeliveryStatus.FAILED).length;
}
