import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

const quantitiesSchema = new mongoose.Schema(
  {
    onHand: { type: Number, required: true, min: 0, default: 0 },
    available: { type: Number, required: true, min: 0, default: 0 },
    reserved: { type: Number, required: true, min: 0, default: 0 },
    picking: { type: Number, required: true, min: 0, default: 0 },
    packed: { type: Number, required: true, min: 0, default: 0 },
    damaged: { type: Number, required: true, min: 0, default: 0 },
    expired: { type: Number, required: true, min: 0, default: 0 },
    returned: { type: Number, required: true, min: 0, default: 0 },
    quarantined: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const medicineBatchSchema = new mongoose.Schema(
  {
    medicineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
      index: true,
    },
    batchNumber: { type: String, required: true, uppercase: true, trim: true },
    manufacturingDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true, index: true },
    costPriceMinor: { type: Number, required: true, min: 0 },
    sellingPriceOverrideMinor: { type: Number, min: 0 },
    receivedQuantity: { type: Number, required: true, min: 1 },
    quantities: { type: quantitiesSchema, required: true },
    /** Whereabouts *inside* a warehouse: an aisle, a rack, a cold room. */
    warehouseLocation: { type: String, required: true, trim: true },
    /**
     * Which warehouse, once there is more than one.
     *
     * Absent means the default, which is every batch that predates the
     * warehouse entity. Reading it as "belongs to the default" rather than
     * backfilling means a one-godown operation needed no migration at all, and
     * the second depot is a data change rather than a rewrite of every batch.
     */
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', index: true },

    /**
     * Where this stock came from.
     *
     * **Nullable on purpose.** Every batch received before purchasing existed
     * has none of it, and making these required would invalidate stock
     * physically sitting on the shelf — a migration that turns real inventory
     * into a validation error is not a migration. New stock arrives through a
     * goods receipt and always carries them; `recallService` says plainly when
     * a batch predates the change rather than implying the supplier is unknown
     * for some other reason.
     */
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', index: true },
    purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', index: true },
    goodsReceiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt', index: true },
    /** The supplier's own batch number, when it differs from ours. */
    supplierBatchReference: { type: String, trim: true },
    supplierInvoiceReference: { type: String, trim: true },

    isBlocked: { type: Boolean, default: false, index: true },
    isQuarantined: { type: Boolean, default: false, index: true },
    notes: String,
    version: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

medicineBatchSchema.index({ medicineId: 1, batchNumber: 1 }, { unique: true });
medicineBatchSchema.index({ medicineId: 1, expiryDate: 1, isBlocked: 1, isQuarantined: 1 });

applyQueryGuards(medicineBatchSchema);

export const MedicineBatch = mongoose.model('MedicineBatch', medicineBatchSchema);
