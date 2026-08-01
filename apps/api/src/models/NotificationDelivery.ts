import mongoose from 'mongoose';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEvent,
} from '@medsupply/shared-types';

/**
 * One attempt record per recipient/channel/occurrence. This is what makes the
 * queue observable: a job that never ran is still visible as PENDING, and a
 * channel a preference switched off is visible as SUPPRESSED with a reason.
 */
const notificationDeliverySchema = new mongoose.Schema(
  {
    notificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Notification',
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    event: { type: String, enum: Object.values(NotificationEvent), required: true },
    channel: { type: String, enum: Object.values(NotificationChannel), required: true },
    status: {
      type: String,
      enum: Object.values(NotificationDeliveryStatus),
      default: NotificationDeliveryStatus.PENDING,
      index: true,
    },
    attempts: { type: Number, default: 0 },
    /** Populated by the adapter, e.g. an Expo receipt ID or log reference. */
    providerReference: String,
    lastError: String,
    /** Explains SUPPRESSED without needing the preference document. */
    suppressionReason: String,
    sentAt: Date,
    failedAt: Date,
    /** Stable per recipient/channel/occurrence so replays cannot double-send. */
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

notificationDeliverySchema.index({ status: 1, createdAt: -1 });
notificationDeliverySchema.index({ recipientId: 1, channel: 1, createdAt: -1 });

export const NotificationDelivery = mongoose.model(
  'NotificationDelivery',
  notificationDeliverySchema,
);
