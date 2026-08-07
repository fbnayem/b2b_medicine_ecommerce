import { describe, expect, it } from 'vitest';
import { DeliveryStatus } from '@medsupply/shared-types';
import type { Delivery, Trip } from '@medsupply/shared-types';
import {
  currentTrip,
  goodsToReturn,
  isSettled,
  nextStop,
  orderedStops,
  remainingStops,
  roundFacts,
} from './round';

/**
 * A rider's home screen was a notifications button and a list of links — the
 * signpost a pharmacy lost in Phase 37 and a manager in Phase 39, kept for the
 * one role whose day has the most obvious next thing in it.
 *
 * The two round-selection rules below came from `delivery/trips.test.ts`, which
 * had to mock the API client to ask a question about an array. They test the
 * same behaviour; only the module they live in changed.
 */

const bare = (overrides: Partial<Trip>): Trip =>
  ({
    _id: 'id',
    reference: 'TRP-2026-000001',
    status: 'PLANNED',
    deliveryPersonId: 'rider',
    tripDate: '2026-08-04T00:00:00.000Z',
    stops: [],
    version: 0,
    ...overrides,
  }) as Trip;

describe('which round a rider is working', () => {
  it('prefers the one they have already started', () => {
    // A rider who has left is on that round, whatever else is planned. Showing
    // them tomorrow's sheet while they are standing at a shop door would be
    // worse than showing them nothing.
    const chosen = currentTrip([
      bare({ _id: 'planned', status: 'PLANNED' }),
      bare({ _id: 'out', status: 'IN_PROGRESS' }),
    ]);
    expect(chosen?._id).toBe('out');
  });

  it('falls back to the one waiting to start', () => {
    expect(currentTrip([bare({ _id: 'planned', status: 'PLANNED' })])?._id).toBe('planned');
  });

  it('ignores rounds that are finished or called off', () => {
    const chosen = currentTrip([
      bare({ _id: 'done', status: 'COMPLETED' }),
      bare({ _id: 'off', status: 'CANCELLED' }),
    ]);
    expect(chosen).toBeUndefined();
  });

  it('answers nothing rather than throwing when there are no rounds', () => {
    expect(currentTrip([])).toBeUndefined();
  });
});

describe('the order the stops are driven in', () => {
  it('sorts by the sequence the office planned, not by the array order', () => {
    // The server sorts too; this is what stops a reordered round rendering in
    // whatever order the payload happened to arrive in.
    const sheet = bare({
      stops: [
        { _id: 'c', sequence: 3, delivery: null },
        { _id: 'a', sequence: 1, delivery: null },
        { _id: 'b', sequence: 2, delivery: null },
      ],
    });
    expect(orderedStops(sheet).map((stop) => stop._id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the round it was given', () => {
    const sheet = bare({
      stops: [
        { _id: 'b', sequence: 2, delivery: null },
        { _id: 'a', sequence: 1, delivery: null },
      ],
    });
    orderedStops(sheet);
    expect(sheet.stops.map((stop) => stop._id)).toEqual(['b', 'a']);
  });
});

const stop = (sequence: number, id: string, status: DeliveryStatus, name: string) => ({
  _id: `stop-${sequence}`,
  sequence,
  delivery: {
    _id: id,
    reference: `DEL-${id}`,
    status,
    shopId: { _id: `shop-${id}`, reference: `SHP-${id}`, name },
    addressSnapshot: { line1: '14/B Bangla Motor', city: 'Dhaka', district: 'Dhaka' },
    contactSnapshot: { name, phone: '01711000111' },
  },
});

const round = (stops: ReturnType<typeof stop>[]): Trip =>
  ({ _id: 'trip-1', reference: 'TRP-1', status: 'IN_PROGRESS', stops }) as unknown as Trip;

const delivery = (id: string, status: DeliveryStatus, expected?: string): Delivery =>
  ({
    _id: id,
    reference: `DEL-${id}`,
    status,
    expectedDeliveryDate: expected,
    shopId: { _id: `shop-${id}`, name: `Shop ${id}` },
    addressSnapshot: { line1: '5 Green Road', city: 'Dhaka' },
    contactSnapshot: { name: `Shop ${id}`, phone: '01711000222' },
  }) as unknown as Delivery;

describe('where the rider is going next', () => {
  it('is the first stop on the round that is not finished', () => {
    const trip = round([
      stop(1, 'a', DeliveryStatus.DELIVERED, 'Shafin Pharmacy'),
      stop(2, 'b', DeliveryStatus.FAILED, 'Noor Medical'),
      stop(3, 'c', DeliveryStatus.OUT_FOR_DELIVERY, 'Bismillah Pharmacy'),
      stop(4, 'd', DeliveryStatus.ASSIGNED, 'Rahim Drug House'),
    ]);
    const next = nextStop(trip, []);

    expect(next?.name).toBe('Bismillah Pharmacy');
    // Its place on the round, which is what a rider glances at while holding a
    // box — not the index of the first unsettled one in some filtered array.
    expect(next?.position).toBe(3);
    expect(next?.total).toBe(4);
    expect(next?.phone).toBe('01711000111');
    expect(next?.address).toBe('14/B Bangla Motor, Dhaka');
  });

  it('reads the sequence the office planned, not the order the array arrived in', () => {
    const trip = round([
      stop(3, 'c', DeliveryStatus.ASSIGNED, 'Third'),
      stop(1, 'a', DeliveryStatus.ASSIGNED, 'First'),
      stop(2, 'b', DeliveryStatus.ASSIGNED, 'Second'),
    ]);
    expect(nextStop(trip, [])?.name).toBe('First');
  });

  it('says nothing when every stop is settled, rather than pointing at a finished one', () => {
    const trip = round([
      stop(1, 'a', DeliveryStatus.DELIVERED, 'Shafin Pharmacy'),
      stop(2, 'b', DeliveryStatus.RETURNED_TO_STORE, 'Noor Medical'),
    ]);
    expect(nextStop(trip, [])).toBeUndefined();
  });

  it('falls back to the earliest delivery when no round was planned', () => {
    // Deliveries are still assigned one at a time — the way this worked before
    // rounds existed — and a rider with no round still has a next stop.
    const next = nextStop(undefined, [
      delivery('late', DeliveryStatus.ASSIGNED, '2026-08-07T14:00:00.000Z'),
      delivery('early', DeliveryStatus.ASSIGNED, '2026-08-07T09:00:00.000Z'),
      delivery('done', DeliveryStatus.DELIVERED, '2026-08-07T07:00:00.000Z'),
    ]);
    expect(next?.deliveryId).toBe('early');
    expect(next?.total).toBe(2);
  });
});

describe('what is left of the day', () => {
  it('counts the stops still to do', () => {
    const trip = round([
      stop(1, 'a', DeliveryStatus.DELIVERED, 'One'),
      stop(2, 'b', DeliveryStatus.ARRIVED, 'Two'),
      stop(3, 'c', DeliveryStatus.ASSIGNED, 'Three'),
    ]);
    expect(remainingStops(trip, [])).toBe(2);
    expect(remainingStops(undefined, [delivery('x', DeliveryStatus.PICKED_UP)])).toBe(1);
  });

  it('counts failed goods still in the van, and not the ones already coming back', () => {
    // `RETURNING` means the rider has said they are bringing it in, so it is in
    // hand rather than outstanding.
    expect(
      goodsToReturn([
        delivery('a', DeliveryStatus.FAILED),
        delivery('b', DeliveryStatus.RETURNING),
        delivery('c', DeliveryStatus.FAILED),
        delivery('d', DeliveryStatus.DELIVERED),
      ]),
    ).toBe(2);
  });

  it('treats a cancelled stop as settled, so it is not driven to', () => {
    expect(isSettled(DeliveryStatus.CANCELLED)).toBe(true);
    expect(isSettled(DeliveryStatus.ARRIVED)).toBe(false);
  });
});

describe('the facts on the home screen', () => {
  it('never shows a zero', () => {
    /*
     * The rule `waiting.ts` holds for staff, for the same reason: a home screen
     * listing "0 waiting to send" trains somebody to stop reading it, and
     * everything on this one is meant to be worth a tap.
     */
    expect(roundFacts({ remaining: 0, carryingMinor: 0, unsent: 0, toReturn: 0 })).toEqual([]);
    expect(roundFacts({})).toEqual([]);
  });

  it('puts unsent work first, because the office cannot see it at all', () => {
    /*
     * As far as anybody at a desk knows, a queued stop has not happened. A rider
     * who does not notice it before going home has left the day's record on a
     * handset, so it outranks even the cash.
     */
    const facts = roundFacts({
      remaining: 4,
      carryingMinor: 1_250_000,
      unsent: 2,
      toReturn: 1,
    });
    expect(facts.map((fact) => fact.kind)).toEqual(['unsent', 'carrying', 'remaining', 'toReturn']);
    expect(facts[0]?.blocking).toBe(true);
    // Money as minor units all the way to the formatter, never a float.
    expect(facts[1]?.value).toBe(1_250_000);
    expect(facts[1]?.route).toBe('/(protected)/collections');
  });

  it('shows the cash on its own when there is nothing else outstanding', () => {
    const facts = roundFacts({ carryingMinor: 500, remaining: 0 });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.kind).toBe('carrying');
  });
});
