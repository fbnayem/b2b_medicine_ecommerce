import mongoose from 'mongoose';

const discrepancySchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicineBatch' },
    quantity: { type: Number, required: true, min: 0 },
    notes: { type: String, required: true },
    status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN' },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportedAt: { type: Date, required: true },
    resolutionNotes: String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
  },
  { _id: true },
);

const schema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    approvalId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderApproval', required: true },
    status: {
      type: String,
      enum: ['PENDING', 'PICKING', 'PAUSED', 'PACKING', 'BLOCKED_DISCREPANCY', 'PACKED'],
      default: 'PENDING',
      index: true,
    },
    blockedFromStatus: {
      type: String,
      enum: ['PICKING', 'PAUSED', 'PACKING'],
    },
    version: { type: Number, default: 0 },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    startedAt: Date,
    completedAt: Date,
    items: [
      {
        medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
        batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicineBatch', required: true },
        quantity: { type: Number, required: true, min: 0 },
        pickedQuantity: { type: Number, default: 0, min: 0 },
        packedQuantity: { type: Number, default: 0, min: 0 },
        shortfallReason: String,
      },
    ],
    discrepancies: [discrepancySchema],
  },
  { timestamps: true },
);

export const PickingList = mongoose.model('PickingList', schema);
