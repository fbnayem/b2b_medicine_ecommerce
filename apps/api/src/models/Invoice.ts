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
// Drives the overdue and ageing reports, which select issued invoices past a
// due date across every shop. Without it those are a collection scan.
schema.index({ status: 1, dueDate: 1 });
schema.index({ shopId: 1, status: 1, dueDate: 1 });
schema.index({ shopId: 1, status: 1, invoiceDate: 1 });
schema.index({ issuedAt: 1 });

/**
 * The index a recall depends on.
 *
 * `items.batchId` has been required and populated on every invoice line since
 * the invoicing phase, and was **indexed by nothing** — so the one query a
 * recall must run, "which invoices contain this batch", was a full collection
 * scan across every invoice ever issued. Nothing performed that query, which is
 * why nobody noticed; a recall is not a query you want to discover is slow on
 * the day you need it.
 */
schema.index({ 'items.batchId': 1 });

applyQueryGuards(schema);

export const Invoice = mongoose.model('Invoice', schema);
