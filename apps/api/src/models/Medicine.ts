import mongoose from 'mongoose';
import { MedicineClassification } from '@medsupply/shared-types';

const medicineSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    barcode: { type: String, unique: true, sparse: true, trim: true },
    brandName: { type: String, required: true, trim: true, index: true },
    genericName: { type: String, required: true, trim: true, index: true },
    manufacturer: { type: String, required: true, trim: true, index: true },
    strength: { type: String, required: true, trim: true },
    dosageForm: { type: String, required: true, trim: true },
    packSize: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, index: true },
    description: String,
    productImageUrl: String,
    costPriceMinor: { type: Number, required: true, min: 0 },
    defaultSellingPriceMinor: { type: Number, required: true, min: 0 },
    /**
     * The price printed on the pack.
     *
     * The number every pharmacy in this market reads off the carton, and the
     * one this system could not show — so a shop owner could not be shown their
     * own margin and nothing could be priced off it the way the trade actually
     * prices. Nullable until backfilled: making it required would invalidate
     * every medicine already in the catalogue, which is not a migration.
     *
     * Margin is **derived**, never stored:
     * `round((mrp - trade) * 10_000 / mrp)` in basis points.
     */
    mrpMinor: { type: Number, min: 0 },
    minimumOrderQuantity: { type: Number, required: true, min: 1, default: 1 },
    maximumOrderQuantity: { type: Number, min: 1 },
    classification: { type: String, enum: Object.values(MedicineClassification), required: true },
    coldChain: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

medicineSchema.index({ brandName: 'text', genericName: 'text', manufacturer: 'text', sku: 'text' });

export const Medicine = mongoose.model('Medicine', medicineSchema);
