import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    deliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Delivery',
      required: true,
      index: true,
    },
    purpose: { type: String, enum: ['SIGNATURE', 'PHOTOGRAPH'], required: true },
    fileName: { type: String, required: true },
    mimeType: {
      type: String,
      enum: ['image/jpeg', 'image/png'],
      required: true,
    },
    sizeBytes: { type: Number, required: true, min: 1, max: 2_000_000 },
    sha256: { type: String, required: true, index: true },
    data: { type: Buffer, required: true, select: false },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ deliveryId: 1, purpose: 1 });

export const ProofFile = mongoose.model('ProofFile', schema);
