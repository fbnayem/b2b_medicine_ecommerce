import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

const lineSchema = new mongoose.Schema(
  {
    medicineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
      index: true,
    },
    /** Integer minor units, per AGENTS.md. Never a float. */
    unitPriceMinor: { type: Number, required: true, min: 0 },
    /** Percent off that price, for a list that discounts rather than restates. */
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false },
);

/**
 * What a group of customers pays.
 *
 * The whole commercial model was `Medicine.defaultSellingPriceMinor` plus
 * `Shop.defaultDiscount` — one price, one percentage. Real distribution here
 * runs several: a wholesale list, a retail list, a chain's negotiated list.
 * Without them, giving one customer group a different price meant editing every
 * medicine or every shop, and there was no record of what a price *was* when it
 * changed.
 *
 * Deliberately not versioned. `validFrom`/`validTo` express what changed and
 * when, and an order line snapshots the price it was given — so the question
 * "what did this customer pay in March" is answered by the order, which is
 * where it belongs, rather than by reconstructing a list's history.
 */
const priceListSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    description: String,
    /**
     * The list a shop falls back to when it is assigned none.
     *
     * At most one, enforced by the service. Without it, a shop with no list
     * would silently drop to the medicine's own price — which is a decision,
     * and one nobody would have made deliberately.
     */
    isDefault: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },
    validFrom: Date,
    validTo: Date,
    lines: { type: [lineSchema], required: true },
    version: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

priceListSchema.index({ isActive: 1, validFrom: 1, validTo: 1 });

applyQueryGuards(priceListSchema);

export const PriceList = mongoose.model('PriceList', priceListSchema);
