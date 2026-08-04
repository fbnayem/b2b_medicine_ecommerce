import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

export const TripStatus = {
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

/**
 * One stop, in the order the rider is meant to make it.
 *
 * The delivery keeps its own status; this only records the planned sequence and
 * when the stop was reached. Duplicating the delivery's state here would create
 * a second answer to "was this delivered", and the two would eventually
 * disagree — which on a delivery is the disagreement that matters most.
 */
const stopSchema = new mongoose.Schema(
  {
    deliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Delivery',
      required: true,
      index: true,
    },
    sequence: { type: Number, required: true, min: 1 },
    /** Stamped when the delivery reaches a terminal state, for the day's record. */
    settledAt: Date,
  },
  { _id: true },
);

/**
 * A rider's round for one day.
 *
 * Deliveries are assigned one at a time and there is no view of the day: no
 * stop sequence, no load summary, nothing to print and carry. Per-delivery
 * capture is already good — the offline queue, the camera proof, the code — and
 * it is the day's-work view that is absent, which is why a rider plans their
 * round on paper and the office cannot say where anybody is.
 *
 * Deliberately thin. A trip **groups and orders** deliveries; it does not own
 * them. Cancelling a trip leaves every delivery exactly as it was, still
 * assigned, still workable one at a time.
 */
const tripSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: Object.values(TripStatus),
      required: true,
      default: TripStatus.PLANNED,
      index: true,
    },
    deliveryPersonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** The day the round is for, at midnight in the tenant's zone. */
    tripDate: { type: Date, required: true, index: true },
    stops: { type: [stopSchema], required: true },
    vehicleReference: { type: String, trim: true },
    notes: String,
    startedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancelledReason: { type: String, trim: true },
    version: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

tripSchema.index({ deliveryPersonId: 1, tripDate: -1 });
tripSchema.index({ status: 1, tripDate: -1 });

applyQueryGuards(tripSchema);

export const Trip = mongoose.model('Trip', tripSchema);
