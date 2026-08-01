import mongoose from 'mongoose';
import { SettingsGroup } from '@medsupply/shared-types';

/**
 * One document per settings group rather than a single blob. A group is the
 * unit an administrator edits, the unit that is audited, and the unit that
 * carries its own version, so two administrators editing unrelated groups do
 * not collide. A group with no document falls back to the environment and then
 * to the code default, which is why an upgraded deployment keeps working before
 * anyone opens the settings screen.
 */
const systemSettingSchema = new mongoose.Schema(
  {
    group: {
      type: String,
      enum: Object.values(SettingsGroup),
      required: true,
      unique: true,
      immutable: true,
    },
    values: { type: mongoose.Schema.Types.Mixed, required: true },
    /** Incremented on every save; a stale version is rejected. */
    version: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false },
);

export const SystemSetting = mongoose.model('SystemSetting', systemSettingSchema);
