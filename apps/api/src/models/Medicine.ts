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
