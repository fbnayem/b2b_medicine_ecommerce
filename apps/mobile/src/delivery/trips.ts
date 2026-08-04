import type { Trip } from '@medsupply/shared-types';
import { apiClient } from '../api/client';

/**
 * The rider's round.
 *
 * The list is scoped server-side to whoever is signed in, so there is no
 * "which rider" parameter here and there is nothing for this client to get
 * wrong. Kept out of the screen, per the rule that transport is not a
 * component's business.
 */

export async function fetchMyTrips(): Promise<Trip[]> {
  const response = await apiClient.get('/trips?limit=20');
  const payload = response.data?.data;
  // The endpoint answers `{ data: { items, … } }`; degrade to an empty round
  // rather than throwing and blanking a screen a rider is standing over.
  return Array.isArray(payload?.items) ? (payload.items as Trip[]) : [];
}

export async function fetchTrip(tripId: string): Promise<Trip> {
  return (await apiClient.get(`/trips/${tripId}`)).data.data as Trip;
}

export async function startTrip(tripId: string, version: number): Promise<Trip> {
  return (await apiClient.post(`/trips/${tripId}/start`, { version })).data.data as Trip;
}

/**
 * Today's round, if there is one.
 *
 * A rider has at most one round they are working. Picking it here rather than
 * on the screen means the screen has one job — showing the stops in order.
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
