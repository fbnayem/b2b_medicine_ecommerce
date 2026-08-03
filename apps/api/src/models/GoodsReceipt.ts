import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

const receiptLineSchema = new mongoose.Schema(
  {
    purchaseOrderLineId: { type: mongoose.Schema.Types.ObjectId, required: true },
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicineBatch', required: true },
    batchNumber: { type: String, required: true },
    expiryDate: { type: Date, required: true },
    /** What the order said should arrive. */
    orderedQuantity: { type: Number, required: true, min: 0 },
    /** What actually arrived, counted on the loading bay. */
    receivedQuantity: { type: Number, required: true, min: 1 },
    /**
     * Ordered minus received, at the moment of this receipt.
     *
     * Recorded rather than silently accepted. A short delivery is a
     * conversation with the supplier and, for a controlled line, a question an
     * inspector may ask; a system that quietly books whatever turned up has
     * thrown that information away.
     */
    varianceQuantity: { type: Number, required: true },
    varianceReason: { type: String, trim: true },
    unitCostMinor: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

/**
 * One delivery from a supplier, against a purchase order.
 *
 * `POST /inventory/batches/receive` used to create stock from nothing: a batch
 * number, an expiry and a quantity, with no record of who supplied it or what
 * it was ordered against. That is enough to sell from and not enough to recall
 * from — given a suspect batch, the question "who else has this, and where did
 * we get it" had no answer on the upstream side.
 */
const goodsReceiptSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    purchaseOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
      required: true,
      index: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true,
    },
    /** The supplier's delivery note or invoice number, as printed on the paper. */
    supplierInvoiceReference: { type: String, trim: true },
    receivedAt: { type: Date, required: true, default: () => new Date() },
    lines: { type: [receiptLineSchema], required: true },
    notes: String,
    /** Append-only: a receipt is a record of a physical event and is never edited. */
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

goodsReceiptSchema.index({ 'lines.batchId': 1 });
goodsReceiptSchema.index({ receivedAt: -1 });

applyQueryGuards(goodsReceiptSchema);

export const GoodsReceipt = mongoose.model('GoodsReceipt', goodsReceiptSchema);
