import mongoose from 'mongoose';
import { DeliveryRestriction, MedicineClassification, ProductType } from '@medsupply/shared-types';

/*
 * `_id: false`: an attribute is only ever read with its document, and a
 * generated ObjectId per name–value pair is dead weight across 57,000 rows.
 */
const attributeSchema = new mongoose.Schema(
  { name: { type: String, trim: true }, value: { type: String, trim: true } },
  { _id: false },
);

const medicineSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    barcode: { type: String, unique: true, sparse: true, trim: true },
    /**
     * The shelf. Every row that predates this is a drug, so that is the default
     * and no backfill is needed to make the existing catalogue correct.
     */
    productType: {
      type: String,
      enum: Object.values(ProductType),
      default: ProductType.MEDICINE,
      required: true,
      index: true,
    },
    brandName: { type: String, required: true, trim: true, index: true },
    /*
     * Required on a prescription line, optional elsewhere — enforced in
     * `validateMedicine` rather than here, because Mongoose cannot express
     * "required when `classification` is PRESCRIPTION" without a function that
     * then disagrees with the zod schema. One rule, in the place both the API
     * and the importer already go through.
     */
    genericName: { type: String, trim: true, index: true },
    manufacturer: { type: String, required: true, trim: true, index: true },
    strength: { type: String, trim: true },
    dosageForm: { type: String, trim: true },
    packSize: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, index: true },
    /**
     * The whole shelf trail, outermost first —
     * `['Medicine', 'Antimicrobial', 'Anti-Bacterial', '3Rd Gen Cephalosporins']`.
     *
     * `category` is the leaf and stays the thing screens label a product with.
     * This is what makes "everything under Antimicrobial" a single indexed
     * query instead of a scan, and it is stored on the product rather than
     * modelled as a tree of its own for the same reason the alternatives are
     * derived: a separate `Category` collection would be a second place the
     * hierarchy lives, and the two would drift the first time a product moved.
     *
     * A multi-key index, so `{ categoryPath: 'Antimicrobial' }` matches at any
     * depth without the caller knowing which level that word sits on.
     */
    categoryPath: { type: [String], default: undefined, index: true },
    description: String,
    /**
     * The primary photograph — **a mirror of `productImages[0]`**, not a second
     * source of truth.
     *
     * Kept because a dozen screens, the order-entry picker and both mobile apps
     * already read it, and rewriting all of them to index into an array buys
     * nothing. Every writer sets the two together; nothing else may set one
     * alone.
     */
    productImageUrl: String,
    /**
     * Every photograph of this product, in the order they should be shown.
     *
     * The catalogue held exactly one image per product, so 36,000 photographs
     * in the supplier bundle had nowhere to go — a pharmacy deciding between
     * two similar packs got one angle of each. Up to 16 per product here.
     */
    productImages: { type: [String], default: undefined },
    costPriceMinor: { type: Number, required: true, min: 0 },
    defaultSellingPriceMinor: { type: Number, required: true, min: 0 },
    /**
     * The price printed on the pack.
     *
     * The number every pharmacy in this market reads off the carton, and the
     * one this system could not show — so a shop owner could not be shown their
     * own margin and nothing could be priced off it the way the trade actually
     * prices. Nullable until backfilled: making it required would invalidate
     * every medicine already in the catalogue, which is not a migration.
     *
     * Margin is **derived**, never stored:
     * `round((mrp - trade) * 10_000 / mrp)` in basis points.
     */
    mrpMinor: { type: Number, min: 0 },
    minimumOrderQuantity: { type: Number, required: true, min: 1, default: 1 },
    maximumOrderQuantity: { type: Number, min: 1 },
    classification: { type: String, enum: Object.values(MedicineClassification), required: true },
    coldChain: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    /*
     * Everything from here to `hasSupplierPhoto` is the supplier record:
     * absent on every hand-entered medicine, filled by the importer, never
     * required — and almost none of it indexed. This collection already
     * carries 64 MB of index, so each field here had to argue its way onto
     * the document; only `popularity.ordered` and `tags` argued their way
     * into an index as well.
     */
    /**
     * The supplier's own demand signals — how often their customers ordered,
     * viewed and rated the line. A freshly imported catalogue has no local
     * sales for "best sellers" to draw on, so `ordered` is the default
     * catalogue sort until our own figures exist to take over.
     */
    popularity: {
      ordered: { type: Number, min: 0 },
      viewCount: { type: Number, min: 0 },
      ratingCount: { type: Number, min: 0 },
    },
    /** Name–value pairs as the supplier lists them: "skin type", "country of origin". */
    attributes: { type: [attributeSchema], default: undefined },
    /** The supplier's merchandising tags, verbatim. Indexed: they are a filter. */
    tags: { type: [String], default: undefined, index: true },
    /** One-line summary for cards and search results; `description` stays the long form. */
    shortDescription: { type: String, trim: true },
    /** The supplier's display name with strength and form spelled out. */
    fullName: { type: String, trim: true },
    /*
     * Provenance beyond `externalRef`: the supplier's URL slug and their
     * generic id, so "which page did this row come from" has an answer
     * without opening the source archive.
     */
    sourceSlug: { type: String, trim: true },
    genericId: Number,
    /** The supplier's category ids, joining against the imported category tree. */
    categoryIds: { type: [Number], default: undefined },
    // An enum, not a boolean — the type's own comment explains why.
    deliveryRestriction: { type: String, enum: Object.values(DeliveryRestriction) },
    /**
     * Whether the *supplier* could sell this when their site was scraped —
     * their stock, never ours.
     *
     * This field exists to take a job away from `isActive`. The importer used
     * to set `isActive = (availability === 'in_stock')`, which switched off
     * 24,188 products — 43% of the catalogue — and hid them from every shop
     * owner. Read that slowly: which products a pharmacy could browse was
     * decided by a competitor's warehouse on the day the data was scraped.
     *
     * It no longer does. `isActive` is now derived from whether the line has a
     * price at all, and the supplier's snapshot lives here instead, dated, as
     * the observation it is — still worth keeping, because it hints at what
     * moves in this market. `isActive` means what it says again: whether *we*
     * sell the line.
     */
    listedElsewhere: {
      availability: { type: String, trim: true },
      checkedAt: Date,
    },
    /**
     * False when the supplier's only picture is their grey "no image"
     * graphic — 8,471 of the bundle's 90,764 images are that placeholder.
     * The fact worth keeping is "the supplier has no photograph of this",
     * not the graphic itself, which the importer drops.
     */
    hasSupplierPhoto: Boolean,
    /**
     * Where this row came from, when it came from somewhere else.
     *
     * A catalogue import has to be safe to run twice — the second run must
     * update the same medicine rather than create a duplicate under a new
     * reference — and nothing already on this document can identify a row
     * across runs. `sku` is close but is ours to change; `reference` is
     * allocated by the counter and is therefore different on every run.
     *
     * Absent on anything entered by hand, which is why the index is sparse.
     * Recording the source rather than only the id is deliberate: a second
     * supplier's export will collide on integer ids otherwise, and "which
     * catalogue did this price come from" is a question somebody asks the first
     * time two sources disagree.
     */
    externalRef: {
      source: { type: String, trim: true },
      id: { type: String, trim: true },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

medicineSchema.index({ brandName: 'text', genericName: 'text', manufacturer: 'text', sku: 'text' });

/**
 * "What else do we stock with this active ingredient?"
 *
 * The one question a distributor is asked every time something is out of stock,
 * and the reason no table of "alternative products" exists in this system: two
 * medicines are alternatives when they share an active ingredient, which the
 * row already says. A stored list would be a snapshot that starts rotting the
 * first time a line is delisted.
 *
 * Case-insensitive by collation rather than by lowercasing into a second
 * column. `strength: 2` compares base letters only, so a hand-typed
 * `paracetamol` finds `Paracetamol` — and the alternative, storing a normalised
 * copy alongside the real one, is two fields that can disagree.
 *
 * A query must pass the *same* collation to use this index; `alternativesFor`
 * is the only caller and does.
 */
medicineSchema.index({ genericName: 1, isActive: 1 }, { collation: { locale: 'en', strength: 2 } });
medicineSchema.index(
  { 'externalRef.source': 1, 'externalRef.id': 1 },
  { unique: true, sparse: true },
);
/*
 * The index behind `?sort=popular` — "what sells first" — descending because
 * that is the direction every screen reads it in. It is not the default: the
 * catalogue still opens alphabetically, and a caller has to ask for this one.
 *
 * The only index the supplier record gets besides `tags`; the rest of those
 * fields ride along unindexed on a collection already carrying 64 MB of index.
 */
medicineSchema.index({ 'popularity.ordered': -1 });

export const Medicine = mongoose.model('Medicine', medicineSchema);
