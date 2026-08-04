import { describe, expect, it, vi } from 'vitest';

// The API client pulls in react-native, whose Flow sources the test bundler
// cannot parse. Only the pure selection helpers are exercised here.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

import { currentTrip, orderedStops } from './trips';
import type { Trip } from '@medsupply/shared-types';

const trip = (overrides: Partial<Trip>): Trip =>
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
      trip({ _id: 'planned', status: 'PLANNED' }),
      trip({ _id: 'out', status: 'IN_PROGRESS' }),
    ]);
    expect(chosen?._id).toBe('out');
  });

  it('falls back to the one waiting to start', () => {
    expect(currentTrip([trip({ _id: 'planned', status: 'PLANNED' })])?._id).toBe('planned');
  });

  it('ignores rounds that are finished or called off', () => {
    const chosen = currentTrip([
      trip({ _id: 'done', status: 'COMPLETED' }),
      trip({ _id: 'off', status: 'CANCELLED' }),
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
    const sheet = trip({
      stops: [
        { _id: 'c', sequence: 3, delivery: null },
        { _id: 'a', sequence: 1, delivery: null },
        { _id: 'b', sequence: 2, delivery: null },
      ],
    });
    expect(orderedStops(sheet).map((stop) => stop._id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the round it was given', () => {
    const sheet = trip({
      stops: [
        { _id: 'b', sequence: 2, delivery: null },
        { _id: 'a', sequence: 1, delivery: null },
      ],
    });
    orderedStops(sheet);
    expect(sheet.stops.map((stop) => stop._id)).toEqual(['b', 'a']);
  });
});
