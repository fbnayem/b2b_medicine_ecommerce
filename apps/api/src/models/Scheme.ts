import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

/**
 * Free goods: "buy 10, get 1".
 *
 * The standard promotional instrument in this trade, and the model could not
 * express it at all — grep for scheme, bonus, free quantity or price list
 * returned nothing. Without it a distributor either cannot run the promotion
 * their supplier is running, or runs it by hand and the books do not show it.
 *
 * The design that keeps this tractable is one sentence: **`quantity` stays the
 * chargeable quantity and `freeQuantity` rides alongside it.** FEFO allocation
 * asks for `quantity + freeQuantity`, so the warehouse picks eleven; the
 * invoice arithmetic is left completely untouched, because it prices
 * `quantity`. The money does not move — only the dispatched count does. That is
 * what makes adding this safe next to a double-entry ledger.
 */
const schemeSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    medicineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
      index: true,
    },
    /** Chargeable units that earn the free ones. */
    buyQuantity: { type: Number, required: true, min: 1 },
    freeQuantity: { type: Number, required: true, min: 1 },
    validFrom: Date,
    validTo: Date,
    /** Empty means every customer; otherwise only these shops. */
    shopIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Shop' }],
    isActive: { type: Boolean, default: true, index: true },
    notes: String,
    version: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

schemeSchema.index({ medicineId: 1, isActive: 1, validFrom: 1, validTo: 1 });

applyQueryGuards(schemeSchema);

export const Scheme = mongoose.model('Scheme', schemeSchema);
