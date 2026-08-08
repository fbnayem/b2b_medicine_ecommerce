import mongoose from 'mongoose';
import { MedicineRelationKind } from '@medsupply/shared-types';

/*
 * `_id: false`: an item is only ever read as part of its document's list, and
 * a generated ObjectId on every one of ~3.6 million entries would be the
 * row-per-relation overhead sneaking back in through the subdocuments.
 */
const relationItemSchema = new mongoose.Schema(
  {
    toId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    /*
     * The supplier's own ordering, 1 first. Kept because it carries real
     * information — their first suggestion is a better one than their
     * twentieth — and kept as a number rather than trusted to array position,
     * because a reader that filters the list (dropping delisted products, say)
     * still knows how highly the supplier ranked what survived.
     */
    rank: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

/**
 * What the supplier shows beside one catalogue line — one document per
 * (product, kind), holding the whole list, not one row per relation.
 *
 * The row shape was tried first and measured: 1,347,473 rows cost 457 MB of
 * index across three indexes to describe 188 MB of data — more bookkeeping
 * than facts — and importing the complete supplier record, 3,627,168
 * relations, that way would have reached roughly 1.2 GB of index. The same
 * record as arrays is about 224,000 documents under a single index, because
 * the unit of storage now matches the unit of reading: nothing ever asks for
 * one relation, every caller asks for "everything of one kind for one
 * product, in order", and that is one document here.
 *
 * The old unique index on `(fromId, toId, kind)` went with the rows. It
 * existed only so re-running the import could not double the collection; the
 * importer now deletes a product's documents and reinserts them, which is
 * idempotent with nothing to enforce it.
 *
 * Only two of the four kinds used to be stored here, on the argument that the
 * others were derivable by query. The product owner reversed the storage half
 * of that argument — the complete supplier record is kept now, ordering and
 * all — and the whole story lives on `MedicineRelationKind`'s doc comment,
 * including the caution that `PROMOTED` is the supplier's bestseller carousel:
 * advertising, shown as a promotion, never as a clinical match.
 *
 * No timestamps: a document is never edited, only replaced wholesale on
 * import, so `createdAt` and `updatedAt` would both repeat `refreshedAt`
 * under vaguer names.
 */
const medicineRelationSchema = new mongoose.Schema(
  {
    fromId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    kind: { type: String, enum: Object.values(MedicineRelationKind), required: true },
    items: { type: [relationItemSchema], required: true },
    /** Which supplier's export this list came from. */
    source: { type: String, trim: true },
    /** When this answer was last re-imported. */
    refreshedAt: Date,
  },
  { timestamps: false },
);

// The only read this collection serves, and deliberately the only index it
// carries: one kind for one product, the list arriving already in rank order.
medicineRelationSchema.index({ fromId: 1, kind: 1 }, { unique: true });

export const MedicineRelation = mongoose.model('MedicineRelation', medicineRelationSchema);
