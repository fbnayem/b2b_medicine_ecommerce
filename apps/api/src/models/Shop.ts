import mongoose from 'mongoose';
import { ShopStatus } from '@medsupply/shared-types';

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    district: { type: String, required: true },
    postalCode: String,
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const shopSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true }, // Auto-generated e.g. SHP-2026-000001
    name: { type: String, required: true },
    ownerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    primaryPhone: { type: String, required: true, unique: true },
    alternativePhone: String,
    email: String,
    territory: String,
    billingAddress: addressSchema,
    deliveryAddresses: [addressSchema],
    drugLicenceNumber: { type: String, sparse: true },
    drugLicenceIssueDate: Date,
    drugLicenceExpiryDate: Date,
    tradeLicenceNumber: String,
    creditLimit: { type: Number, default: 0 }, // stored in paisa (minor units)
    outstandingBalance: { type: Number, default: 0 },
    reservedCreditMinor: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    paymentTermsDays: { type: Number, default: 30 },
    defaultDiscount: { type: Number, default: 0 }, // percent
    status: {
      type: String,
      enum: Object.values(ShopStatus),
      default: ShopStatus.PENDING,
    },
    orderBlockingReason: String,
    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Auto-generate shop reference before save (Mongoose 9: return promise, no next() call)
shopSchema.pre('save', async function () {
  if (!this.reference) {
    const year = new Date().getFullYear();
    const count = await Shop.countDocuments();
    this.reference = `SHP-${year}-${String(count + 1).padStart(6, '0')}`;
  }
});

export const Shop = mongoose.model('Shop', shopSchema);
