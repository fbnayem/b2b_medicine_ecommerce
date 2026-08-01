import mongoose from 'mongoose';
import { UserRole } from '@medsupply/shared-types';

export const CreditReservationStatus = {
  ACTIVE: 'ACTIVE',
  CONSUMED: 'CONSUMED',
  RELEASED: 'RELEASED',
} as const;

export type CreditReservationStatus =
  (typeof CreditReservationStatus)[keyof typeof CreditReservationStatus];

export const CreditReservationSource = {
  ORDER_APPROVAL: 'ORDER_APPROVAL',
  MIGRATION_BACKFILL: 'MIGRATION_BACKFILL',
} as const;

export type CreditReservationSource =
  (typeof CreditReservationSource)[keyof typeof CreditReservationSource];

const safeMoney = {
  type: Number,
  required: true,
  min: 0,
  validate: Number.isSafeInteger,
} as const;

const safeSignedMoney = {
  type: Number,
  required: true,
  validate: Number.isSafeInteger,
} as const;

const decisionSnapshotSchema = new mongoose.Schema(
  {
    creditLimitMinor: safeMoney,
    outstandingMinor: safeMoney,
    reservedMinor: safeMoney,
    overdueMinor: safeMoney,
    availableCreditMinor: safeSignedMoney,
    proposedExposureMinor: safeMoney,
    blockedReasons: { type: [String], default: [] },
    overrideApplied: { type: Boolean, required: true, default: false },
    overrideReason: String,
    overrideBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    overrideRole: { type: String, enum: Object.values(UserRole) },
    capturedAt: { type: Date, required: true },
  },
  { _id: false },
);

const migrationBackfillSchema = new mongoose.Schema(
  {
    reason: { type: String, required: true, minlength: 5, maxlength: 500 },
    idempotencyKey: { type: String, required: true, minlength: 8, maxlength: 120 },
    requestHash: { type: String, required: true, minlength: 64, maxlength: 64 },
    originalManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    originalCreditOverride: { type: Boolean, required: true },
    originalOverrideReason: String,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    performedByRole: { type: String, enum: Object.values(UserRole), required: true },
    performedAt: { type: Date, required: true },
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
      immutable: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
      index: true,
      immutable: true,
    },
    approvedExposureMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
      immutable: true,
    },
    status: {
      type: String,
      enum: Object.values(CreditReservationStatus),
      required: true,
      default: CreditReservationStatus.ACTIVE,
      index: true,
    },
    source: {
      type: String,
      enum: Object.values(CreditReservationSource),
      required: true,
      default: CreditReservationSource.ORDER_APPROVAL,
      immutable: true,
    },
    migrationBackfill: { type: migrationBackfillSchema, immutable: true },
    decisionSnapshot: {
      type: decisionSnapshotSchema,
      required: true,
      immutable: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    createdByRole: {
      type: String,
      enum: Object.values(UserRole),
      required: true,
      immutable: true,
    },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    consumedExposureMinor: { ...safeMoney, default: 0 },
    releasedExposureMinor: { ...safeMoney, default: 0 },
    additionalExposureMinor: { ...safeMoney, default: 0 },
    consumedAt: Date,
    consumedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    consumedByRole: { type: String, enum: Object.values(UserRole) },
    releasedAt: Date,
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    releasedByRole: { type: String, enum: Object.values(UserRole) },
    releaseReason: String,
    version: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

schema.index({ shopId: 1, status: 1, createdAt: 1 });
schema.index({ 'migrationBackfill.idempotencyKey': 1 }, { unique: true, sparse: true });

schema.pre('validate', function validateCreditReservation() {
  const snapshot = this.decisionSnapshot;
  if (snapshot.proposedExposureMinor !== this.approvedExposureMinor) {
    this.invalidate(
      'decisionSnapshot.proposedExposureMinor',
      'The credit-decision snapshot must match the reserved exposure',
    );
  }
  if (
    snapshot.overrideApplied &&
    (!snapshot.overrideReason?.trim() || !snapshot.overrideBy || !snapshot.overrideRole)
  ) {
    this.invalidate(
      'decisionSnapshot.overrideReason',
      'An explicit reason, actor and role are required for a credit override',
    );
  }
  if (this.source === CreditReservationSource.MIGRATION_BACKFILL && !this.migrationBackfill) {
    this.invalidate(
      'migrationBackfill',
      'Migration metadata is required for a backfilled credit reservation',
    );
  }
  if (this.source !== CreditReservationSource.MIGRATION_BACKFILL && this.migrationBackfill) {
    this.invalidate(
      'migrationBackfill',
      'Migration metadata is allowed only on a backfilled credit reservation',
    );
  }
});

export const CreditReservation = mongoose.model('CreditReservation', schema);
