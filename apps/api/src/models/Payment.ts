import mongoose from 'mongoose';
import {
  CollectionHandoverStatus,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
} from '@medsupply/shared-types';
import { applyQueryGuards } from './queryGuards';

const safePositiveMoney = {
  type: Number,
  required: true,
  min: 1,
  validate: Number.isSafeInteger,
} as const;

const safeMoney = {
  type: Number,
  required: true,
  min: 0,
  validate: Number.isSafeInteger,
} as const;

const schema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    /**
     * The currency this document was issued in.
     *
     * Read from the record, never from settings. `currencyCode` and
     * `currencySymbol` are configurable, so rendering from the live setting
     * would silently restate every document ever issued — including ones a
     * customer holds on paper. The exponent rides along because it is what
     * relates the stored integer to the printed amount, and taking that from a
     * later configuration is a hundredfold error.
     */
    currencySnapshot: {
      code: { type: String, trim: true, uppercase: true },
      symbol: { type: String, trim: true },
      exponent: { type: Number, min: 0, max: 4 },
    },
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', index: true },
    deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery' },
    amountMinor: safePositiveMoney,
    invoiceAppliedMinor: { ...safeMoney, default: 0 },
    advanceCreatedMinor: { ...safeMoney, default: 0 },
    method: { type: String, enum: Object.values(PaymentMethod), required: true, index: true },
    transactionReference: String,
    source: {
      type: String,
      enum: Object.values(PaymentSource),
      default: PaymentSource.MANUAL,
      required: true,
      index: true,
    },
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    collectedAt: { type: Date, required: true, index: true },
    postedAt: Date,
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receiptReference: { type: String, unique: true, sparse: true },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
      required: true,
      index: true,
    },
    failureReason: String,
    failedAt: Date,
    failedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: String,
    allowAdvance: { type: Boolean, default: false, immutable: true },
    attachmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentAttachment' },
    reversalReference: String,
    reversalReason: String,
    reversedAt: Date,
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    handoverStatus: {
      type: String,
      enum: Object.values(CollectionHandoverStatus),
      default: CollectionHandoverStatus.NOT_REQUIRED,
      required: true,
      index: true,
    },
    handedOverAt: Date,
    handedOverBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    idempotencyKey: { type: String, required: true, unique: true },
    requestFingerprint: { type: String, required: true, immutable: true },
    postingIdempotencyKey: { type: String, unique: true, sparse: true },
    failureIdempotencyKey: { type: String, unique: true, sparse: true },
    reversalIdempotencyKey: { type: String, unique: true, sparse: true },
    handoverIdempotencyKey: { type: String, unique: true, sparse: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ shopId: 1, collectedAt: -1 });
schema.index({ status: 1, source: 1, collectedAt: 1 });
schema.index({ collectedBy: 1, collectedAt: -1 });
schema.index(
  { shopId: 1, method: 1, transactionReference: 1 },
  {
    unique: true,
    partialFilterExpression: { transactionReference: { $type: 'string' } },
  },
);
schema.index(
  { deliveryId: 1 },
  { unique: true, partialFilterExpression: { deliveryId: { $type: 'objectId' } } },
);

schema.pre('save', function protectPostedPayment() {
  const protectedStatus =
    this.status === PaymentStatus.POSTED || this.status === PaymentStatus.REVERSED;
  if (!this.isNew && protectedStatus && this.$locals.financialTransition !== true) {
    throw Object.assign(new Error('Posted financial records cannot be edited'), {
      statusCode: 409,
      code: 'PAYMENT_IMMUTABLE',
    });
  }
});

function blockQueryMutation() {
  throw Object.assign(new Error('Payments must be changed through financial actions'), {
    statusCode: 409,
    code: 'PAYMENT_ACTION_REQUIRED',
  });
}

schema.pre('updateOne', blockQueryMutation);
schema.pre('updateMany', blockQueryMutation);
schema.pre('findOneAndUpdate', blockQueryMutation);
schema.pre('replaceOne', blockQueryMutation);
schema.pre('deleteOne', blockQueryMutation);
schema.pre('deleteMany', blockQueryMutation);
schema.pre('findOneAndDelete', blockQueryMutation);

applyQueryGuards(schema);

export const Payment = mongoose.model('Payment', schema);
