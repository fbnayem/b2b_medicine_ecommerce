import mongoose from 'mongoose';
import { PushPlatform } from '@medsupply/shared-types';

/**
 * Registered Expo push tokens. A token is unique across users: re-registering a
 * device that a second user signs into moves the token instead of fanning a
 * notification out to the previous account.
 */
const pushDeviceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: Object.values(PushPlatform), required: true },
    deviceName: String,
    lastSeenAt: { type: Date, default: () => new Date() },
    /** Set when the provider reports the token is no longer registered. */
    disabledAt: Date,
    disabledReason: String,
  },
  { timestamps: true },
);

pushDeviceSchema.index({ userId: 1, disabledAt: 1 });

export const PushDevice = mongoose.model('PushDevice', pushDeviceSchema);
