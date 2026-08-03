import mongoose from 'mongoose';
import { LedgerAccount, LedgerTransactionType } from '@medsupply/shared-types';
import { applyQueryGuards } from './queryGuards';

const entrySchema = new mongoose.Schema(
  {
    account: { type: String, enum: Object.values(LedgerAccount), required: true },
    debitMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    creditMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', index: true },
    deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', index: true },
    type: {
      type: String,
      enum: Object.values(LedgerTransactionType),
      required: true,
      index: true,
    },
    occurredAt: { type: Date, required: true, index: true },
    description: { type: String, required: true },
    entries: { type: [entrySchema], required: true },
    customerBalanceDeltaMinor: { type: Number, required: true, validate: Number.isSafeInteger },
    balanceAfterMinor: { type: Number, required: true, validate: Number.isSafeInteger },
    sourceKey: { type: String, required: true, unique: true },
    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerTransaction' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ shopId: 1, occurredAt: 1, _id: 1 });
// Settlement is derived per invoice from this collection, and the ageing report
// bounds it by date, so the two fields are read together every time.
schema.index({ invoiceId: 1, occurredAt: 1 });

schema.pre('validate', function ensureBalancedTransaction() {
  const totals = this.entries.reduce(
    (result, entry) => ({
      debit: result.debit + entry.debitMinor,
      credit: result.credit + entry.creditMinor,
      invalid:
        result.invalid ||
        (entry.debitMinor === 0 && entry.creditMinor === 0) ||
        (entry.debitMinor > 0 && entry.creditMinor > 0),
    }),
    { debit: 0, credit: 0, invalid: false },
  );
  if (
    totals.invalid ||
    totals.debit !== totals.credit ||
    totals.debit <= 0 ||
    !Number.isSafeInteger(totals.debit)
  ) {
    throw Object.assign(
      new Error('Ledger transaction entries must be safe, positive and balanced'),
      {
        statusCode: 400,
        code: 'UNBALANCED_LEDGER',
      },
    );
  }
});

function appendOnly() {
  throw Object.assign(new Error('Ledger transactions are append-only'), {
    statusCode: 409,
    code: 'LEDGER_APPEND_ONLY',
  });
}

schema.pre('updateOne', appendOnly);
schema.pre('updateMany', appendOnly);
schema.pre('findOneAndUpdate', appendOnly);
schema.pre('replaceOne', appendOnly);
schema.pre('deleteOne', appendOnly);
schema.pre('deleteMany', appendOnly);
schema.pre('findOneAndDelete', appendOnly);

applyQueryGuards(schema);

export const LedgerTransaction = mongoose.model('LedgerTransaction', schema);
