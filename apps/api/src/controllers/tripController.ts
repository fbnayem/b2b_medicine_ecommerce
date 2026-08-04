import type { NextFunction, Response } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  CancelTripSchema,
  PlanTripSchema,
  ResequenceTripSchema,
  StartTripSchema,
} from '@medsupply/validation';
import type { AuthRequest } from '../middlewares/auth';
import { Trip } from '../models/Trip';
import {
  cancelTrip,
  planTrip,
  plannableDeliveries,
  resequenceTrip,
  startTrip,
  tripWithStops,
} from '../services/tripService';

function actor(req: AuthRequest) {
  return { _id: req.user!._id, role: req.user!.role as UserRole };
}

export async function listTrips(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = String(req.query.status);

    /*
     * A rider sees their own rounds and nobody else's. Left to the query rather
     * than to the screen: a filter a client applies is a filter a client can
     * drop.
     */
    if (req.user!.role === UserRole.DELIVERY_PERSON) filter.deliveryPersonId = req.user!._id;
    else if (req.query.deliveryPersonId)
      filter.deliveryPersonId = String(req.query.deliveryPersonId);

    const [items, total] = await Promise.all([
      Trip.find(filter)
        .populate('deliveryPersonId', 'firstName lastName')
        .sort({ tripDate: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Trip.countDocuments(filter),
    ]);

    res.json({ data: { items, total, page, limit } });
  } catch (error) {
    next(error);
  }
}

export async function getTrip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const trip = await tripWithStops(String(req.params.id));
    if (
      req.user!.role === UserRole.DELIVERY_PERSON &&
      String(
        (trip.deliveryPersonId as unknown as { _id?: unknown })?._id ?? trip.deliveryPersonId,
      ) !== String(req.user!._id)
    ) {
      return res
        .status(403)
        .json({ error: { code: 'FORBIDDEN', message: 'That round is not yours' } });
    }
    res.json({ data: trip });
  } catch (error) {
    next(error);
  }
}

/** What could go on a round today, and is not already on one. */
export async function plannable(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const forPerson =
      req.user!.role === UserRole.DELIVERY_PERSON
        ? String(req.user!._id)
        : req.query.deliveryPersonId
          ? String(req.query.deliveryPersonId)
          : undefined;
    res.json({ data: await plannableDeliveries(forPerson) });
  } catch (error) {
    next(error);
  }
}

export async function plan(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = PlanTripSchema.parse(req.body);
    res.status(201).json({ data: await planTrip(input, actor(req)) });
  } catch (error) {
    next(error);
  }
}

export async function resequence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = ResequenceTripSchema.parse(req.body);
    res.json({ data: await resequenceTrip(String(req.params.id), input) });
  } catch (error) {
    next(error);
  }
}

export async function start(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = StartTripSchema.parse(req.body);
    res.json({ data: await startTrip(String(req.params.id), input.version) });
  } catch (error) {
    next(error);
  }
}

export async function cancel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = CancelTripSchema.parse(req.body);
    res.json({ data: await cancelTrip(String(req.params.id), input, actor(req)) });
  } catch (error) {
    next(error);
  }
}
