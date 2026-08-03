import mongoose, { Types } from 'mongoose';
import { OrderStatus, StockMovementType, UserRole } from '@medsupply/shared-types';
import { MedicineBatch } from '../models/MedicineBatch';
import { Order } from '../models/Order';
import { StockMovement } from '../models/StockMovement';
import { CreditReservation } from '../models/CreditReservation';
import { AuditLog } from '../models/AuditLog';
import { releaseCredit } from './creditReservationService';

/**
 * Cancelling an order.
 *
 * `ORDER_STATE_MACHINE.md` has documented a controlled transition to
 * `CANCELLED` since the fourth phase of the original build. **No endpoint
 * performed it and nothing anywhere set that status.** What existed was
 * `POST /orders/:id/cancellation-request`, which stamped a timestamp, fired an
 * `ORDER_CANCELLED` notification — telling management an order had been
 * cancelled when it had not — and then dead-ended. A shop owner who cancelled
 * saw a confirmation; the warehouse picked the order anyway.
 *
 * Cancelling is not a status change. It releases two things the order is
 * holding, and both must be released with it or not at all:
 *
 *   - the **credit reservation**, which is otherwise counted against the shop's
 *     limit forever and eventually blocks their next real order;
 *   - the **FEFO stock allocation**, which is otherwise reserved against a batch
 *     nobody will ever pick, quietly reducing available stock until somebody
 *     notices the arithmetic does not add up.
 *
 * Both, plus the status and the audit record, in one transaction.
 */

export interface CancellationActor {
  _id: Types.ObjectId;
  role: UserRole;
}

/** Who may decide a cancellation. Mirrors the rejection path in `approvalService`. */
export const CANCELLATION_DECIDERS: readonly UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
];

/**
 * The statuses a cancellation can still be granted from.
 *
 * It stops at `PACKED`: past that an invoice exists and stock has physically
 * left the shelf, so the correct instrument is a return, which credits the
 * invoice and brings the goods back through a receipt. Cancelling there would
 * leave an invoice with no order and stock with no movement.
 */
export const CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.SUBMITTED,
  OrderStatus.UNDER_REVIEW,
  OrderStatus.ON_HOLD,
  OrderStatus.APPROVED,
  OrderStatus.PARTIALLY_APPROVED,
  OrderStatus.PREPARING,
];

function cancellationError(message: string, code: string, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode, code });
}

export interface CancellationDecision {
  /** `false` refuses the request and returns the order to where it was. */
  approve: boolean;
  reason: string;
  version: number;
  idempotencyKey?: string;
}

export interface CancellationResult {
  order: InstanceType<typeof Order>;
  releasedCreditMinor: number;
  releasedStockUnits: number;
  idempotentReplay: boolean;
}

/**
 * Returns every unit this order still holds in `reserved` back to `available`.
 *
 * Reads the reservation movements the order itself created rather than the
 * approval lines, because the two can differ: a partially approved order
 * reserves the approved quantity, and a re-approval reserves again. The
 * movements are the record of what was actually taken.
 */
async function releaseReservedStock(
  orderId: Types.ObjectId,
  actor: CancellationActor,
  session: mongoose.ClientSession,
): Promise<number> {
  const reservations = await StockMovement.find({
    referenceType: 'Order',
    referenceId: String(orderId),
    type: StockMovementType.RESERVATION,
  }).session(session);

  // Anything already given back — by a shortfall, or by a previous attempt at
  // this very cancellation — must not be given back twice.
  const released = await StockMovement.find({
    referenceType: 'Order',
    referenceId: String(orderId),
    type: StockMovementType.RESERVATION_RELEASE,
  }).session(session);

  const alreadyReleased = new Map<string, number>();
  for (const movement of released) {
    const key = String(movement.batchId);
    alreadyReleased.set(key, (alreadyReleased.get(key) ?? 0) + movement.quantity);
  }

  let total = 0;
  for (const reservation of reservations) {
    const key = String(reservation.batchId);
    const outstanding = reservation.quantity - (alreadyReleased.get(key) ?? 0);
    if (outstanding <= 0) continue;

    const before = await MedicineBatch.findById(reservation.batchId).session(session);
    if (!before) continue;

    // Never return more than the batch is actually holding: a batch whose
    // reservation was consumed by packing has nothing left to give back, and
    // decrementing it anyway would invent stock.
    const quantity = Math.min(outstanding, before.quantities.reserved);
    if (quantity <= 0) continue;

    const updated = await MedicineBatch.findOneAndUpdate(
      {
        _id: reservation.batchId,
        version: before.version,
        'quantities.reserved': { $gte: quantity },
      },
      {
        $inc: {
          'quantities.reserved': -quantity,
          'quantities.available': quantity,
          version: 1,
        },
      },
      { new: true, session },
    );
    if (!updated) {
      throw cancellationError(
        'The stock for this order changed while it was being cancelled',
        'CONCURRENT_CANCELLATION',
      );
    }

    await StockMovement.create(
      [
        {
          medicineId: reservation.medicineId,
          batchId: reservation.batchId,
          type: StockMovementType.RESERVATION_RELEASE,
          quantity,
          before: before.quantities,
          after: updated.quantities,
          reason: 'Order cancelled',
          referenceType: 'Order',
          referenceId: String(orderId),
          actorId: actor._id,
          actorRole: actor.role,
          idempotencyKey: `cancellation-release:${orderId}:${reservation.batchId}`,
        },
      ],
      { session },
    );
    alreadyReleased.set(key, (alreadyReleased.get(key) ?? 0) + quantity);
    total += quantity;
  }
  return total;
}

export async function decideCancellation(
  orderId: string,
  decision: CancellationDecision,
  actor: CancellationActor,
): Promise<CancellationResult> {
  if (!CANCELLATION_DECIDERS.includes(actor.role)) {
    throw cancellationError(
      'Only a manager or an administrator can decide a cancellation',
      'FORBIDDEN',
      403,
    );
  }
  const reason = decision.reason.trim();
  if (reason.length < 5 || reason.length > 500) {
    throw cancellationError(
      'A reason between 5 and 500 characters is required',
      'REASON_REQUIRED',
      400,
    );
  }

  const session = await mongoose.startSession();
  try {
    let result: CancellationResult | undefined;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw cancellationError('Order not found', 'NOT_FOUND', 404);

      // Replaying the same decision returns the same answer rather than
      // refusing, so a lost response does not leave the caller unsure.
      if (order.status === OrderStatus.CANCELLED) {
        result = {
          order,
          releasedCreditMinor: 0,
          releasedStockUnits: 0,
          idempotentReplay: true,
        };
        return;
      }

      if (!order.cancellationRequestedAt) {
        throw cancellationError(
          'This order has no cancellation request to decide',
          'NO_CANCELLATION_REQUEST',
        );
      }
      if (order.version !== decision.version) {
        throw cancellationError('The order changed while you were reviewing it', 'STALE_VERSION');
      }

      if (!decision.approve) {
        // Refusing clears the request so the order resumes its normal life,
        // and records why, because the shop owner asked for something and is
        // owed an answer.
        order.cancellationRequestedAt = undefined;
        order.cancellationDecision = 'REFUSED';
        order.cancellationDecisionReason = reason;
        order.cancellationDecidedBy = actor._id;
        order.cancellationDecidedAt = new Date();
        order.version += 1;
        await order.save({ session });

        await AuditLog.create(
          [
            {
              actorId: actor._id,
              actorRole: actor.role,
              action: 'ORDER_CANCELLATION_REFUSED',
              entityType: 'Order',
              entityId: order._id,
              after: { reason },
            },
          ],
          { session },
        );

        result = {
          order,
          releasedCreditMinor: 0,
          releasedStockUnits: 0,
          idempotentReplay: false,
        };
        return;
      }

      if (!CANCELLABLE_STATUSES.includes(order.status as OrderStatus)) {
        throw cancellationError(
          `An order that is ${order.status.toLowerCase().replaceAll('_', ' ')} can no longer be ` +
            `cancelled. Raise a return instead, so the invoice is credited and the goods come back.`,
          'CANCELLATION_NOT_ALLOWED',
        );
      }

      const releasedStockUnits = await releaseReservedStock(order._id, actor, session);

      let releasedCreditMinor = 0;
      const reservation = await CreditReservation.findOne({ orderId: order._id }).session(session);
      if (reservation) {
        const released = await releaseCredit(
          order._id,
          `Order cancelled: ${reason}`,
          actor,
          session,
        );
        releasedCreditMinor = released.releasedExposureMinor;
      }

      order.status = OrderStatus.CANCELLED;
      order.cancellationDecision = 'APPROVED';
      order.cancellationDecisionReason = reason;
      order.cancellationDecidedBy = actor._id;
      order.cancellationDecidedAt = new Date();
      order.version += 1;
      await order.save({ session });

      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'ORDER_CANCELLED',
            entityType: 'Order',
            entityId: order._id,
            after: { reason, releasedCreditMinor, releasedStockUnits },
          },
        ],
        { session },
      );

      result = { order, releasedCreditMinor, releasedStockUnits, idempotentReplay: false };
    });

    return result!;
  } finally {
    await session.endSession();
  }
}
