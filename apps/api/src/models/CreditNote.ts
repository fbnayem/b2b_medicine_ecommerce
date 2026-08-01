import mongoose from 'mongoose';

const money = {
  type: Number,
  required: true,
  min: 0,
  default: 0,
  validate: Number.isSafeInteger,
} as const;

const lineSchema = new mongoose.Schema(
  {
    medicineSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    batchNumber: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceMinor: money,
    discountMinor: money,
    lineTotalMinor: money,
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    /** One credit note per return; a second credit would double-refund. */
    returnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Return', required: true, unique: true },
    returnReference: { type: String, required: true },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true,
    },
    invoiceReference: { type: String, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    /** Identity snapshots, so a later settings change never rewrites an issued document. */
    supplierSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    shopSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    lines: { type: [lineSchema], required: true },
    subtotalMinor: money,
    taxMinor: money,
    totalMinor: money,
    ledgerTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerTransaction' },
    notes: String,
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    issuedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.pre('save', function preventCreditNoteMutation() {
  // A credit note carries a posted ledger entry; correcting one means issuing a
  // balancing adjustment, never editing the original.
  if (!this.isNew && this.isModified()) {
    throw Object.assign(new Error('Issued credit notes are immutable'), {
      statusCode: 409,
      code: 'CREDIT_NOTE_IMMUTABLE',
    });
  }
});

export const CreditNote = mongoose.model('CreditNote', schema);
