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

/*
 * `currentTrip` and `orderedStops` moved to `home/round.ts`.
 *
 * Both are pure and neither belongs beside a transport module: importing them
 * dragged in `apiClient`, and through it `react-native`, whose Flow sources the
 * test bundler cannot parse — so every consumer had to mock a network client to
 * ask which stop comes next. `trips.test.ts` did exactly that, and so would the
 * home screen's own tests.
 */
