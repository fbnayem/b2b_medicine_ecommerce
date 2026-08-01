import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      unique: true,
    },
    fileName: { type: String, required: true },
    mimeType: {
      type: String,
      enum: ['image/jpeg', 'image/png', 'application/pdf'],
      required: true,
    },
    sizeBytes: { type: Number, required: true, min: 1, max: 2_000_000 },
    sha256: { type: String, required: true, index: true },
    data: { type: Buffer, required: true, select: false },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

function immutableAttachment() {
  throw Object.assign(new Error('Payment attachments are immutable'), {
    statusCode: 409,
    code: 'ATTACHMENT_IMMUTABLE',
  });
}

schema.pre('updateOne', immutableAttachment);
schema.pre('updateMany', immutableAttachment);
schema.pre('findOneAndUpdate', immutableAttachment);
schema.pre('replaceOne', immutableAttachment);
schema.pre('deleteOne', immutableAttachment);
schema.pre('deleteMany', immutableAttachment);
schema.pre('findOneAndDelete', immutableAttachment);

export const PaymentAttachment = mongoose.model('PaymentAttachment', schema);
