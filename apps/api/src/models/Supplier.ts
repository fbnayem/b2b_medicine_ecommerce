import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

/**
 * Who the goods came from.
 *
 * The system could say where every batch went and never where it came from,
 * which is half a trace. For a DGDA-inspected distributor that half is the one
 * an inspector asks for first: given a batch, name the supplier, the purchase
 * order and the date it was received.
 */
const supplierSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, index: true },
    /** The manufacturer's or importer's own licence, which an inspection checks. */
    drugLicenceNumber: { type: String, trim: true },
    drugLicenceExpiryDate: Date,
    contactName: { type: String, trim: true },
    primaryPhone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    /** Days from invoice to payment, as agreed. Money is settled outside this system. */
    paymentTermsDays: { type: Number, min: 0, default: 30 },
    isActive: { type: Boolean, default: true, index: true },
    notes: String,
    version: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

applyQueryGuards(supplierSchema);

export const Supplier = mongoose.model('Supplier', supplierSchema);
