import mongoose from 'mongoose';
import { ActivityEntityType, NotificationCategory, UserRole } from '@medsupply/shared-types';

/**
 * Append-only, user-facing activity stream. AuditLog stays the forensic record
 * (before/after values, IP, user agent); ActivityEvent is the readable timeline
 * with explicit visibility, so a Shop Owner timeline can never leak an internal
 * note by accident.
 *
 * `orderId` and `shopId` are denormalised cross-links so an order timeline can
 * absorb the delivery, invoice and payment events that belong to it without a
 * fan-out query per entity.
 */
const activityEventSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    category: {
      type: String,
      enum: Object.values(NotificationCategory),
      required: true,
    },
    entityType: {
      type: String,
      enum: Object.values(ActivityEntityType),
      required: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Snapshot so a renamed or deactivated user does not rewrite history. */
    actorName: String,
    actorRole: { type: String, enum: Object.values(UserRole) },
    summary: { type: String, required: true },
    detail: String,
    metadata: { type: mongoose.Schema.Types.Mixed },
    visibleToRoles: {
      type: [{ type: String, enum: Object.values(UserRole) }],
      required: true,
    },
    visibleToShop: { type: Boolean, default: false },
    correlationId: String,
    occurredAt: { type: Date, required: true, default: () => new Date() },
    /** Stable per occurrence so replays and backfills cannot duplicate history. */
    dedupeKey: { type: String, required: true, unique: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activityEventSchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });
activityEventSchema.index({ orderId: 1, occurredAt: -1 });
activityEventSchema.index({ shopId: 1, occurredAt: -1 });
activityEventSchema.index({ category: 1, occurredAt: -1 });
activityEventSchema.index({ occurredAt: -1 });

export const ActivityEvent = mongoose.model('ActivityEvent', activityEventSchema);
