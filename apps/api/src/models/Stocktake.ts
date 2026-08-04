import mongoose from 'mongoose';
import { applyQueryGuards } from './queryGuards';

export const StocktakeStatus = {
  COUNTING: 'COUNTING',
  REVIEW: 'REVIEW',
  POSTED: 'POSTED',
  ABANDONED: 'ABANDONED',
} as const;
export type StocktakeStatus = (typeof StocktakeStatus)[keyof typeof StocktakeStatus];

/**
 * One batch, counted.
 *
 * `systemQuantity` is frozen when the session opens rather than read at posting
 * time. A count is a statement about a moment: if the figure moved while
 * somebody was walking the aisle, the variance the supervisor approved is the
 * one that was actually on the sheet, and the movement in between is a separate
 * fact rather than a silent correction to the count.
 */
const lineSchema = new mongoose.Schema(
  {
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicineBatch',
      required: true,
      index: true,
    },
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    /** What it was called and where it sat when the session opened. */
    snapshot: {
      brandName: String,
      genericName: String,
      strength: String,
      batchNumber: String,
      warehouseLocation: String,
      expiryDate: Date,
    },
    systemQuantity: { type: Number, required: true, min: 0 },
    /**
     * `null` until somebody counts it, which is not the same as zero.
     *
     * A blind count that defaulted to the system figure would post no variance
     * for every shelf nobody visited, and the session would close looking
     * complete. Uncounted lines are reported and never posted.
     */
    countedQuantity: { type: Number, default: null, min: 0 },
    countedAt: Date,
    countedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Required by the service on any line whose count differs from the system. */
    varianceReason: { type: String, trim: true },
  },
  { _id: true },
);

/**
 * A physical stock count.
 *
 * `POST /batches/:id/adjust` corrects one batch at a time with a reason, which
 * is the right tool for "six of these are damaged" and cannot express a
 * stocktake at all: a count is one event covering many batches, approved once,
 * posted once. For an inspected operation it is also a compliance artefact —
 * the document that says what was on the shelf on a given day and who checked.
 *
 * **Blind by construction.** The counter is never shown `systemQuantity`; the
 * variance appears only at review. A count that shows you the answer first is
 * not a count.
 */
const stocktakeSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: Object.values(StocktakeStatus),
      required: true,
      default: StocktakeStatus.COUNTING,
      index: true,
    },
    /** What was counted, recorded so the scope is auditable after the fact. */
    scope: {
      warehouseLocation: { type: String, trim: true },
      medicineIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Medicine' }],
    },
    lines: { type: [lineSchema], required: true },
    notes: String,
    openedAt: { type: Date, required: true, default: () => new Date() },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /**
     * Approving and posting is a separate act from counting, and the model
     * records who did it. A count nobody signed off is not a control.
     */
    postedAt: Date,
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    abandonedAt: Date,
    abandonedReason: { type: String, trim: true },
    /** One key for the whole posting, so a retried approval cannot post twice. */
    postingIdempotencyKey: { type: String, index: true, sparse: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

stocktakeSchema.index({ status: 1, openedAt: -1 });

applyQueryGuards(stocktakeSchema);

export const Stocktake = mongoose.model('Stocktake', stocktakeSchema);
