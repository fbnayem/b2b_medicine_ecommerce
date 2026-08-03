import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

export const PurchaseOrderStatus = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseOrderStatus = (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

const lineSchema = new mongoose.Schema(
  {
    medicineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
      index: true,
    },
    /** What the medicine was called when this order was placed. */
    medicineSnapshot: {
      reference: String,
      sku: String,
      brandName: String,
      genericName: String,
      strength: String,
    },
    orderedQuantity: { type: Number, required: true, min: 1 },
    /**
     * Running total of what has actually arrived.
     *
     * Kept on the line rather than derived, because a receipt is what advances
     * it and the two must move in the same transaction: a derived figure could
     * disagree with the receipts for as long as it took somebody to notice.
     */
    receivedQuantity: { type: Number, required: true, min: 0, default: 0 },
    /** Integer minor units, per AGENTS.md. Never a float. */
    unitCostMinor: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(PurchaseOrderStatus),
      required: true,
      default: PurchaseOrderStatus.DRAFT,
      index: true,
    },
    lines: { type: [lineSchema], required: true },
    expectedDate: Date,
    /** The supplier's own reference, so a paper invoice can be matched to this. */
    supplierReference: { type: String, trim: true },
    notes: String,
    issuedAt: Date,
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    version: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

purchaseOrderSchema.index({ supplierId: 1, createdAt: -1 });
purchaseOrderSchema.index({ status: 1, expectedDate: 1 });

applyQueryGuards(purchaseOrderSchema);

export const PurchaseOrder = mongoose.model('PurchaseOrder', purchaseOrderSchema);
