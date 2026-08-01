import mongoose from 'mongoose';
import { StockMovementType } from '@medsupply/shared-types';
import { applyQueryGuards } from './queryGuards';

const stockMovementSchema = new mongoose.Schema(
  {
    medicineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
      index: true,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicineBatch',
      required: true,
      index: true,
    },
    type: { type: String, enum: Object.values(StockMovementType), required: true, index: true },
    quantity: { type: Number, required: true },
    before: { type: mongoose.Schema.Types.Mixed, required: true },
    after: { type: mongoose.Schema.Types.Mixed, required: true },
    reason: { type: String, required: true },
    referenceType: String,
    referenceId: String,
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    correlationId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

stockMovementSchema.index({ medicineId: 1, createdAt: -1 });
stockMovementSchema.index({ batchId: 1, createdAt: -1 });

// The movement summary and the history view both order by time; the history
// view additionally narrows by type.
stockMovementSchema.index({ createdAt: -1 });
stockMovementSchema.index({ type: 1, createdAt: -1 });

applyQueryGuards(stockMovementSchema);

export const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
