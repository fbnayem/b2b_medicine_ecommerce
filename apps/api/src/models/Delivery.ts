import mongoose from 'mongoose';
import {
  DeliveryFailureReason,
  DeliveryPriority,
  DeliveryProofType,
  DeliveryStatus,
  PaymentMethod,
  UserRole,
} from '@medsupply/shared-types';
import { applyQueryGuards } from './queryGuards';

const historySchema = new mongoose.Schema(
  {
    from: { type: String, enum: Object.values(DeliveryStatus) },
    to: { type: String, enum: Object.values(DeliveryStatus), required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, enum: Object.values(UserRole), required: true },
    at: { type: Date, required: true },
    note: String,
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Package',
      required: true,
      unique: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      unique: true,
    },
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    addressSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    contactSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: Object.values(DeliveryStatus),
      default: DeliveryStatus.READY_FOR_ASSIGNMENT,
      index: true,
    },
    priority: {
      type: String,
      enum: Object.values(DeliveryPriority),
      default: DeliveryPriority.NORMAL,
      index: true,
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedAt: Date,
    expectedDeliveryDate: Date,
    instructions: String,
    proofRequirements: {
      type: [{ type: String, enum: Object.values(DeliveryProofType) }],
      default: [DeliveryProofType.OTP],
      required: true,
    },
    handover: {
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      confirmedAt: Date,
      packageReference: String,
      invoiceReference: String,
      packageCount: Number,
      acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      acknowledgedAt: Date,
    },
    pickupAt: Date,
    outForDeliveryAt: Date,
    arrivedAt: Date,
    otpHash: { type: String, select: false },
    otpExpiresAt: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    otpSentAt: Date,
    proof: {
      receiverName: String,
      receiverPhone: String,
      otpVerifiedAt: Date,
      signatureFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProofFile' },
      photoFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProofFile' },
      gps: {
        latitude: Number,
        longitude: Number,
        accuracyMetres: Number,
        capturedAt: Date,
      },
      notes: String,
      deliveredPackageCount: Number,
      deliveredAt: Date,
    },
    paymentCollection: {
      amountMinor: { type: Number, min: 0, validate: Number.isSafeInteger, default: 0 },
      method: {
        type: String,
        enum: [
          PaymentMethod.CASH,
          PaymentMethod.BANK_TRANSFER,
          PaymentMethod.MOBILE_FINANCIAL_SERVICE,
          PaymentMethod.CHEQUE,
          PaymentMethod.OTHER,
          'MOBILE_BANKING',
        ],
      },
      transactionReference: String,
      status: {
        type: String,
        enum: ['NO_COLLECTION', 'PENDING_POSTING', 'POSTED', 'FAILED', 'REVERSED'],
        default: 'NO_COLLECTION',
      },
      paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
      paymentReference: String,
    },
    failure: {
      reason: { type: String, enum: Object.values(DeliveryFailureReason) },
      notes: String,
      reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reportedAt: Date,
    },
    returnedAt: Date,
    returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    history: { type: [historySchema], default: [] },
    processedActionKeys: { type: [String], default: [], select: false },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ status: 1, priority: -1, createdAt: 1 });
schema.index({ assignedTo: 1, status: 1, expectedDeliveryDate: 1 });
// Delivery performance recomputes over a creation-date window.
schema.index({ createdAt: -1 });
schema.index({ shopId: 1, createdAt: -1 });

applyQueryGuards(schema);

export const Delivery = mongoose.model('Delivery', schema);
