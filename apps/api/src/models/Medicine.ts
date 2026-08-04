import mongoose from 'mongoose';
import { MedicineClassification, ProductType } from '@medsupply/shared-types';

const medicineSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    barcode: { type: String, unique: true, sparse: true, trim: true },
    /**
     * The shelf. Every row that predates this is a drug, so that is the default
     * and no backfill is needed to make the existing catalogue correct.
     */
    productType: {
      type: String,
      enum: Object.values(ProductType),
      default: ProductType.MEDICINE,
      required: true,
      index: true,
    },
    brandName: { type: String, required: true, trim: true, index: true },
    /*
     * Required on a prescription line, optional elsewhere — enforced in
     * `validateMedicine` rather than here, because Mongoose cannot express
     * "required when `classification` is PRESCRIPTION" without a function that
     * then disagrees with the zod schema. One rule, in the place both the API
     * and the importer already go through.
     */
    genericName: { type: String, trim: true, index: true },
    manufacturer: { type: String, required: true, trim: true, index: true },
    strength: { type: String, trim: true },
    dosageForm: { type: String, trim: true },
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
    /**
     * Where this row came from, when it came from somewhere else.
     *
     * A catalogue import has to be safe to run twice — the second run must
     * update the same medicine rather than create a duplicate under a new
     * reference — and nothing already on this document can identify a row
     * across runs. `sku` is close but is ours to change; `reference` is
     * allocated by the counter and is therefore different on every run.
     *
     * Absent on anything entered by hand, which is why the index is sparse.
     * Recording the source rather than only the id is deliberate: a second
     * supplier's export will collide on integer ids otherwise, and "which
     * catalogue did this price come from" is a question somebody asks the first
     * time two sources disagree.
     */
    externalRef: {
      source: { type: String, trim: true },
      id: { type: String, trim: true },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

medicineSchema.index({ brandName: 'text', genericName: 'text', manufacturer: 'text', sku: 'text' });
medicineSchema.index(
  { 'externalRef.source': 1, 'externalRef.id': 1 },
  { unique: true, sparse: true },
);

export const Medicine = mongoose.model('Medicine', medicineSchema);
