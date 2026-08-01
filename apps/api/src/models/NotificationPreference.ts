import mongoose from 'mongoose';
import {
  NotificationChannel,
  NotificationEvent,
  OPTIONAL_NOTIFICATION_CHANNELS,
} from '@medsupply/shared-types';

/**
 * One document per user. Absent documents resolve to the role defaults in
 * `notificationCatalogue`, so a user never has to save preferences to be
 * notified. IN_APP is not storable here because it cannot be disabled.
 */
const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    defaultChannels: {
      type: [{ type: String, enum: OPTIONAL_NOTIFICATION_CHANNELS }],
      default: undefined,
    },
    overrides: {
      type: [
        {
          _id: false,
          event: { type: String, enum: Object.values(NotificationEvent), required: true },
          channels: [{ type: String, enum: OPTIONAL_NOTIFICATION_CHANNELS }],
        },
      ],
      default: [],
    },
    quietHours: {
      enabled: { type: Boolean, default: false },
      /** Asia/Dhaka local `HH:mm`. */
      start: { type: String, default: '22:00' },
      end: { type: String, default: '07:00' },
    },
    mutedEvents: {
      type: [{ type: String, enum: Object.values(NotificationEvent) }],
      default: [],
    },
  },
  { timestamps: true },
);

export const NotificationPreference = mongoose.model(
  'NotificationPreference',
  notificationPreferenceSchema,
);

export const ALL_OPTIONAL_CHANNELS: NotificationChannel[] = [...OPTIONAL_NOTIFICATION_CHANNELS];
