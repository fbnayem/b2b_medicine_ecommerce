import mongoose from 'mongoose';
import {
  ContentLanguage,
  MedicineContentGroup,
  SafetyAdviceTag,
  SafetyAdviceType,
} from '@medsupply/shared-types';

/*
 * One titled passage of a monograph. `_id: false` because a section is never
 * addressed on its own — only ever read as part of its document — and a
 * generated ObjectId on each of 1.38 million subdocuments is 16 MB of identity
 * nothing would ever use.
 */
const sectionSchema = new mongoose.Schema(
  {
    group: { type: String, enum: Object.values(MedicineContentGroup), required: true },
    /** The supplier's own heading. Absent where a group is a single passage. */
    title: { type: String, trim: true },
    /*
     * Deliberately uncapped. The previous import truncated descriptions at
     * 2,000 characters, which silently cut the middle out of monographs; the
     * longest legitimate body in the bundle is 29,431 characters. A cap here
     * is data loss with nobody watching.
     */
    body: { type: String, required: true },
    /*
     * The supplier's publication order across the whole document. The array
     * already preserves it, but a screen that filters to one group — just the
     * safety panel, just the quick tips — still needs to know where each
     * section sat, and a stored ordinal survives any projection or regrouping.
     */
    position: { type: Number, required: true, min: 0 },
    /**
     * `SAFETY` rows only: which of the six questions this row answers, and
     * the supplier's verdict. (`type: { type: … }` is the Mongoose idiom for
     * a field literally named `type`.)
     */
    safety: {
      type: { type: String, enum: Object.values(SafetyAdviceType) },
      tag: { type: String, enum: Object.values(SafetyAdviceTag) },
    },
  },
  { _id: false },
);

/**
 * The supplier's product copy for one medicine in one language — the whole
 * monograph as one document, not one row per section.
 *
 * That shape was chosen with the numbers in hand. Row-per-section would be
 * 1,383,466 documents, and the sibling `MedicineRelation` collection is
 * standing evidence of what that costs: 457 MB of index describing 188 MB of
 * data — more bookkeeping than facts. Meanwhile the read is always the same
 * one: the whole monograph for one product in one language, in display order.
 * That is exactly one document here, found by one unique index, with nothing
 * to sort and nothing to join.
 *
 * Per language rather than a translation map because the supplier ships some
 * products in one language only — 26,896 carry English and 24,554 Bengali —
 * and a missing sibling is a fact for the screen to state, not a fallback for
 * the schema to paper over.
 */
const medicineContentSchema = new mongoose.Schema(
  {
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    lang: { type: String, enum: Object.values(ContentLanguage), required: true },
    sections: { type: [sectionSchema], required: true },
    /** Which export this copy came from, and when it was scraped. */
    source: {
      name: { type: String, trim: true },
      scrapedAt: Date,
    },
  },
  { timestamps: true },
);

medicineContentSchema.index({ medicineId: 1, lang: 1 }, { unique: true });

/*
 * What a drug treats lives in these passages, not on the `Medicine` row — the
 * catalogue's own text index knows brand, generic, manufacturer and SKU, so a
 * pharmacist typing a condition instead of a name found nothing. This index is
 * that search. Titles as well as bodies, because the supplier's headings
 * ("Indications", "Duodenal Ulcer") often name the condition outright.
 */
medicineContentSchema.index({ 'sections.body': 'text', 'sections.title': 'text' });

export const MedicineContent = mongoose.model('MedicineContent', medicineContentSchema);
