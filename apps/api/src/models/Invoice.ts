import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

const money = {
  type: Number,
  required: true,
  min: 0,
  validate: Number.isSafeInteger,
} as const;

const itemSchema = new mongoose.Schema(
  {
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    medicineSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicineBatch', required: true },
    batchNumber: { type: String, required: true },
    expiryDate: { type: Date, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPriceMinor: money,
    discountMinor: money,
    lineTotalMinor: money,
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    version: { type: Number, default: 1, immutable: true },
    status: { type: String, enum: ['ISSUED', 'CANCELLED'], default: 'ISSUED' },
    supplierSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    shopSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    orderSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    billingAddressSnapshot: mongoose.Schema.Types.Mixed,
    deliveryAddressSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    items: { type: [itemSchema], required: true },
    subtotalMinor: money,
    orderDiscountMinor: money,
    deliveryChargeMinor: money,
    taxMinor: money,
    previousBalanceMinor: money,
    grandTotalMinor: money,
    amountPaidMinor: { ...money, default: 0 },
    amountDueMinor: money,
    totalOutstandingMinor: money,
    paymentTermsDays: { type: Number, required: true, min: 0 },
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    footer: String,
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    issuedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

schema.pre('save', function preventIssuedInvoiceMutation() {
  if (!this.isNew && this.status === 'ISSUED' && this.isModified()) {
    throw Object.assign(new Error('Issued invoices are immutable'), {
      statusCode: 409,
      code: 'INVOICE_IMMUTABLE',
    });
  }
});

/**
 * Phase 12 report coverage. Every sales, receivables and overview figure is
 * recomputed from these documents on request, and each of those aggregations
 * begins by matching issued invoices inside a date window. Without these the
 * first stage of every report was a collection scan that grew with turnover.
 */
schema.index({ status: 1, invoiceDate: 1 });
schema.index({ shopId: 1, status: 1, invoiceDate: 1 });
schema.index({ issuedAt: 1 });

applyQueryGuards(schema);

export const Invoice = mongoose.model('Invoice', schema);
