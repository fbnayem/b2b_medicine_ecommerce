import mongoose from 'mongoose';
const line = new mongoose.Schema(
  {
    orderItemId: mongoose.Schema.Types.ObjectId,
    medicineId: mongoose.Schema.Types.ObjectId,
    requestedQuantity: Number,
    approvedQuantity: Number,
    unitPriceMinor: Number,
    lineDiscountMinor: Number,
    lineTotalMinor: Number,
    allocations: [{ batchId: mongoose.Schema.Types.ObjectId, quantity: Number }],
  },
  { _id: false },
);
const schema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    decision: {
      type: String,
      enum: ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'],
      required: true,
    },
    lines: [line],
    orderDiscountMinor: { type: Number, default: 0 },
    deliveryChargeMinor: { type: Number, default: 0 },
    subtotalMinor: { type: Number, default: 0 },
    totalMinor: { type: Number, default: 0 },
    internalNotes: String,
    shopOwnerNotes: String,
    reason: String,
    creditOverride: Boolean,
  },
  { timestamps: true },
);
export const OrderApproval = mongoose.model('OrderApproval', schema);
