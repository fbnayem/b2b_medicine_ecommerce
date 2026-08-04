import mongoose from 'mongoose';
import { OrderStatus, ReturnReason, ReturnStatus, UserRole } from '@medsupply/shared-types';
import { applyQueryGuards } from './queryGuards';

const money = {
  type: Number,
  required: true,
  min: 0,
  default: 0,
  validate: Number.isSafeInteger,
} as const;

const quantity = { type: Number, required: true, min: 0, default: 0 } as const;

const medicineSnapshotSchema = new mongoose.Schema(
  {
    reference: String,
    sku: String,
    brandName: String,
    genericName: String,
    manufacturer: String,
    strength: String,
    dosageForm: String,
    packSize: String,
    unit: String,
  },
  { _id: false },
);

const lineSchema = new mongoose.Schema(
  {
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    medicineSnapshot: { type: medicineSnapshotSchema, required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicineBatch', required: true },
    batchNumber: { type: String, required: true },
    expiryDate: { type: Date, required: true },
    /** Copied from the invoice so the ceiling survives a later catalogue edit. */
    invoicedQuantity: { type: Number, required: true, min: 1 },
    /**
     * How many units physically went out on this line.
     *
     * Larger than `invoicedQuantity` only where a scheme sent free goods.
     * Crediting a return has to prorate over **this**, not over what was
     * charged: returning six of eleven credits six elevenths, and per-charged
     * unit would refund a tenth more than the customer ever handed over.
     */
    dispatchedQuantity: { type: Number, min: 0 },
    requestedQuantity: { type: Number, required: true, min: 1 },
    approvedQuantity: quantity,
    receivedQuantity: quantity,
    restockQuantity: quantity,
    damagedQuantity: quantity,
    expiredQuantity: quantity,
    quarantinedQuantity: quantity,
    unitPriceMinor: money,
    discountMinor: money,
    refundMinor: money,
    reason: { type: String, enum: Object.values(ReturnReason), required: true },
    notes: String,
  },
  { _id: false },
);

const historySchema = new mongoose.Schema(
  {
    from: { type: String, enum: Object.values(ReturnStatus) },
    to: { type: String, enum: Object.values(ReturnStatus), required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, enum: Object.values(UserRole), required: true },
    at: { type: Date, required: true },
    note: String,
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true,
    },
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery' },
    status: {
      type: String,
      enum: Object.values(ReturnStatus),
      default: ReturnStatus.REQUESTED,
      index: true,
    },
    primaryReason: { type: String, enum: Object.values(ReturnReason), required: true },
    /**
     * The order status this request interrupted, so a rejection or cancellation
     * can put the order back where it was instead of guessing.
     */
    orderStatusBeforeReturn: { type: String, enum: Object.values(OrderStatus) },
    shopNotes: String,
    internalNotes: String,
    reviewNotes: String,
    rejectionReason: String,
    lines: { type: [lineSchema], required: true },
    requestedTotalMinor: money,
    approvedSubtotalMinor: money,
    approvedTaxMinor: money,
    approvedTotalMinor: money,
    creditNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditNote' },
    creditNoteReference: String,
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    collectedAt: Date,
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receivedAt: Date,
    completedAt: Date,
    statusHistory: { type: [historySchema], default: [] },
    /** Optimistic concurrency guard shared by every lifecycle action. */
    version: { type: Number, default: 0 },
    /**
     * Idempotency keys already applied to this return. Hidden by default so a
     * list response never leaks client-generated keys.
     */
    processedActionKeys: { type: [String], default: [], select: false },
    requestIdempotencyKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);

schema.index({ shopId: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: -1 });
schema.index({ invoiceId: 1, status: 1 });

// Returns analytics and returned-value attribution match completed returns in
// a window rather than by creation date.
schema.index({ requestedAt: -1 });
schema.index({ status: 1, completedAt: 1 });
schema.index({ shopId: 1, status: 1, completedAt: 1 });

applyQueryGuards(schema);

export const Return = mongoose.model('Return', schema);
