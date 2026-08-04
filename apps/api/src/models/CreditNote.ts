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
