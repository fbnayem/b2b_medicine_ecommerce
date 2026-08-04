import { Types } from 'mongoose';
import { DeliveryStatus, UserRole } from '@medsupply/shared-types';
import { toDateInputValue, zonedDayBoundary } from '@medsupply/utilities';
import { AuditLog } from '../models/AuditLog';
import { Delivery } from '../models/Delivery';
import { Trip, TripStatus } from '../models/Trip';
import { nextReference } from '../models/Counter';
import { businessTimeZone } from './localisation';

type Actor = { _id: Types.ObjectId; role: UserRole };

/**
 * A rider's round for one day.
 *
 * Deliveries are assigned one at a time and nothing groups them, so there is no
 * stop sequence, no load summary and nothing to print and carry. That is the
 * gap: the per-delivery capture is good, and the day's-work view is missing.
 *
 * A trip **groups and orders**; it does not own. Every delivery stays exactly
 * as workable on its own as it was, which is what makes adding this safe.
 */

function failure(message: string, code: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** The statuses a delivery can be in and still be worth planning a stop for. */
const PLANNABLE: readonly string[] = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.HANDED_OVER,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.OUT_FOR_DELIVERY,
];

/** Reached one way or another; the stop is done being planned. */
const SETTLED: readonly string[] = [
  DeliveryStatus.DELIVERED,
  DeliveryStatus.PARTIALLY_DELIVERED,
  DeliveryStatus.FAILED,
  DeliveryStatus.RETURNING,
  DeliveryStatus.RETURNED_TO_STORE,
  DeliveryStatus.CANCELLED,
];

/**
 * Midnight on the given day, in the business zone.
 *
 * `new Date('2026-08-04')` parses as UTC, so a round planned for the 4th would
 * be stored as the 3rd at 18:00 Dhaka and sort into the wrong day — the same
 * class of defect phase 12 fixed in `nextReference`. `zonedDayBoundary` already
 * does this correctly and is tested; the zone comes from the country pack
 * rather than the display settings, because moving a day boundary is not
 * something an administrator should do from a formatting form.
 */
function tripDayStart(value: string | Date): Date {
  const day = typeof value === 'string' ? value : toDateInputValue(value);
  return zonedDayBoundary(day, businessTimeZone());
}

export interface PlanTripInput {
  deliveryPersonId: string;
  tripDate: string;
  deliveryIds: string[];
  vehicleReference?: string;
  notes?: string;
}

export async function planTrip(input: PlanTripInput, actor: Actor) {
  if (input.deliveryIds.length === 0) {
    throw failure('A round needs at least one stop', 'NO_STOPS');
  }

  const deliveries = await Delivery.find({
    _id: { $in: input.deliveryIds.map((id) => new Types.ObjectId(id)) },
  }).select('reference status assignedTo');

  if (deliveries.length !== input.deliveryIds.length) {
    throw failure('One of those deliveries does not exist', 'DELIVERY_NOT_FOUND', 404);
  }

  const notPlannable = deliveries.filter((delivery) => !PLANNABLE.includes(delivery.status));
  if (notPlannable.length > 0) {
    throw failure(
      `These are not waiting to be delivered: ${notPlannable.map((d) => d.reference).join(', ')}`,
      'DELIVERY_NOT_PLANNABLE',
      409,
    );
  }

  /*
   * A delivery belongs to one round. Two riders holding the same stop on two
   * sheets is how a shop gets visited twice and how the office loses track of
   * who has the box.
   */
  const alreadyPlanned = await Trip.findOne({
    status: { $in: [TripStatus.PLANNED, TripStatus.IN_PROGRESS] },
    'stops.deliveryId': { $in: deliveries.map((delivery) => delivery._id) },
  }).select('reference');
  if (alreadyPlanned) {
    throw failure(
      `One of those stops is already on round ${alreadyPlanned.reference}`,
      'DELIVERY_ALREADY_ON_TRIP',
      409,
    );
  }

  const trip = await Trip.create({
    reference: await nextReference('TRP'),
    status: TripStatus.PLANNED,
    deliveryPersonId: new Types.ObjectId(input.deliveryPersonId),
    tripDate: tripDayStart(input.tripDate),
    vehicleReference: input.vehicleReference,
    notes: input.notes,
    createdBy: actor._id,
    // The order they were given in is the order they are meant to be made in.
    stops: input.deliveryIds.map((deliveryId, index) => ({
      deliveryId: new Types.ObjectId(deliveryId),
      sequence: index + 1,
    })),
  });

  await AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    action: 'TRIP_PLANNED',
    entityType: 'Trip',
    entityId: trip._id,
    after: { reference: trip.reference, stops: trip.stops.length },
  });

  return trip;
}

export interface ResequenceInput {
  version: number;
  deliveryIds: string[];
}

/**
 * Reorders the stops.
 *
 * Takes the whole list rather than a move instruction, because a round is
 * reordered by dragging it into shape and a partial update would need the
 * client and the server to agree on what the other one thought the order was.
 */
export async function resequenceTrip(tripId: string, input: ResequenceInput) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw failure('Round not found', 'NOT_FOUND', 404);
  if (trip.status === TripStatus.COMPLETED || trip.status === TripStatus.CANCELLED) {
    throw failure('This round is finished', 'TRIP_CLOSED', 409);
  }
  if (trip.version !== input.version) {
    throw failure('Somebody else has changed this round', 'VERSION_CONFLICT', 409);
  }

  const existing = new Set(trip.stops.map((stop) => String(stop.deliveryId)));
  const given = new Set(input.deliveryIds);
  if (existing.size !== given.size || [...existing].some((id) => !given.has(id))) {
    throw failure('That is not the same set of stops', 'STOPS_MISMATCH');
  }

  const byDelivery = new Map(trip.stops.map((stop) => [String(stop.deliveryId), stop]));
  trip.stops = input.deliveryIds.map((deliveryId, index) => {
    const stop = byDelivery.get(deliveryId)!;
    stop.sequence = index + 1;
    return stop;
  }) as typeof trip.stops;

  trip.version += 1;
  await trip.save();
  return trip;
}

export async function startTrip(tripId: string, version: number) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw failure('Round not found', 'NOT_FOUND', 404);
  if (trip.status !== TripStatus.PLANNED) {
    throw failure('This round is not waiting to start', 'TRIP_NOT_PLANNED', 409);
  }
  if (trip.version !== version) {
    throw failure('Somebody else has changed this round', 'VERSION_CONFLICT', 409);
  }

  trip.status = TripStatus.IN_PROGRESS;
  trip.startedAt = new Date();
  trip.version += 1;
  await trip.save();
  return trip;
}

export async function cancelTrip(
  tripId: string,
  input: { version: number; reason: string },
  actor: Actor,
) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw failure('Round not found', 'NOT_FOUND', 404);
  if (trip.status === TripStatus.COMPLETED) {
    throw failure('A finished round cannot be called off', 'TRIP_COMPLETED', 409);
  }
  if (trip.version !== input.version) {
    throw failure('Somebody else has changed this round', 'VERSION_CONFLICT', 409);
  }

  trip.status = TripStatus.CANCELLED;
  trip.cancelledAt = new Date();
  trip.cancelledReason = input.reason;
  trip.version += 1;
  await trip.save();

  await AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    action: 'TRIP_CANCELLED',
    entityType: 'Trip',
    entityId: trip._id,
    after: { reference: trip.reference, reason: input.reason },
  });

  /*
   * Every delivery is left exactly as it was — still assigned, still workable
   * one at a time. Calling off a round is a change to the plan, not to the
   * work, and unassigning them here would strand boxes a rider is holding.
   */
  return trip;
}

/**
 * The round as it actually stands, with each stop's live delivery beside it.
 *
 * The trip stores no delivery state of its own, so this reads it. Completion is
 * derived the same way: a round is finished when every stop has been reached,
 * which is a fact about the deliveries rather than a flag somebody remembers to
 * set.
 */
export async function tripWithStops(tripId: string) {
  const trip = await Trip.findById(tripId)
    .populate('deliveryPersonId', 'firstName lastName')
    .lean();
  if (!trip) throw failure('Round not found', 'NOT_FOUND', 404);

  const deliveries = await Delivery.find({
    _id: { $in: trip.stops.map((stop) => stop.deliveryId) },
  })
    .select(
      'reference status shopId addressSnapshot contactSnapshot expectedDeliveryDate packageId',
    )
    .populate('shopId', 'reference name')
    .populate('packageId', 'reference packageCount')
    .lean();

  const byId = new Map(deliveries.map((delivery) => [String(delivery._id), delivery]));
  const stops = [...trip.stops]
    .sort((left, right) => left.sequence - right.sequence)
    .map((stop) => ({
      _id: String(stop._id),
      sequence: stop.sequence,
      settledAt: stop.settledAt,
      delivery: byId.get(String(stop.deliveryId)) ?? null,
    }));

  const settled = stops.filter(
    (stop) => stop.delivery && SETTLED.includes(String(stop.delivery.status)),
  ).length;

  return {
    ...trip,
    stops,
    summary: {
      stopsTotal: stops.length,
      stopsSettled: settled,
      stopsRemaining: stops.length - settled,
      packages: stops.reduce((sum, stop) => {
        const pack = stop.delivery?.packageId as unknown as { packageCount?: number } | undefined;
        return sum + (pack?.packageCount ?? 0);
      }, 0),
    },
  };
}

/** Deliveries that could go on a round today and are not already on one. */
export async function plannableDeliveries(deliveryPersonId?: string) {
  const onATrip = await Trip.find({
    status: { $in: [TripStatus.PLANNED, TripStatus.IN_PROGRESS] },
  })
    .select('stops.deliveryId')
    .lean();
  const taken = new Set(
    onATrip.flatMap((trip) => trip.stops.map((stop) => String(stop.deliveryId))),
  );

  /*
   * `assignedTo` on the delivery, not `deliveryPersonId`. The trip names its
   * rider `deliveryPersonId` to match the rest of the product's vocabulary,
   * and the delivery model has called the same thing `assignedTo` since the
   * delivery phase. Recorded here rather than renamed, because renaming a field
   * on an existing collection is a migration and not a tidy-up.
   */
  const filter: Record<string, unknown> = { status: { $in: PLANNABLE } };
  if (deliveryPersonId) filter.assignedTo = new Types.ObjectId(deliveryPersonId);

  const deliveries = await Delivery.find(filter)
    .select('reference status shopId addressSnapshot expectedDeliveryDate assignedTo')
    .populate('shopId', 'reference name')
    .sort({ expectedDeliveryDate: 1 })
    .limit(200)
    .lean();

  return deliveries.filter((delivery) => !taken.has(String(delivery._id)));
}
