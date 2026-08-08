import mongoose from 'mongoose';

/**
 * The supplier's record, whole — one document per source product.
 *
 * Nothing in the application reads this collection, and that is the point.
 * The importer makes hundreds of mapping decisions — which fields to keep,
 * how to flatten a monograph, what counts as a placeholder image, how a tag
 * with spaces becomes an enum — and every one of them is a place information
 * could be lost or misread. With the complete nested record archived here,
 * each of those decisions is reversible with a migration instead of a re-scrape
 * of the 12 GB bundle, and "we lost no information" becomes a claim a test can
 * check rather than a promise: `digest` is the sha256 of the source bytes, so
 * verifying the archive means comparing hashes, not trusting the archiver.
 *
 * `raw` is `products.raw_json` parsed — the supplier's own nested document,
 * untouched. `aux` carries the sibling tables the source keeps outside that
 * JSON: images, SEO prose, FAQs, the relations the supplier computed, and
 * their category rows for this product.
 *
 * The zstd block compression in the schema options is what makes this
 * affordable. The raw JSON alone is 3.1 GB; it compresses ~6x with gzip and
 * ~24x with brotli when whole blocks are compressed together, which is exactly
 * how WiredTiger applies a block compressor — so the archive costs a few
 * hundred megabytes of disk. Without compression it costs several gigabytes
 * and would not have been worth keeping. Note that `collectionOptions` only
 * takes effect when the collection is *created*; an existing uncompressed
 * collection must be dropped and re-imported, not altered in place.
 */
const catalogueSourceRecordSchema = new mongoose.Schema(
  {
    source: { type: String, required: true, default: 'AROGGA', trim: true },
    sourceId: { type: String, required: true, trim: true },
    scrapedAt: { type: Date, required: true },
    /** sha256 of the source bytes — the losslessness check anchors on this. */
    digest: { type: String, required: true },
    /**
     * The supplier's nested record, parsed. Absent only when it would not
     * parse, in which case `rawText` carries the bytes instead — exactly one
     * of the two is always present.
     */
    raw: { type: mongoose.Schema.Types.Mixed },
    /**
     * The source bytes verbatim, kept when `raw_json` is not valid JSON.
     *
     * The importer used to `continue` past an unparseable row, which skipped
     * the archive write while the reconciliation had *already* counted that
     * product as "imported into the catalogue (and archived)" — so the one
     * gate whose entire job is to prove nothing was lost would have balanced
     * while losing the record. No row in the present bundle fails to parse, so
     * this is a hole in the gate rather than a loss that happened; it is
     * plugged because the next bundle is the one that finds it.
     */
    rawText: { type: String },
    aux: {
      images: { type: [mongoose.Schema.Types.Mixed], default: undefined },
      seoSections: { type: [mongoose.Schema.Types.Mixed], default: undefined },
      faq: { type: [mongoose.Schema.Types.Mixed], default: undefined },
      computedRelations: { type: [mongoose.Schema.Types.Mixed], default: undefined },
      categories: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    },
  },
  {
    timestamps: true,
    collectionOptions: {
      storageEngine: { wiredTiger: { configString: 'block_compressor=zstd' } },
    },
  },
);

// The one lookup this collection ever serves: "the archived record behind this
// imported product". Unique, because a second archive of the same product is a
// re-import that should have replaced the first.
catalogueSourceRecordSchema.index({ source: 1, sourceId: 1 }, { unique: true });

export const CatalogueSourceRecord = mongoose.model(
  'CatalogueSourceRecord',
  catalogueSourceRecordSchema,
);
