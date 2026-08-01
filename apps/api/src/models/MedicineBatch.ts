import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

const quantitiesSchema = new mongoose.Schema(
  {
    onHand: { type: Number, required: true, min: 0, default: 0 },
    available: { type: Number, required: true, min: 0, default: 0 },
    reserved: { type: Number, required: true, min: 0, default: 0 },
    picking: { type: Number, required: true, min: 0, default: 0 },
    packed: { type: Number, required: true, min: 0, default: 0 },
    damaged: { type: Number, required: true, min: 0, default: 0 },
    expired: { type: Number, required: true, min: 0, default: 0 },
    returned: { type: Number, required: true, min: 0, default: 0 },
    quarantined: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const medicineBatchSchema = new mongoose.Schema(
  {
    medicineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
      index: true,
    },
    batchNumber: { type: String, required: true, uppercase: true, trim: true },
    manufacturingDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true, index: true },
    costPriceMinor: { type: Number, required: true, min: 0 },
    sellingPriceOverrideMinor: { type: Number, min: 0 },
    receivedQuantity: { type: Number, required: true, min: 1 },
    quantities: { type: quantitiesSchema, required: true },
    warehouseLocation: { type: String, required: true, trim: true },
    isBlocked: { type: Boolean, default: false, index: true },
    isQuarantined: { type: Boolean, default: false, index: true },
    notes: String,
    version: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

medicineBatchSchema.index({ medicineId: 1, batchNumber: 1 }, { unique: true });
medicineBatchSchema.index({ medicineId: 1, expiryDate: 1, isBlocked: 1, isQuarantined: 1 });

applyQueryGuards(medicineBatchSchema);

export const MedicineBatch = mongoose.model('MedicineBatch', medicineBatchSchema);
