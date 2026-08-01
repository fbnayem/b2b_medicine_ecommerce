import type { ClientSession, Types } from 'mongoose';
import type { UserRole } from '@medsupply/shared-types';
import {
  CreditReservation,
  CreditReservationSource,
  CreditReservationStatus,
} from '../models/CreditReservation';

export type CreditReservationActor = {
  _id: Types.ObjectId;
  role: UserRole;
};

export type CreditDecisionSnapshotInput = {
  creditLimitMinor: number;
  outstandingMinor: number;
  reservedMinor: number;
  overdueMinor: number;
  availableCreditMinor: number;
  proposedExposureMinor: number;
  blockedReasons?: string[];
  capturedAt?: Date;
};

export type ReserveCreditInput = {
  orderId: Types.ObjectId;
  shopId: Types.ObjectId;
  approvedExposureMinor: number;
  decisionSnapshot: CreditDecisionSnapshotInput;
  override?: { applied: false } | { applied: true; reason: string };
  source?: CreditReservationSource;
  migrationBackfill?: {
    reason: string;
    idempotencyKey: string;
    requestHash: string;
    originalManagerId: Types.ObjectId;
    originalCreditOverride: boolean;
    originalOverrideReason?: string;
  };
};

export type ConsumeCreditInput = {
  invoiceId: Types.ObjectId;
  actualInvoiceMinor: number;
};

export type CreditConsumptionDeltas = {
  consumedExposureMinor: number;
  releasedExposureMinor: number;
  additionalExposureMinor: number;
};

function creditError(message: string, code: string, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

export function assertSafeExposure(value: number, name: string, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw Object.assign(new Error(`${name} must be a safe integer amount in minor units`), {
      code: 'INVALID_CREDIT_EXPOSURE',
      statusCode: 400,
    });
  }
  return value;
}

export function calculateCreditConsumption(
  reservedExposureMinor: number,
  actualInvoiceMinor: number,
): CreditConsumptionDeltas {
  const reserved = assertSafeExposure(reservedExposureMinor, 'Reserved exposure', false);
  const actual = assertSafeExposure(actualInvoiceMinor, 'Actual invoice exposure');
  return {
    consumedExposureMinor: actual,
    releasedExposureMinor: Math.max(0, reserved - actual),
    additionalExposureMinor: Math.max(0, actual - reserved),
  };
}

function validateDecision(input: ReserveCreditInput) {
  assertSafeExposure(input.approvedExposureMinor, 'Approved exposure', false);
  const snapshot = input.decisionSnapshot;
  assertSafeExposure(snapshot.creditLimitMinor, 'Credit limit');
  assertSafeExposure(snapshot.outstandingMinor, 'Outstanding balance');
  assertSafeExposure(snapshot.reservedMinor, 'Reserved credit');
  assertSafeExposure(snapshot.overdueMinor, 'Overdue balance');
  if (!Number.isSafeInteger(snapshot.availableCreditMinor)) {
    throw Object.assign(
      new Error('Available credit must be a safe integer amount in minor units'),
      {
        code: 'INVALID_CREDIT_EXPOSURE',
        statusCode: 400,
      },
    );
  }
  if (snapshot.proposedExposureMinor !== input.approvedExposureMinor) {
    throw creditError(
      'Credit-decision exposure does not match the reservation amount',
      'CREDIT_DECISION_MISMATCH',
      400,
    );
  }
  const blockedReasons = (snapshot.blockedReasons ?? []).filter((reason) => reason.trim());
  if (
    blockedReasons.length > 0 &&
    !input.override?.applied &&
    input.source !== CreditReservationSource.MIGRATION_BACKFILL
  ) {
    throw creditError(`Credit approval is blocked: ${blockedReasons.join('; ')}`, 'CREDIT_BLOCKED');
  }
  if (input.override?.applied && input.override.reason.trim().length < 5) {
    throw creditError(
      'A meaningful reason is required for a credit override',
      'CREDIT_OVERRIDE_REASON_REQUIRED',
      400,
    );
  }
  if (input.source === CreditReservationSource.MIGRATION_BACKFILL && !input.migrationBackfill) {
    throw creditError(
      'Migration metadata is required for a backfilled reservation',
      'CREDIT_MIGRATION_METADATA_REQUIRED',
      400,
    );
  }
}

export async function getActiveReservedExposure(shopId: Types.ObjectId, session?: ClientSession) {
  const aggregate = CreditReservation.aggregate<{ totalMinor: number }>([
    {
      $match: {
        shopId,
        status: CreditReservationStatus.ACTIVE,
      },
    },
    { $group: { _id: null, totalMinor: { $sum: '$approvedExposureMinor' } } },
  ]);
  if (session) aggregate.session(session);
  const [result] = await aggregate;
  return assertSafeExposure(result?.totalMinor ?? 0, 'Active reserved exposure');
}

function sameReservation(
  existing: InstanceType<typeof CreditReservation>,
  input: ReserveCreditInput,
) {
  return (
    String(existing.shopId) === String(input.shopId) &&
    existing.approvedExposureMinor === input.approvedExposureMinor &&
    existing.decisionSnapshot.overrideApplied === Boolean(input.override?.applied) &&
    (existing.decisionSnapshot.overrideReason ?? '') ===
      (input.override?.applied ? input.override.reason.trim() : '') &&
    existing.source === (input.source ?? CreditReservationSource.ORDER_APPROVAL) &&
    (existing.migrationBackfill?.requestHash ?? '') === (input.migrationBackfill?.requestHash ?? '')
  );
}

export async function reserveCredit(
  input: ReserveCreditInput,
  actor: CreditReservationActor,
  session: ClientSession,
) {
  validateDecision(input);
  const existing = await CreditReservation.findOne({ orderId: input.orderId }).session(session);
  if (existing) {
    if (!sameReservation(existing, input)) {
      throw creditError(
        'This order already has a different credit reservation',
        'CREDIT_RESERVATION_CONFLICT',
      );
    }
    return { reservation: existing, idempotentReplay: true };
  }

  const overrideApplied = Boolean(input.override?.applied);
  const [reservation] = await CreditReservation.create(
    [
      {
        orderId: input.orderId,
        shopId: input.shopId,
        approvedExposureMinor: input.approvedExposureMinor,
        decisionSnapshot: {
          ...input.decisionSnapshot,
          blockedReasons: [...new Set(input.decisionSnapshot.blockedReasons ?? [])],
          capturedAt: input.decisionSnapshot.capturedAt ?? new Date(),
          overrideApplied,
          overrideReason: input.override?.applied ? input.override.reason.trim() : undefined,
          overrideBy: overrideApplied ? actor._id : undefined,
          overrideRole: overrideApplied ? actor.role : undefined,
        },
        source: input.source ?? CreditReservationSource.ORDER_APPROVAL,
        migrationBackfill: input.migrationBackfill
          ? {
              ...input.migrationBackfill,
              reason: input.migrationBackfill.reason.trim(),
              originalOverrideReason: input.migrationBackfill.originalOverrideReason?.trim(),
              performedBy: actor._id,
              performedByRole: actor.role,
              performedAt: new Date(),
            }
          : undefined,
        createdBy: actor._id,
        createdByRole: actor.role,
      },
    ],
    { session },
  );
  return { reservation, idempotentReplay: false };
}

export async function consumeCredit(
  orderId: Types.ObjectId,
  input: ConsumeCreditInput,
  actor: CreditReservationActor,
  session: ClientSession,
) {
  const reservation = await CreditReservation.findOne({ orderId }).session(session);
  if (!reservation) {
    throw creditError('The order has no credit reservation', 'CREDIT_RESERVATION_NOT_FOUND', 404);
  }
  const deltas = calculateCreditConsumption(
    reservation.approvedExposureMinor,
    input.actualInvoiceMinor,
  );
  if (reservation.status === CreditReservationStatus.CONSUMED) {
    if (
      String(reservation.invoiceId) !== String(input.invoiceId) ||
      reservation.consumedExposureMinor !== input.actualInvoiceMinor
    ) {
      throw creditError(
        'The credit reservation was consumed by a different invoice result',
        'CREDIT_RESERVATION_CONFLICT',
      );
    }
    return { reservation, deltas, idempotentReplay: true };
  }
  if (reservation.status !== CreditReservationStatus.ACTIVE) {
    throw creditError(
      'A released credit reservation cannot be consumed',
      'CREDIT_RESERVATION_RELEASED',
    );
  }

  const updated = await CreditReservation.findOneAndUpdate(
    {
      _id: reservation._id,
      status: CreditReservationStatus.ACTIVE,
      version: reservation.version,
    },
    {
      $set: {
        status: CreditReservationStatus.CONSUMED,
        invoiceId: input.invoiceId,
        ...deltas,
        consumedAt: new Date(),
        consumedBy: actor._id,
        consumedByRole: actor.role,
      },
      $inc: { version: 1 },
    },
    { new: true, runValidators: true, session },
  );
  if (!updated) {
    throw creditError('The credit reservation changed concurrently', 'STALE_CREDIT_RESERVATION');
  }
  return { reservation: updated, deltas, idempotentReplay: false };
}

export async function releaseCredit(
  orderId: Types.ObjectId,
  reason: string,
  actor: CreditReservationActor,
  session: ClientSession,
) {
  const normalisedReason = reason.trim();
  if (normalisedReason.length < 5 || normalisedReason.length > 500) {
    throw creditError(
      'A release reason between 5 and 500 characters is required',
      'CREDIT_RELEASE_REASON_REQUIRED',
      400,
    );
  }
  const reservation = await CreditReservation.findOne({ orderId }).session(session);
  if (!reservation) {
    throw creditError('The order has no credit reservation', 'CREDIT_RESERVATION_NOT_FOUND', 404);
  }
  if (reservation.status === CreditReservationStatus.RELEASED) {
    if (reservation.releaseReason !== normalisedReason) {
      throw creditError(
        'The credit reservation was released for a different reason',
        'CREDIT_RESERVATION_CONFLICT',
      );
    }
    return {
      reservation,
      releasedExposureMinor: reservation.approvedExposureMinor,
      idempotentReplay: true,
    };
  }
  if (reservation.status !== CreditReservationStatus.ACTIVE) {
    throw creditError(
      'A consumed credit reservation cannot be released',
      'CREDIT_RESERVATION_CONSUMED',
    );
  }

  const updated = await CreditReservation.findOneAndUpdate(
    {
      _id: reservation._id,
      status: CreditReservationStatus.ACTIVE,
      version: reservation.version,
    },
    {
      $set: {
        status: CreditReservationStatus.RELEASED,
        releasedExposureMinor: reservation.approvedExposureMinor,
        releaseReason: normalisedReason,
        releasedAt: new Date(),
        releasedBy: actor._id,
        releasedByRole: actor.role,
      },
      $inc: { version: 1 },
    },
    { new: true, runValidators: true, session },
  );
  if (!updated) {
    throw creditError('The credit reservation changed concurrently', 'STALE_CREDIT_RESERVATION');
  }
  return {
    reservation: updated,
    releasedExposureMinor: reservation.approvedExposureMinor,
    idempotentReplay: false,
  };
}
