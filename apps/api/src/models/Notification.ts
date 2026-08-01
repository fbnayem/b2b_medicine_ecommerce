import mongoose from 'mongoose';
import {
  NotificationCategory,
  NotificationEvent,
  NotificationPriority,
} from '@medsupply/shared-types';

/**
 * The in-app notification is the durable record of every notification event.
 * Optional channels (email, SMS, push, WhatsApp) are attempts recorded against
 * this document in `notificationdeliveries`; they never replace it.
 *
 * Records written before Phase 9 carry only `type`, so `event`, `category` and
 * `priority` are optional and backfilled by the Phase 9 migration.
 */
const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Historical field kept as the human-readable event key. */
    type: { type: String, required: true },
    event: { type: String, enum: Object.values(NotificationEvent) },
    category: { type: String, enum: Object.values(NotificationCategory) },
    priority: { type: String, enum: Object.values(NotificationPriority) },
    title: { type: String, required: true },
    body: { type: String, required: true },
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId,
    link: String,
    metadata: { type: mongoose.Schema.Types.Mixed },
    readAt: Date,
    archivedAt: Date,
    correlationId: String,
    /** Suppresses duplicate notifications for one recipient and one occurrence. */
    dedupeKey: String,
  },
  { timestamps: true },
);

notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, category: 1, createdAt: -1 });
notificationSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
notificationSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

export const Notification = mongoose.model('Notification', notificationSchema);
