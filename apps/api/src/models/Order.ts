import mongoose from 'mongoose';
import { OrderStatus, PaymentMethod } from '@medsupply/shared-types';
import { applyQueryGuards } from './queryGuards';

const addressSnapshotSchema = new mongoose.Schema(
  {
    label: String,
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    district: { type: String, required: true },
    postalCode: String,
    isDefault: Boolean,
  },
  { _id: false },
);
const medicineSnapshotSchema = new mongoose.Schema(
  {
    reference: String,
    sku: String,
    brandName: String,
    genericName: String,
    manufacturer: String,
    strength: String,
    dosageForm: String,
    packSize: String,
    unit: String,
  },
  { _id: false },
);
const itemSchema = new mongoose.Schema(
  {
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    medicineSnapshot: { type: medicineSnapshotSchema, required: true },
    requestedQuantity: { type: Number, required: true, min: 1 },
    /**
     * Where the price on this line came from.
     *
     * Snapshotted, like `medicineSnapshot`: a price change next month must not
     * rewrite what was ordered, and a dispute about price is answered from the
     * order rather than by reconstructing a price list's history.
     */
    priceSource: { type: String, trim: true },
    priceListReference: { type: String, trim: true },
    estimatedUnitPriceMinor: { type: Number, required: true, min: 0 },
    estimatedDiscountMinor: { type: Number, required: true, min: 0 },
    estimatedLineTotalMinor: { type: Number, required: true, min: 0 },
    availableStockSnapshot: { type: Number, required: true, min: 0 },
    shopNotes: String,
  },
  { _id: true },
);
const historySchema = new mongoose.Schema(
  {
    from: { type: String, enum: Object.values(OrderStatus) },
    to: { type: String, enum: Object.values(OrderStatus), required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
    note: String,
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    /**
     * Who actually placed this order.
     *
     * The control that makes order-on-behalf safe is **not** that the order
     * looks like the shop placed it — it is that the record says plainly who
     * did. Most volume in this trade arrives by phone or through a rep with a
     * paper book, and an order book that cannot distinguish those from a shop
     * owner tapping their own screen is an order book nobody can audit.
     */
    placedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    placedOnBehalf: { type: Boolean, default: false, index: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [itemSchema], required: true },
    deliveryAddressSnapshot: addressSnapshotSchema,
    contactSnapshot: { name: String, phone: String, email: String },
    requestedPaymentMethod: { type: String, enum: Object.values(PaymentMethod) },
    purchaseOrderReference: String,
    shopNotes: String,
    estimatedSubtotalMinor: { type: Number, required: true, min: 0, default: 0 },
    estimatedDiscountMinor: { type: Number, required: true, min: 0, default: 0 },
    estimatedDeliveryChargeMinor: { type: Number, required: true, min: 0, default: 0 },
    estimatedTotalMinor: { type: Number, required: true, min: 0, default: 0 },
    status: {
      type: String,
      enum: Object.values(OrderStatus),
      default: OrderStatus.DRAFT,
      index: true,
    },
    statusHistory: { type: [historySchema], default: [] },
    submissionIdempotencyKey: { type: String, unique: true, sparse: true },
    cancellationRequestedAt: Date,
    cancellationReason: String,
    /**
     * The decision on that request. A request used to have no answer at all:
     * the endpoint stamped `cancellationRequestedAt`, notified management that
     * the order was cancelled, and stopped — so the shop owner saw a
     * confirmation and the warehouse picked the order anyway.
     */
    cancellationDecision: { type: String, enum: ['APPROVED', 'REFUSED'] },
    cancellationDecisionReason: String,
    cancellationDecidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancellationDecidedAt: Date,
    submittedAt: Date,
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);
orderSchema.index({ shopId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
// The order funnel windows on creation date across every shop.
orderSchema.index({ createdAt: -1 });
applyQueryGuards(orderSchema);

export const Order = mongoose.model('Order', orderSchema);
