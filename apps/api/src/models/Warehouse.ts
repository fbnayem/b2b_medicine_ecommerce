import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

/**
 * A place stock is held.
 *
 * `MedicineBatch.warehouseLocation` is free text — "AISLE-A", "Godown 2",
 * whatever somebody typed at goods receipt — so there is no entity, no
 * per-location stock and no way to move anything between two of them. For a
 * one-godown operation that has cost nothing, which is exactly why it survived.
 *
 * This is the foundation and deliberately not the feature. Introducing the
 * entity now, with a default that everything already on hand belongs to, means
 * the second depot is a data change rather than a migration of every batch in
 * the system. `warehouseLocation` keeps working and keeps meaning what it
 * always meant: whereabouts *inside* a warehouse something sits.
 */
const warehouseSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    /** Short code staff actually say out loud: `DHK`, `CTG`. */
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    address: {
      line1: { type: String, trim: true },
      city: { type: String, trim: true },
      district: { type: String, trim: true },
    },
    contactPhone: { type: String, trim: true },
    /**
     * Exactly one, enforced by the service.
     *
     * Everything that does not name a warehouse belongs to this one, which is
     * what lets every existing screen and endpoint carry on unchanged.
     */
    isDefault: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },
    notes: String,
    version: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

applyQueryGuards(warehouseSchema);

export const Warehouse = mongoose.model('Warehouse', warehouseSchema);
