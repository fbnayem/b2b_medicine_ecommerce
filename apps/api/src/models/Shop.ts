import mongoose from 'mongoose';
import { ShopStatus } from '@medsupply/shared-types';
import { nextReference } from './Counter';

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
    /**
     * The list this customer is priced from.
     *
     * Null falls through to whichever list is marked the default, and then to
     * the medicine's own price — the precedence `pricingService` documents.
     */
    priceListId: { type: mongoose.Schema.Types.ObjectId, ref: 'PriceList', default: null },
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

/**
 * Auto-generate the shop reference before save (Mongoose 9: return a promise,
 * no `next()` call).
 *
 * This used to be `SHP-${new Date().getFullYear()}-${countDocuments() + 1}`,
 * which was the only reference in the system not produced by `nextReference`,
 * and was wrong in three ways. Counting documents is not atomic, so two shops
 * created at the same moment computed the same number and one save failed on
 * the unique index. A deleted shop made the count repeat a number already
 * issued. And the sequence never reset per year, so the year in the reference
 * and the number beside it disagreed about what they were counting.
 */
shopSchema.pre('save', async function () {
  if (!this.reference) {
    this.reference = await nextReference('SHP');
  }
});

export const Shop = mongoose.model('Shop', shopSchema);
