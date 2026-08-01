import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      unique: true,
    },
    packageCount: { type: Number, required: true, min: 1 },
    weightGrams: { type: Number, min: 0 },
    packedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    packedAt: { type: Date, required: true },
    handoverStatus: {
      type: String,
      enum: ['AWAITING_HANDOVER', 'HANDED_OVER', 'RETURNING', 'RETURNED_TO_STORE'],
      default: 'AWAITING_HANDOVER',
      index: true,
    },
    barcode: { type: String, required: true, unique: true },
    notes: String,
  },
  { timestamps: true },
);

export const Package = mongoose.model('Package', schema);
