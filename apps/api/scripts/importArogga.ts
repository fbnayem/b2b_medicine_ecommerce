import 'dotenv/config';
import { createHash } from 'node:crypto';
import { resolve, join, dirname, basename } from 'node:path';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import mongoose from 'mongoose';
import {
  ContentLanguage,
  DeliveryRestriction,
  MedicineClassification,
  MedicineContentGroup,
  MedicineRelationKind,
  ProductType,
  SafetyAdviceTag,
  SafetyAdviceType,
  UserRole,
} from '@medsupply/shared-types';
import { CreateMedicineSchema } from '@medsupply/validation';
import { env } from '../src/env';
import { MEDIA_PREFIX, mediaRoot } from '../src/middlewares/media';
import { CatalogueSourceRecord } from '../src/models/CatalogueSourceRecord';
import { Medicine } from '../src/models/Medicine';
import { MedicineContent } from '../src/models/MedicineContent';
import { MedicineRelation } from '../src/models/MedicineRelation';
import { User } from '../src/models/User';
import { reserveReferences } from '../src/models/Counter';

/**
 * Imports a product catalogue exported from Arogga into the medicine catalogue.
 *
 * **Dry run unless `--apply` is passed.** A catalogue import is the kind of
 * thing that is obvious in hindsight and expensive at the time, so the default
 * is to print exactly what would happen and change nothing.
 *
 * Three decisions are worth reading before running it.
 *
 * **Every row goes through `CreateMedicineSchema` before it is written.** The
 * importer is not allowed to put anything into the catalogue that the API would
 * refuse from a person — including `tradePriceExceedsMrp`, which is the rule
 * that stops a trade price being recorded above the price printed on the pack,
 * and the rule that a prescription line must name its active ingredient. That
 * is also what produces the skip reasons: nothing is rejected by a hand-written
 * rule in here, so a row this importer accepts is one somebody could have typed
 * into the catalogue form, and a row it refuses is one the form would refuse
 * too.
 *
 * **`externalRef` makes it idempotent.** The upsert key is
 * `{source: 'AROGGA', id: product_id}`, not the reference or the SKU, so a
 * second run updates rather than duplicates. Re-running after a price change is
 * the ordinary case; re-running by accident is the one that must be harmless.
 *
 * **Their photography and their copy come in, on the operator's authority.**
 * The export's image pipeline exists to remove Arogga's watermark and the logo
 * burned into some artwork, and the descriptions are their marketing and
 * monograph text — so whether to publish either is a rights question rather
 * than a mapping one, and it was answered deliberately rather than by default.
 * `--no-images` and `--no-descriptions` turn each off again. Whatever is
 * imported keeps `externalRef` recording where it came from, and any image
 * where logo removal left a residue is listed for review rather than trusted.
 *
 * **The complete source record is archived before any of the above applies.**
 * Every one of the 57,033 products — including the ~1,000 the catalogue itself
 * refuses — lands in `CatalogueSourceRecord` as the supplier's own nested JSON
 * plus the sibling table rows that JSON does not contain, with a sha256 of the
 * source bytes. Every mapping decision below is therefore reversible with a
 * migration instead of a re-scrape of the 12 GB bundle, and the run ends with a
 * reconciliation table accounting for every row of every source table, because
 * "we lost nothing" should be a printed number, not a belief.
 *
 * Two things still need a person after this runs: `meta_title` and
 * `meta_description` in the source name Arogga outright and are deliberately
 * not imported, and the monograph — now imported whole into `MedicineContent`,
 * in both languages — is still the supplier's clinical text, which is why every
 * screen that shows it carries the provenance line rather than presenting it as
 * this business's own advice.
 */

// ─── What the export gives us ────────────────────────────────────────────────

interface SourceProduct {
  product_id: number;
  name: string;
  full_name: string | null;
  slug: string | null;
  type: string;
  form: string | null;
  strength: string | null;
  generic_id: number | null;
  generic_name: string | null;
  brand_name: string | null;
  manufacturer: string | null;
  rx_required: number;
  cold_chain: number;
  dhaka_only: number;
  availability: string;
  category_path: string | null;
  mrp: number | null;
  price: number | null;
  view_count: number | null;
  rating_count: number | null;
  tags: string | null;
  short_description: string | null;
  url: string | null;
  scraped_at: string;
}

interface SourceVariant {
  product_id: number;
  sku: string | null;
  price: number | null;
  mrp: number | null;
  b2b_price: number | null;
  b2b_mrp: number | null;
  min_qty: number | null;
  max_qty: number | null;
  base_unit: string | null;
  sales_unit: string | null;
  units_per_pack: number | null;
  ordered: number | null;
  viewed: number | null;
  attributes: string | null;
}

interface SourceImage {
  product_id: number;
  position: number;
  local_path: string | null;
  is_placeholder: number;
  logo_removed: number;
  logo_residual: number;
  /** How sure the remover was that what it left behind is a mark. */
  logo_confidence: number | null;
}

/**
 * Residue flags a person has looked at, with what they saw.
 *
 * The detector answers "is there still a logo here", and it cannot answer the
 * question that matters — **whose**. Stripping a reseller's watermark is the
 * point of the step; stripping the manufacturer's trademark off their own tube
 * would misrepresent the product. So a flag is a request for eyes, and this is
 * where the eyes are recorded.
 *
 * Keyed by the file, whose name carries the product id and a content hash, so a
 * re-scrape that changes the photograph raises the question again rather than
 * inheriting an answer about a different image. The list may only shrink: an
 * entry whose flag has gone is reported as stale.
 */
const LOGO_RESIDUE_REVIEWED: Record<string, string> = {
  'images\\91652\\himalaya-men-power-bright-licorice-face-wash-50ml-5-a41909af79-clean.webp':
    'Looked at 08 Aug 2026. The residue is the Himalaya wordmark and "SINCE 1930" — the ' +
    "manufacturer's own trademark on their own packaging, which belongs on a photograph of " +
    "that packaging. Nothing of Arogga's survives. It is image 5 of 5, a marketing banner " +
    'showing three products rather than a photograph of this one, so it is not the picture on ' +
    'the card; the primary is image 1. Kept.',
};

// ─── Money ───────────────────────────────────────────────────────────────────

/**
 * Taka as integer poisha.
 *
 * The export stores money as a float, which is exactly the representation this
 * system refuses to do arithmetic in. `Math.round` rather than a truncating
 * cast is the whole point: `684.20 * 100` is `68420.00000000001` in IEEE-754,
 * and `| 0` on that is 68419 — one poisha lost, silently, on any price that
 * happens to land badly.
 */
function toMinor(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) return undefined;
  return Math.round(value * 100);
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

/**
 * A source field, or nothing.
 *
 * The export writes a literal `-` where it means "not applicable" — 5 products
 * carry it as their dosage form. Passed straight through it is a one-character
 * string, which the schema refuses for being too short, and the refusal reads as
 * though the data were malformed rather than absent. It is absent.
 */
function clean(value: string | null | undefined): string | undefined {
  const text = (value ?? '').trim();
  if (!text || text === '-' || text === '--' || text === 'N/A') return undefined;
  return text;
}

/**
 * Every reshaping this importer does to make a row fit, counted.
 *
 * A row that arrives changed and is never mentioned is the same problem as a
 * row that is dropped and never mentioned. The summary prints these, so
 * "55,998 imported" is not read as "55,998 imported exactly as supplied".
 */
const adjustments = new Map<string, number>();
const noteAdjustment = (what: string) => adjustments.set(what, (adjustments.get(what) ?? 0) + 1);

/**
 * Cuts a string to fit, at a word boundary, or returns it unchanged.
 *
 * Only ever used on display text — a name, a one-line summary, an attribute
 * value. Truncating those loses marketing copy somebody stuffed into them —
 * 235 names here run to 186 characters and read "… Combo Pack (Blissful Dreams
 * Pillow Spray 100ml + Bathroom Freshener …)" — and the product behind each is
 * real. Truncating an *ingredient list* or a *monograph passage* would be a
 * different act entirely, and is deliberately not done anywhere below.
 */
function fit(value: string, limit: number, label: string): string {
  if (value.length <= limit) return value;
  noteAdjustment(`${label} shortened to ${limit} characters`);
  const cut = value.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).trim();
}

/**
 * What the schema will take, so the mapper and the reasons agree.
 *
 * Each of these was raised once the bundle was measured against it rather than
 * guessed at. `NAME_LIMIT` was 120 and cut 235 product names — combo packs list
 * their contents in the title, so the cut removed what is in the box; the
 * longest real name is 186. `GENERIC_LIMIT` was 160, which made the importer
 * drop three ingredient lists whole rather than truncate them (the right choice
 * between those two, and still a loss); the longest is 215.
 */
const NAME_LIMIT = 200;
const UNIT_LIMIT = 30;
const GENERIC_LIMIT = 250;

/**
 * The active ingredient, whole or not at all.
 *
 * The one field in here that is never cut to fit. Three rows run past 160
 * characters and every one of them is a combination —
 * `Sodium Chloride + Potassium Chloride + Calcium chloride + …`. A truncated
 * ingredient list is not a shorter answer to the question; it is a wrong one,
 * and it is wrong in a column a pharmacist reads to decide what is in the pack.
 *
 * Dropping it says "we do not have this", which is true, and then hands the row
 * to `validateClinicalIdentity`: nothing happens on an OTC line, and a
 * prescription line is refused — which is the right end for a prescription
 * medicine whose ingredients this catalogue cannot hold.
 */
function activeIngredient(raw: string | null | undefined): string | undefined {
  const name = clean(raw);
  if (!name) return undefined;
  if (name.length <= GENERIC_LIMIT) return name;
  noteAdjustment('active ingredient too long to store, dropped rather than cut');
  return undefined;
}

/**
 * The pack, as this trade describes it.
 *
 * The export separates what a unit *is* from what is *sold* — a strip of ten
 * tablets is `base_unit=Tablet`, `sales_unit=Strip`, `units_per_pack=10` — and
 * those are our `packSize` and `unit` respectively. Where a product is sold as
 * itself (`600gm Jar` of both) the count adds nothing and is left off.
 *
 * Nine rows put a description where the unit goes — `0.25mg,0.5mg/dose for
 * injection pre-filled pen`, `500ml (expanded) ; 225ml (folded)`. Cutting that
 * to fit would leave `0.25mg,0.5mg/dose for injectio`, which is not a unit and
 * not anything. It is a description of the pack, so it is moved to `packSize`
 * where it is true, and the unit becomes what the product actually is: one pack.
 */
const FALLBACK_UNIT = 'Pack';

function packOf(variant: SourceVariant): { packSize: string; unit: string } {
  const base = (variant.base_unit ?? '').trim();
  const sales = (variant.sales_unit ?? '').trim() || base;
  const per = variant.units_per_pack ?? 1;
  const packSize = per > 1 && base ? `${per} ${base}` : base || sales;
  const unit = sales || base;
  if (unit.length > UNIT_LIMIT) {
    noteAdjustment('unit held a pack description, moved to pack size');
    return { packSize: fit(unit, 60, 'pack size'), unit: FALLBACK_UNIT };
  }
  return { packSize, unit };
}

/**
 * Their shelf, in our vocabulary.
 *
 * A straight rename, not an inference — the source distinction is preserved
 * rather than collapsed, because "which shelf does this sit on" is a question
 * the buying team asks and nothing else in the record answers. Anything
 * unrecognised falls to `MEDICINE` only when it carries clinical data;
 * otherwise it is a general line, and the conditional rule in
 * `validateMedicine` decides whether that is acceptable.
 */
const SHELVES: Record<string, ProductType> = {
  medicine: ProductType.MEDICINE,
  supplement: ProductType.SUPPLEMENT,
  beauty: ProductType.PERSONAL_CARE,
  'baby_&_mom_care': ProductType.BABY_CARE,
  food: ProductType.FOOD,
  herbal: ProductType.HERBAL,
  homeopathy: ProductType.HOMEOPATHY,
  home_care: ProductType.HOME_CARE,
  veterinary: ProductType.VETERINARY,
  'pet_&_vet': ProductType.VETERINARY,
  /*
   * Four shelves the first version of this did not know about, so 2,141
   * products arrived filed as medicine — a glucometer, a nebuliser mask, a
   * walking stick and a box of condoms, all sitting on the drug shelf where the
   * buying team looks for drugs.
   *
   * The fallback below is what hid it: an unrecognised type became `MEDICINE`
   * silently, so the catalogue looked complete and was wrong. It now reports.
   */
  healthcare: ProductType.DEVICE, // glucometers, nebulisers, orthopaedic supports, test kits
  sexual_wellness: ProductType.PERSONAL_CARE, // condoms and lubricants, 418 of the 611
  ayurvedic: ProductType.HERBAL, // filed by the source under Homeopathy > Ayurvedic
};

/**
 * The same shelves, keyed by the head of the category trail.
 *
 * The two agree on 55,970 of 57,033 rows, which is what makes this usable as a
 * second opinion rather than a guess: `type` and `category_path` are two
 * independent statements by the supplier about the same product, so when the
 * first is a word meaning "we did not decide", the second is still evidence.
 *
 * `type` wins wherever it is recognised. Where they disagree it is the more
 * specific of the two — `ayurvedic` under a path that only says `Homeopathy`,
 * sixteen times — and a coarser answer is not an improvement.
 */
const SHELVES_BY_TRAIL: Record<string, ProductType> = {
  Medicine: ProductType.MEDICINE,
  Beauty: ProductType.PERSONAL_CARE,
  'Food and Nutrition': ProductType.FOOD,
  'Baby & Mom Care': ProductType.BABY_CARE,
  Healthcare: ProductType.DEVICE,
  'Home Care': ProductType.HOME_CARE,
  Supplement: ProductType.SUPPLEMENT,
  Veterinary: ProductType.VETERINARY,
  Homeopathy: ProductType.HOMEOPATHY,
  'Pet Care': ProductType.VETERINARY,
  Herbal: ProductType.HERBAL,
  'Sexual Wellness': ProductType.PERSONAL_CARE,
};

/** Types the source used that this mapping has no shelf for. Reported, not hidden. */
const unmappedTypes = new Map<string, number>();

function shelfOf(product: SourceProduct): ProductType {
  const type = (product.type ?? '').toLowerCase();
  const shelf = SHELVES[type];
  if (shelf) return shelf;

  unmappedTypes.set(type || '(blank)', (unmappedTypes.get(type || '(blank)') ?? 0) + 1);

  /*
   * One product in the bundle says `uncategorized`, which is the supplier
   * declining to answer rather than a shelf. Its trail says
   * `Medicine > Dermatological Preparations > Topical Anti-Infectives`, so the
   * answer was there all along — reading it is the difference between filing a
   * topical antiparasitic as a medicine because it is one, and filing it as a
   * medicine because `MEDICINE` is what the fallback happened to say.
   */
  const head = categoryTrail(product.category_path ?? null)[0];
  return (head && SHELVES_BY_TRAIL[head]) || ProductType.MEDICINE;
}

/**
 * `Medicine > Antimicrobial > Anti-Bacterial` → the trail, outermost first.
 *
 * The whole path was being thrown away and only its last segment kept, so the
 * catalogue knew a product was an "Anti-Bacterial" and had no idea that sat
 * under "Medicine". Nothing could ask for everything on a branch.
 */
function categoryTrail(path: string | null): string[] {
  return (path ?? '')
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The leaf, which is what a screen labels a product with. */
function leafCategory(path: string | null): string {
  const parts = categoryTrail(path);
  return parts[parts.length - 1] ?? '';
}

// ─── The supplier record ─────────────────────────────────────────────────────

/**
 * The supplier's demand figures — orders, views, ratings received.
 *
 * Taken whole or not at all: the schema treats `popularity` as one observation
 * with three parts, and two rows in the bundle arrive without a rating count.
 * Filling the gap with a zero would turn "they did not say" into "nobody ever
 * rated it", which is a different claim, so those rows carry no popularity.
 *
 * `products.rating` itself is deliberately absent here. Measured across all
 * 57,033 rows it is a constant 4.8 — min 4.8, max 4.8 — which is not a
 * measurement, it is a decoration. Importing it would stamp a fabricated
 * 4.8-star score on our own product pages. `rating_count` varies and is real,
 * so the count survives and the score does not.
 */
function demandFigures(
  product: SourceProduct,
  variant: SourceVariant,
): { ordered: number; viewCount: number; ratingCount: number } | undefined {
  const usable = (n: number | null | undefined): n is number => Number.isInteger(n) && n! >= 0;
  const ordered = variant.ordered;
  const viewCount = product.view_count ?? variant.viewed;
  const ratingCount = product.rating_count;
  if (usable(ordered) && usable(viewCount) && usable(ratingCount)) {
    return { ordered, viewCount, ratingCount };
  }
  noteAdjustment('supplier demand figures incomplete, popularity left off');
  return undefined;
}

/**
 * The supplier's merchandising tags, verbatim but bounded.
 *
 * The schema caps the list at 32 and each tag at 120 characters so a malformed
 * export cannot write an unbounded array into every document — but the cap is
 * set *above* what the bundle contains rather than through it. The worst row
 * carries 24 tags and the longest tag is 89 characters, so nothing here is cut
 * now; the earlier 20/80 bounds truncated eight lists and dropped seven tags.
 * A bound exists to stop a malformed export, not to trim a well-formed one.
 */
function supplierTags(raw: string | null): string[] | undefined {
  const text = (raw ?? '').trim();
  if (!text || text === '[]') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    noteAdjustment('tags column held malformed JSON, dropped (still in the archive)');
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const tags: string[] = [];
  for (const tag of parsed) {
    const value = typeof tag === 'string' ? tag.trim() : '';
    if (!value || value.length > 120) {
      noteAdjustment('tag empty or over 120 characters, dropped');
      continue;
    }
    tags.push(value);
  }
  if (tags.length > 32) {
    noteAdjustment('more than 32 tags, list cut at 32');
    tags.length = 32;
  }
  return tags.length ? tags : undefined;
}

interface AttributePair {
  name: string;
  value: string;
}

/** The variant's own attribute object — `{"skin type": "Sensitive"}` — as pairs. */
function variantAttributes(variant: SourceVariant): AttributePair[] {
  const raw = (variant.attributes ?? '').trim();
  if (!raw || raw === '[]' || raw === '{}') return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const pairs: AttributePair[] = [];
    for (const [name, value] of Object.entries(parsed)) {
      const text = String(value ?? '').trim();
      if (name.trim() && text) pairs.push({ name: name.trim(), value: text });
    }
    return pairs;
  } catch {
    noteAdjustment('variant attributes held malformed JSON, dropped (still in the archive)');
    return [];
  }
}

/**
 * Variant attributes and the pairs mined out of `seo_sections`, as one list.
 *
 * Deduplicated case-insensitively because the source states the same fact in
 * both places — the variant says `{"pack size": "1 Bottle"}` and the SEO table
 * says `Pack Size : 1` → `1 Bottle` — and a product page listing "Pack Size"
 * twice reads as a data fault. Capped at 40 to match the schema; the busiest
 * product carries about two dozen, so the cap should never bite, and it is
 * counted if it ever does.
 */
function mergeAttributes(
  fromVariant: AttributePair[],
  fromSeo: AttributePair[],
): AttributePair[] | undefined {
  const seen = new Set<string>();
  const merged: AttributePair[] = [];
  for (const pair of [...fromVariant, ...fromSeo]) {
    // 300 to match the schema. The variant attributes are short — the longest
    // in the bundle is 27 characters — but the pairs recovered from SEO
    // headings are looser, and one ran past 120 and was cut.
    const name = fit(pair.name, 300, 'attribute name');
    const value = fit(pair.value, 300, 'attribute value');
    if (!name || !value) continue;
    const key = `${name.toLowerCase()} ${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (merged.length >= 40) {
      noteAdjustment('more than 40 attributes, list cut at 40');
      break;
    }
    merged.push({ name, value });
  }
  return merged.length ? merged : undefined;
}

/**
 * What a `seo_sections` heading actually is. Measured, not guessed:
 *
 * - 84,830 rows are headed 'Frequently Questions & Answers' or
 *   'Rating & Reviews' and duplicate the FAQ and rating tables word for word —
 *   archive only, importing them twice would be storing an echo.
 * - ~47,000 rows are attribute pairs wearing a heading: `Pack Size : 1` with
 *   the value in the text column, or a heading that opens with the Taka sign
 *   (`৳ 288.00 / Powder for Suspension` → `Out of stock`) — a variant price
 *   listing, not prose. Those become `Medicine.attributes`.
 * - The rest — Ingredients, Benefits, How to Use, Key Features — are real
 *   long-form copy and become FEATURE sections of the monograph.
 */
const SEO_BOILERPLATE = new Set(['Frequently Questions & Answers', 'Rating & Reviews']);
const TAKA_SIGN = '৳';
const ATTRIBUTE_HEADING = /\s*:\s*\d+\s*$/;

function seoKind(heading: string): 'boilerplate' | 'attribute' | 'prose' {
  if (SEO_BOILERPLATE.has(heading)) return 'boilerplate';
  if (heading.startsWith(TAKA_SIGN) || ATTRIBUTE_HEADING.test(heading)) return 'attribute';
  return 'prose';
}

/**
 * The attribute pairs hiding in `seo_sections`, gathered before the product
 * pass because they ride into the catalogue *on* the medicine document and
 * must go through the same schema as everything else.
 *
 * `Pack Size : 1` sheds its ` : 1` counter suffix — the name is "Pack Size",
 * the `1` is the export numbering its own rows. A Taka heading is kept whole:
 * `৳ 288.00 / Powder for Suspension` → `Out of stock` is a fact about a
 * variant, and inventing a prettier name for it would be editing the record.
 *
 * Streams the whole table but keeps pairs only for products in this run, so
 * `--limit` bounds the memory here the way it bounds everything else.
 */
function collectSeoAttributes(
  db: DatabaseSync,
  names: Map<number, string>,
  maxMemberId: number,
): Map<number, AttributePair[]> {
  const pairs = new Map<number, AttributePair[]>();
  const statement = db.prepare(
    'select product_id, heading, text from seo_sections order by product_id, id',
  );
  for (const row of statement.iterate() as Iterable<{
    product_id: number;
    heading: string;
    text: string | null;
  }>) {
    if (row.product_id > maxMemberId) break;
    const productName = names.get(row.product_id);
    if (productName === undefined) continue;
    if (seoKind(row.heading) !== 'attribute') continue;
    const name = readable(row.heading.replace(ATTRIBUTE_HEADING, ''), productName);
    const value = readable(row.text ?? '', productName);
    if (!name || !value) continue;
    const list = pairs.get(row.product_id) ?? [];
    list.push({ name, value });
    pairs.set(row.product_id, list);
  }
  return pairs;
}

interface Mapped {
  externalId: string;
  sku: string;
  fields: Record<string, unknown>;
}

/** The per-product facts assembled outside the product row itself. */
interface SupplierFacts {
  attributes: AttributePair[] | undefined;
  categoryIds: number[] | undefined;
  hasSupplierPhoto: boolean;
}

function mapProduct(product: SourceProduct, variant: SourceVariant, facts: SupplierFacts): Mapped {
  const pack = packOf(variant);

  /*
   * The trade price, not the consumer price.
   *
   * `price` is what a shopper pays on Arogga's storefront; `b2b_price` is what
   * a shop pays. This is a distributor's catalogue, so the second is the one
   * that belongs in `defaultSellingPriceMinor` — importing the consumer price
   * would quote every customer the retail figure and give away the whole trade
   * margin on the first order.
   */
  const tradeMinor = toMinor(variant.b2b_price ?? product.price);
  const mrpMinor = toMinor(variant.b2b_mrp ?? variant.mrp ?? product.mrp);

  return {
    externalId: String(product.product_id),
    sku: `AROGGA-${product.product_id}`,
    fields: {
      // The export's own SKU column is empty on every row measured, so the
      // identifier is derived from the source id — traceable, and unique
      // without needing to invent a scheme.
      sku: `AROGGA-${product.product_id}`,
      productType: shelfOf(product),
      brandName: fit((product.name ?? '').trim(), NAME_LIMIT, 'product name'),
      /*
       * An ingredient list is never cut to fit.
       *
       * Three rows run past 160 characters, and they are combinations —
       * `Sodium Chloride + Potassium Chloride + Calcium chloride + …`. Truncating
       * one leaves a field that a pharmacist reads as the complete list of what
       * is in the pack, silently missing whatever came after the cut. Dropping it
       * says "we do not have this", which is true, and hands the row to
       * `validateClinicalIdentity`: harmless on an OTC line, and a refusal on a
       * prescription one, which is the right outcome for a prescription medicine
       * whose active ingredients this catalogue cannot represent.
       */
      genericName: activeIngredient(product.generic_name),
      /*
       * Their `brand_name` is our `manufacturer`.
       *
       * Not a slip: the export's `manufacturer` column is empty on every row,
       * and `brand_name` carries "The ACME Laboratories", "Renata Limited",
       * "Apex Pharma" — which is the manufacturer in our vocabulary. The
       * handoff says as much; this is the field that proves it.
       */
      manufacturer: fit(
        (product.manufacturer || product.brand_name || '').trim(),
        NAME_LIMIT,
        'manufacturer',
      ),
      strength: clean(product.strength),
      dosageForm: clean(product.form),
      packSize: pack.packSize,
      unit: pack.unit,
      category: leafCategory(product.category_path),
      categoryPath: categoryTrail(product.category_path),
      costPriceMinor: tradeMinor,
      defaultSellingPriceMinor: tradeMinor,
      mrpMinor,
      minimumOrderQuantity: Math.max(1, variant.min_qty ?? 1),
      maximumOrderQuantity: variant.max_qty && variant.max_qty > 0 ? variant.max_qty : undefined,
      classification: product.rx_required
        ? MedicineClassification.PRESCRIPTION
        : MedicineClassification.OTC,
      coldChain: Boolean(product.cold_chain),
      popularity: demandFigures(product, variant),
      attributes: facts.attributes,
      tags: supplierTags(product.tags),
      /*
       * Bounded at the supplier's own ceiling rather than below it. The bound
       * was 500 and cut 2,810 of the 7,013 summaries — 40% — mid-sentence, for
       * no reason: the longest they ever write is exactly 1,000 characters, so
       * matching that keeps every one of them whole and still bounds the field.
       */
      shortDescription: product.short_description
        ? fit(readable(product.short_description, product.name), 1000, 'short description') ||
          undefined
        : undefined,
      fullName: clean(product.full_name),
      sourceSlug: clean(product.slug),
      /*
       * Kept verbatim, zero included. 30,137 rows carry `generic_id = 0`, which
       * is almost certainly the source's "no generic" sentinel — but deciding
       * that here would replace their record with our reading of it, and the
       * whole point of these fields is provenance. Anything joining on it can
       * treat 0 as it sees fit.
       */
      genericId:
        Number.isInteger(product.generic_id) && product.generic_id! >= 0
          ? product.generic_id!
          : undefined,
      categoryIds: facts.categoryIds,
      deliveryRestriction: product.dhaka_only ? DeliveryRestriction.DHAKA_ONLY : undefined,
      /*
       * Their stock on the day of the scrape, dated — never our `isActive`.
       * The model's own comment carries the full story: the previous import let
       * this field switch off 43% of the catalogue on a competitor's say-so.
       */
      listedElsewhere: clean(product.availability)
        ? { availability: clean(product.availability)!, checkedAt: product.scraped_at }
        : undefined,
      hasSupplierPhoto: facts.hasSupplierPhoto,
    },
  };
}

// ─── Pictures ────────────────────────────────────────────────────────────────

/**
 * Copies a picture out of the bundle and into the media root, and returns the
 * path a client should ask for.
 *
 * The bundle is not part of the deployment — it is gitignored, it arrives with
 * the zip's own nesting intact, and it is several hundred megabytes at full
 * scale. So the bytes are copied to somewhere the API actually serves from, and
 * the medicine records where they landed. Recording a bundle-relative path
 * instead is what the first version of this did, and it produced a catalogue
 * full of `productImageUrl`s pointing at files no client could fetch.
 *
 * The destination keeps the source product id in the path. Two products in this
 * export share a filename often enough that flattening would silently give one
 * of them the other's photograph, and the id is the one thing guaranteed unique.
 */
function placeImage(
  dataDirectory: string,
  localPath: string,
  productId: number,
  apply: boolean,
): string | undefined {
  const source = join(dataDirectory, localPath);
  if (!existsSync(source)) return undefined;

  const file = basename(localPath);
  const relative = `catalogue/arogga/${productId}/${file}`;
  if (apply) {
    const destination = join(mediaRoot, 'catalogue', 'arogga', String(productId), file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  return `${MEDIA_PREFIX}/${relative}`;
}

// ─── Descriptions ────────────────────────────────────────────────────────────

/**
 * RFC 4180, a chunk at a time.
 *
 * Two separate reasons this is not `split(',')` and not `readFileSync`.
 *
 * The descriptions are HTML, and HTML is full of commas and newlines — a naive
 * split tears a monograph apart at the first comma inside a quoted field, and
 * reads a `<p>` spanning a line as the start of a new row. So: quoted fields,
 * doubled quotes as an escape, embedded newlines, `\r\n` folded.
 *
 * And at full scale the file is **~4.1 million rows**, which the first version
 * of this read into a single string and then into a `string[][]` of every field
 * in it. Both of those are hard failures rather than slow ones: the string
 * exceeds V8's maximum length, and the array is tens of millions of objects.
 * The reader is therefore fed chunks and hands each row straight to a callback,
 * so nothing accumulates that the caller has not chosen to keep.
 *
 * The one subtlety is a `"` arriving as the last character of a chunk. Whether
 * it closed the field or escaped a second quote depends on the character after
 * it, which has not been read yet — so that decision is deferred rather than
 * guessed.
 *
 * Reused by every CSV this importer reads. Do not write a second parser.
 */
function csvFeeder(onRow: (row: string[]) => void) {
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let pendingQuote = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    onRow(row);
    row = [];
  };

  return {
    push(text: string) {
      let index = 0;
      if (pendingQuote) {
        pendingQuote = false;
        if (text[0] === '"') {
          field += '"';
          index = 1;
        } else {
          quoted = false;
        }
      }
      for (; index < text.length; index += 1) {
        const character = text[index]!;
        if (quoted) {
          if (character !== '"') {
            field += character;
            continue;
          }
          if (index + 1 >= text.length) {
            pendingQuote = true;
            break;
          }
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else quoted = false;
          continue;
        }
        if (character === '"') quoted = true;
        else if (character === ',') endField();
        else if (character === '\n') endRow();
        else if (character !== '\r') field += character;
      }
    },
    end() {
      // A trailing quote with nothing after it closed its field.
      pendingQuote = false;
      quoted = false;
      if (field || row.length) endRow();
    },
  };
}

/** The order the handoff gives for rebuilding a monograph. */
const SECTION_ORDER = ['body', 'brief_description', 'overview', 'quick_tips', 'safety_advice'];

/**
 * How much of a description the catalogue keeps.
 *
 * Also the memory bound on the import. A monograph is long, there are 49,000 of
 * them, and holding all of them in full while the products are written is the
 * difference between a batch job and an out-of-memory crash — so each one is
 * stripped to text and capped as it arrives rather than after the file is read.
 */
const DESCRIPTION_LIMIT = 2000;

/**
 * A tag that never closes, which is what is left when text is cut mid-markup.
 *
 * One row of the sample export ends `...</p>\n55:Tcad,<h` inside its quoted
 * field — the exporter truncated it mid-write — and `/<[^>]+>/` cannot strip a
 * tag with no `>` to match. Capping a description can produce the same shape,
 * so it is removed wherever text is cut rather than only where it was found.
 *
 * **The first character after `<` is what makes this safe, and leaving it out
 * was a serious defect.** This pattern was `/<[^>]*$/`, which matches *any*
 * remaining `<` through to the end of the passage — and a drug monograph is
 * full of literal ones: `CrCl (ml/min) <20`, `Child: PO 8 mg/kg/day if <50 kg`,
 * `<6 months: safety not established`. Measured over the bundle, that deleted
 * **5,477,285 characters across 21,824 passages, touching 13,989 products**,
 * plus another 98,147 characters of `seo_sections` prose — silently, with no
 * adjustment counted, while the summary printed "never cut to fit".
 *
 * A tag name can only begin with a letter, `/` or `!`. A dose threshold is
 * followed by a digit or a space. That one character separates them.
 */
const DANGLING_TAG = /<[a-zA-Z/!][^>]*$/;

/**
 * The entities the supplier leaves in their prose once the markup is gone.
 *
 * Their copy is HTML, so a literal `<` in a dose is written `&lt;` — and 35,531
 * passages across 17,398 products still carry one after tags are stripped.
 * Stored undecoded they reach a screen as the characters `&lt;6 months`, which
 * is what a pharmacist then reads.
 *
 * Decoding happens **after** the markup is stripped, never before. `&lt;p&gt;`
 * decoded first would become `<p>` and be deleted as a tag — the supplier
 * escaped it precisely because it is text about a tag, not a tag.
 */
/*
 * The Latin-1 supplement, U+00A0–U+00FF, in code-point order.
 *
 * Written as an ordered list rather than 96 key/value pairs because that is
 * what it is — HTML's names for one contiguous block — and because a
 * hand-written subset is what failed here the first time. Twenty-one names
 * were listed by hand and the bundle turned out to use forty-six, so
 * `&eacute;`, `&aacute;`, `&ocirc;` and the rest reached the screen as their
 * own source text inside ingredient lists and brand names.
 */
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr ' +
  'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml ' +
  'Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times ' +
  'Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml ' +
  'igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide ' +
  'oslash ugrave uacute ucirc uuml yacute thorn yuml';

/** The Greek block HTML names, U+03B1 onward for lower case, U+0391 for upper. */
const GREEK_LOWER =
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega';
const GREEK_UPPER =
  'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho Sigmaf Sigma Tau Upsilon Phi Chi Psi Omega';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Punctuation, arrows and the mathematical comparisons. `le` and `ge` are
  // the ones that matter clinically — they appear inside dose and particle
  // specifications ("&ge;65 yr", "MMAD &le;4.2µm").
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwj: '‍',
  zwnj: '‌',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  dagger: '†',
  Dagger: '‡',
  bull: '•',
  hellip: '…',
  permil: '‰',
  prime: '′',
  Prime: '″',
  lsaquo: '‹',
  rsaquo: '›',
  oline: '‾',
  frasl: '⁄',
  euro: '€',
  trade: '™',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  minus: '−',
  lowast: '∗',
  radic: '√',
  infin: '∞',
  cap: '∩',
  cup: '∪',
  int: '∫',
  ne: '≠',
  equiv: '≡',
  le: '≤',
  ge: '≥',
  asymp: '≈',
  empty: '∅',
  sum: '∑',
  prod: '∏',
  OElig: 'Œ',
  oelig: 'œ',
  Scaron: 'Š',
  scaron: 'š',
  Yuml: 'Ÿ',
  fnof: 'ƒ',
  circ: 'ˆ',
  tilde: '˜',
};

for (const [index, name] of LATIN1.split(' ').entries()) {
  ENTITIES[name] = String.fromCodePoint(0x00a0 + index);
}
for (const [index, name] of GREEK_LOWER.split(' ').entries()) {
  ENTITIES[name] = String.fromCodePoint(0x03b1 + index);
}
for (const [index, name] of GREEK_UPPER.split(' ').entries()) {
  ENTITIES[name] = String.fromCodePoint(0x0391 + index);
}

/**
 * Decodes until the text stops changing, at most three times.
 *
 * One pass is the textbook answer and it leaves 63 passages wrong, because the
 * supplier double-encodes: their copy carries `&amp;amp;` and `&amp;#39;`,
 * which a single pass turns into the visible characters `&amp;` and `&#39;`.
 * Nobody writing "every woman deserves to look &amp;amp; feel fabulous" meant
 * the reader to see an ampersand entity; they meant "&".
 *
 * Bounded rather than looped to a fixed point, because unbounded re-decoding
 * would eventually mangle a passage that genuinely wants to *show* an entity.
 * Three passes clears the double encoding present here with room to spare, and
 * a triple-encoded string is not something this bundle contains.
 */
function decodeEntities(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function decodeOnce(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,9});/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      // Surrogates and out-of-range values are not characters; leaving the
      // entity as written is closer to the source than emitting U+FFFD.
      if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    /*
     * Case-sensitive on purpose. HTML entity names are — `&Dagger;` is ‡ and
     * `&dagger;` is †, `&Alpha;` is Α and `&alpha;` is α — so lower-casing the
     * lookup silently swaps one character for another. An unknown name is left
     * exactly as written rather than guessed at.
     *
     * Within a pass, the `&` that `&amp;` produces is never re-scanned; a
     * genuinely double-encoded `&amp;amp;` is resolved by the next pass in
     * `decodeEntities`, not by this one.
     */
    return ENTITIES[body] ?? whole;
  });
}

/**
 * The exporter's serialiser bleeding through: 12,507 of the 27,195
 * `description_html` values end with the next rows of a React flight payload —
 * `...made in Bangladesh,"</p>3f:["$","$7",null,{"fallback":…` — glued straight
 * onto the prose. It is transport framing, not content, and the marker shape
 * (a *hex* row id, colon, `["$"` — `3f:`, not only `41:`, which is what a
 * decimal-only pattern missed on the first pass) cannot occur in copy a person
 * wrote, so everything from the first marker on is cut. Counted, because half
 * the long descriptions arriving shorter than the source column is a fact the
 * summary should state.
 */
const FLIGHT_RESIDUE = /[0-9a-fA-F]+:\["\$"[\s\S]*$/;

/**
 * Markup out, entities decoded, line structure kept, the source's own name
 * placeholder filled.
 *
 * The order of these steps is load-bearing and each one is commented where it
 * is not obvious. Newlines survive on purpose: 77,795 passages across 23,529
 * products separate each indication, age band or dose onto its own line, and
 * collapsing them turns a dose table into one run-on sentence. Runs of spaces
 * and tabs still collapse, and three or more blank lines become one blank line,
 * so the result is tidy without being flattened.
 */
function readable(html: string, productName: string): string {
  let text = html;
  if (FLIGHT_RESIDUE.test(text)) {
    noteAdjustment("exporter's serialiser residue cut off the end of a passage");
    text = text.replace(FLIGHT_RESIDUE, ' ');
  }
  // The source templates the product name out as `__NAME__`, which reads as a
  // rendering bug if it reaches a screen.
  text = text.replaceAll('__NAME__', productName).replace(/<[^>]+>/g, ' ');

  // Only a genuine unclosed tag — see DANGLING_TAG. Counted, because a cut that
  // nobody counts is how five million characters went missing the first time.
  if (DANGLING_TAG.test(text)) {
    noteAdjustment('passage ended inside an unclosed tag, the fragment dropped');
    text = text.replace(DANGLING_TAG, ' ');
  }

  return decodeEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Long-form copy, streamed from the CSV rather than read from the database.
 *
 * The handoff says to prefer `arogga.sqlite` because "it has the same data" —
 * it does not. The database's `seo_sections` table carries only `heading` and
 * `text`, with **no `lang` and no `section` column**, so the documented
 * instruction to filter to English cannot be followed from it: English and
 * Bengali arrive interleaved in one field. `descriptions.csv` has the shape the
 * handoff documents, so that is the file this reads.
 *
 * Only the products being imported are kept, so `--limit` bounds this too.
 */
async function loadDescriptions(
  dataDirectory: string,
  names: Map<number, string>,
): Promise<{ byProduct: Map<number, string>; rows: number; contributed: number }> {
  const file = join(dataDirectory, 'descriptions.csv');
  if (!existsSync(file)) return { byProduct: new Map(), rows: 0, contributed: 0 };
  /** Rows seen and rows that reached a summary, for the reconciliation table. */
  let rows = 0;
  let contributed = 0;

  /**
   * One slot per known section, plus a trailing slot for anything the handoff
   * does not name. Slotting is what puts a monograph back in order without
   * holding the sections to sort them afterwards; the extra slot is why an
   * unrecognised section lands at the end rather than, as it used to, at the
   * front on the strength of `indexOf` returning -1.
   */
  const slots = new Map<number, string[]>();
  let header: string[] | null = null;
  let column: Record<string, number> = {};

  const feeder = csvFeeder((row) => {
    if (!header) {
      header = row;
      column = Object.fromEntries(row.map((name, index) => [name, index]));
      return;
    }
    if (row.length < header.length) return;
    rows += 1;
    if (row[column.lang!] !== 'en') return;

    const productId = Number(row[column.product_id!]);
    const name = names.get(productId);
    // Not in this run — either not a product, or excluded by `--limit`.
    if (!productId || name === undefined) return;

    const parts = slots.get(productId) ?? new Array<string>(SECTION_ORDER.length + 1).fill('');
    const held = parts.reduce((total, part) => total + part.length, 0);
    if (held >= DESCRIPTION_LIMIT) return;

    const title = readable(row[column.title!] ?? '', name);
    const content = readable(row[column.content!] ?? '', name);
    const text = title ? `${title}: ${content}` : content;
    if (!text) return;

    const section = row[column.section!] ?? '';
    const at = SECTION_ORDER.indexOf(section);
    const slot = at < 0 ? SECTION_ORDER.length : at;
    const room = text.slice(0, DESCRIPTION_LIMIT - held).replace(DANGLING_TAG, '');
    parts[slot] = (parts[slot] ? `${parts[slot]}\n\n` : '') + room;
    slots.set(productId, parts);
    contributed += 1;
  });

  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    feeder.push(chunk as string);
  }
  feeder.end();

  const assembled = new Map<number, string>();
  for (const [productId, parts] of slots) {
    const text = parts
      .filter(Boolean)
      .join('\n\n')
      .slice(0, DESCRIPTION_LIMIT)
      .replace(DANGLING_TAG, '')
      .trim();
    if (text) assembled.set(productId, text);
  }
  return { byProduct: assembled, rows, contributed };
}

// ─── The monograph ───────────────────────────────────────────────────────────

/**
 * `description_structured`, verified against every product that carries one:
 * exactly eight top-level keys — four English groups and their `g_*_bn`
 * Bengali siblings. The whole monograph goes to `MedicineContent`, uncapped;
 * the 2,000-character `DESCRIPTION_LIMIT` above applies only to the short
 * `Medicine.description` summary and must never reach these passages — the
 * longest legitimate body in the bundle runs to 29,431 characters.
 */
const MONOGRAPH_GROUPS: Record<
  'en' | 'bn',
  ReadonlyArray<readonly [string, MedicineContentGroup]>
> = {
  en: [
    ['brief_description', MedicineContentGroup.BRIEF],
    ['overview', MedicineContentGroup.OVERVIEW],
    ['quick_tips', MedicineContentGroup.QUICK_TIP],
    ['safety_advices', MedicineContentGroup.SAFETY],
  ],
  bn: [
    ['g_brief_description_bn', MedicineContentGroup.BRIEF],
    ['g_overview_bn', MedicineContentGroup.OVERVIEW],
    ['g_quick_tips_bn', MedicineContentGroup.QUICK_TIP],
    ['g_safety_advices_bn', MedicineContentGroup.SAFETY],
  ],
};

/*
 * Every `type` the bundle actually writes, not the six that were assumed.
 *
 * The last three appear seven times each and were being dropped. `&` and the
 * spaces around it are why they cannot be normalised mechanically the way the
 * verdicts are — 'Pregnancy & Lactation' uppercases to 'PREGNANCY_&_LACTATION',
 * which is not an identifier — so the mapping is written out.
 */
const SAFETY_TYPE_BY_SOURCE: Record<string, SafetyAdviceType> = {
  Alcohol: SafetyAdviceType.ALCOHOL,
  Pregnancy: SafetyAdviceType.PREGNANCY,
  Breastfeeding: SafetyAdviceType.BREASTFEEDING,
  Driving: SafetyAdviceType.DRIVING,
  Kidney: SafetyAdviceType.KIDNEY,
  Liver: SafetyAdviceType.LIVER,
  'Side Effects': SafetyAdviceType.SIDE_EFFECTS,
  'Pregnancy & Lactation': SafetyAdviceType.PREGNANCY_AND_LACTATION,
  'Precautions & Warnings': SafetyAdviceType.PRECAUTIONS_AND_WARNINGS,
};

/**
 * The Bengali spelling of "not relevant", which the supplier writes in the
 * Bengali safety array where the English array says `NOT RELEVANT`.
 *
 * It is one verdict written in two languages rather than two verdicts, and the
 * counts prove it: 465 rows carry each, exactly. A verdict is a fact about the
 * medicine, so it normalises to one stored value and the *language* lives on
 * the content document — otherwise a screen filtering for "not relevant" would
 * find the English rows and silently miss the Bengali ones.
 */
const SAFETY_TAG_BY_SOURCE: Record<string, SafetyAdviceTag> = {
  'প্রাসঙ্গিক না': SafetyAdviceTag.NOT_RELEVANT,
};

/**
 * The supplier's verdict, normalised — 'SAFE IF PRESCRIBED' arrives with
 * spaces and is stored underscored.
 *
 * This function used to drop 57,377 verdicts of 215,391 — 26.6%, including
 * `CONSULT YOUR DOCTOR`, which is the single most common verdict in the whole
 * bundle at 56,447 rows. Nothing failed; the enum simply had no room and the
 * drop counter said so in a line nobody was reading. `SafetyAdviceTag` now
 * holds all seven real values, and the only verdicts still passed over are the
 * 17,510 genuinely **blank** ones, where the supplier recorded no opinion.
 *
 * The blanks are not counted as an adjustment: an absent verdict is an absent
 * verdict, and reporting it as data loss would bury the drops that matter.
 */
function safetyTagOf(raw: unknown): SafetyAdviceTag | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  const mapped = SAFETY_TAG_BY_SOURCE[trimmed];
  if (mapped) return mapped;
  const key = trimmed.toUpperCase().replace(/\s+/g, '_');
  const tag = (SafetyAdviceTag as Record<string, SafetyAdviceTag>)[key];
  if (!tag) noteAdjustment(`safety verdict "${trimmed}" is outside the stored set, dropped`);
  return tag;
}

/**
 * One monograph value as displayable text, or nothing — counted either way.
 *
 * Three shapes arrive: a plain string; `{list, tag?}` (side-effect lists,
 * sometimes labelled "Common"); and a dangling `"$48"` — the exporter's own
 * serialiser writing a reference whose target it then failed to include.
 * 11,745 passages across the bundle are such references. There is nothing to
 * recover from them here; the raw record is archived, so if the supplier ever
 * fixes their export the passages can be re-read rather than re-scraped.
 */
function passage(value: unknown, productName: string): string | undefined {
  if (typeof value === 'string') {
    if (/^\$\d+$/.test(value)) {
      noteAdjustment('monograph passage was a dangling reference in the export, dropped');
      return undefined;
    }
    const text = readable(value, productName);
    if (!text) noteAdjustment('monograph passage empty once markup was stripped, dropped');
    return text || undefined;
  }
  if (value && typeof value === 'object' && Array.isArray((value as { list?: unknown }).list)) {
    const block = value as { list: unknown[]; tag?: unknown };
    const items = block.list
      .filter((item): item is string => typeof item === 'string')
      .map((item) => readable(item, productName))
      .filter(Boolean);
    if (!items.length) {
      noteAdjustment('monograph passage empty once markup was stripped, dropped');
      return undefined;
    }
    const label =
      typeof block.tag === 'string' && block.tag.trim()
        ? `${readable(block.tag, productName)}: `
        : '';
    return label + items.join('; ');
  }
  noteAdjustment('monograph passage had no content, dropped');
  return undefined;
}

interface MonographSection {
  group: MedicineContentGroup;
  title?: string;
  body: string;
  position: number;
  safety?: { type?: SafetyAdviceType; tag?: SafetyAdviceTag };
}

/**
 * The four structured groups of one language, in the supplier's own order.
 *
 * `position` restarts per language document and keeps counting through the
 * BODY and FEATURE sections the caller appends, so a screen that filters to
 * one group still knows where each passage sat in the whole.
 */
function monographSections(
  structured: Record<string, unknown> | undefined,
  productName: string,
  lang: 'en' | 'bn',
): MonographSection[] {
  const sections: MonographSection[] = [];
  if (!structured) return sections;
  for (const [key, group] of MONOGRAPH_GROUPS[lang]) {
    const value = structured[key];
    // 285 group values in the bundle are a bare string rather than an array —
    // the same passage, unwrapped. Treated as a list of one, not as malformed.
    const items = Array.isArray(value)
      ? value
      : typeof value === 'string' && value.trim()
        ? [value]
        : [];
    for (const item of items) {
      if (typeof item === 'string') {
        const body = passage(item, productName);
        if (body) sections.push({ group, body, position: sections.length });
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const entry = item as { title?: unknown; content?: unknown; type?: unknown; tag?: unknown };
      const body = passage(entry.content, productName);
      if (!body) continue;
      if (group === MedicineContentGroup.SAFETY) {
        const sourceType = typeof entry.type === 'string' ? entry.type.trim() : '';
        const type = SAFETY_TYPE_BY_SOURCE[sourceType];
        /*
         * Seven products carry safety rows headed 'Side Effects' or
         * 'Pregnancy & Lactation' — real passages wearing a heading the
         * six-value enum has no slot for. The heading moves to `title` so the
         * information survives on screen; only the structured field is lost.
         */
        if (sourceType && !type) {
          noteAdjustment(`safety question "${sourceType}" outside the stored six, kept as a title`);
        }
        const tag = safetyTagOf(entry.tag);
        const title = type ? undefined : readable(sourceType, productName) || undefined;
        sections.push({
          group,
          ...(title ? { title } : {}),
          body,
          position: sections.length,
          ...(type || tag
            ? { safety: { ...(type ? { type } : {}), ...(tag ? { tag } : {}) } }
            : {}),
        });
        continue;
      }
      const title = typeof entry.title === 'string' ? readable(entry.title, productName) : '';
      sections.push({ group, ...(title ? { title } : {}), body, position: sections.length });
    }
  }
  return sections;
}

// ─── Related products ────────────────────────────────────────────────────────

/**
 * All four of the supplier's carousels, complete. Two used to be left behind —
 * `more_from_brand` as derivable from `manufacturer`, `you_may_also_like` as
 * advertising — and the product owner reversed the storage half of that call:
 * the complete supplier record is kept, their ordering included, because the
 * derivable version cannot preserve *their* ranking and goes stale against a
 * delisted product in a different way than a stored list does. The caution
 * survives in the kind itself: `PROMOTED` is their bestseller carousel, and
 * every screen showing it must label it a promotion, never a clinical match —
 * that warning lives on `MedicineRelationKind` and travels with the type.
 *
 * The old `RANK_CAP = 24` went with the row shape that motivated it. Capping
 * existed to avoid 1.2 million index-bearing rows nobody would scroll to; as
 * an entry in a per-(product, kind) array the marginal rank costs a few bytes
 * and no index, so the supplier's whole ranking is kept.
 */
const RELATION_KINDS: ReadonlyArray<readonly [string, MedicineRelationKind]> = [
  ['similar_products', MedicineRelationKind.SIMILAR],
  ['frequently_bought_together', MedicineRelationKind.BOUGHT_TOGETHER],
  ['more_from_brand', MedicineRelationKind.SAME_BRAND],
  ['you_may_also_like', MedicineRelationKind.PROMOTED],
];

interface RelationReport {
  /** Documents written — one per (product, kind) that kept at least one item. */
  documents: number;
  /** Source rows that landed as an item in one of those documents. */
  items: number;
  /** Rows pointing at a product this import refused — nowhere to point. */
  danglingEnd: number;
  /** Rows starting from a refused product — no document to hold them. */
  fromRefused: number;
  /** Rows whose other end sits outside a `--limit` slice. */
  pointsOutside: number;
  /** Rows never reached because `--limit` cut the run short. */
  outsideRun: number;
}

/**
 * The relations pass, resolving the source's ids through the map the product
 * pass built, into one document per (product, kind) holding the whole list.
 *
 * Idempotency changed shape with the model: the old row schema carried a
 * unique `(fromId, toId, kind)` index that made re-runs upserts; the array
 * schema deletes each product's documents and reinserts them, which is
 * idempotent with nothing to enforce it — and is why the delete below runs
 * before anything is written.
 *
 * Rows are streamed and grouped on the fly — `order by from_id, rank` means a
 * document is complete the moment `from_id` changes, so at no point does more
 * than one product's list sit in memory per kind. Loading 3.6 million rows to
 * group them afterwards is the same mistake the description reader documents,
 * one table over.
 */
async function importRelations(
  db: DatabaseSync,
  localId: Map<number, mongoose.Types.ObjectId>,
  refusedIds: Set<number>,
  maxMemberId: number,
): Promise<RelationReport> {
  const report: RelationReport = {
    documents: 0,
    items: 0,
    danglingEnd: 0,
    fromRefused: 0,
    pointsOutside: 0,
    outsideRun: 0,
  };

  if (APPLY) {
    /*
     * Cleared for the products in this run, not globally.
     *
     * `deleteMany({})` would be right for a full import and quietly wrong for a
     * `--limit` one, taking the relations of every product outside the slice
     * with it. Batched because an `$in` of 55,998 ids is a query nobody should
     * write.
     */
    const ids = [...localId.values()];
    for (let at = 0; at < ids.length; at += 5000) {
      await MedicineRelation.deleteMany({ fromId: { $in: ids.slice(at, at + 5000) } });
    }
  }

  /** When this list was last re-imported — one clock for the whole run. */
  const refreshedAt = new Date();

  let pending: Array<Record<string, unknown>> = [];
  const flushDocs = async () => {
    if (APPLY && pending.length) await MedicineRelation.insertMany(pending, { ordered: false });
    pending = [];
  };

  /** Rows per kind, so a `--limit` run can say how many it never reached. */
  const kindTotals = new Map<string, number>();
  for (const row of db
    .prepare('select type, count(*) as total from relations group by type')
    .all() as unknown as Array<{ type: string; total: number }>) {
    kindTotals.set(row.type, row.total);
  }

  for (const [sourceType, kind] of RELATION_KINDS) {
    let seenForKind = 0;
    let currentFrom = -1;
    let currentFromId: mongoose.Types.ObjectId | undefined;
    let items: Array<{ toId: mongoose.Types.ObjectId; rank: number }> = [];

    const closeDocument = () => {
      if (currentFromId && items.length) {
        pending.push({ fromId: currentFromId, kind, items, source: 'AROGGA', refreshedAt });
        report.documents += 1;
      }
      items = [];
    };

    const statement = db.prepare(
      'select from_id, to_id, rank from relations where type = ? order by from_id, rank',
    );
    for (const row of statement.iterate(sourceType) as Iterable<{
      from_id: number;
      to_id: number;
      rank: number;
    }>) {
      // The slice is a prefix of the id order, so everything past its last
      // member belongs to another run. Counted from the per-kind totals below.
      if (row.from_id > maxMemberId) break;
      seenForKind += 1;
      if (row.from_id !== currentFrom) {
        closeDocument();
        currentFrom = row.from_id;
        currentFromId = localId.get(row.from_id);
        if (pending.length >= 400) {
          await flushDocs();
          process.stdout.write(`\r  relations ${report.items}…`);
        }
      }
      if (!currentFromId) {
        // No medicine to hang the list on. Which reason is which matters to
        // the reconciliation table, so they are counted apart.
        if (refusedIds.has(row.from_id)) report.fromRefused += 1;
        else report.outsideRun += 1;
        continue;
      }
      const toId = localId.get(row.to_id);
      if (!toId) {
        // The product it points at was refused, so the suggestion has nowhere
        // to go. Dropped rather than written as a reference to nothing.
        if (refusedIds.has(row.to_id)) report.danglingEnd += 1;
        else report.pointsOutside += 1;
        continue;
      }
      items.push({ toId, rank: row.rank });
      report.items += 1;
    }
    closeDocument();
    report.outsideRun += Math.max(0, (kindTotals.get(sourceType) ?? 0) - seenForKind);
  }
  await flushDocs();
  if (report.items >= 5000) process.stdout.write(`\r${' '.repeat(40)}\r`);
  return report;
}

// ─── Row reconciliation ──────────────────────────────────────────────────────

/**
 * Every source row's fate, counted at the moment it is decided.
 *
 * The summary at the end prints one line per fate per table and checks the sum
 * against the table's own row count. That check is the whole point: a row that
 * silently falls through a branch nobody counted shows up as a loud MISMATCH
 * rather than as a total that merely looks plausible. Fates are counted where
 * they happen, never derived by subtraction, except where a `--limit` run
 * genuinely never visits the rows (relations and the two CSVs, where the
 * remainder is the definition of "outside this run" and says so).
 */
const reconciliation = new Map<string, { rows: number | null; fates: Map<string, number> }>();

function account(table: string, fate: string, n = 1) {
  if (!n) return;
  const entry = reconciliation.get(table) ?? { rows: null, fates: new Map<string, number>() };
  entry.fates.set(fate, (entry.fates.get(fate) ?? 0) + n);
  reconciliation.set(table, entry);
}

function accountTotal(table: string, rows: number) {
  const entry = reconciliation.get(table) ?? { rows: null, fates: new Map<string, number>() };
  entry.rows = rows;
  reconciliation.set(table, entry);
}

/** Prints the table; returns false if any source row went unaccounted for. */
function printReconciliation(): boolean {
  console.log(`\n  ROW RECONCILIATION — every source row, accounted for`);
  let clean = true;
  for (const [table, { rows, fates }] of reconciliation) {
    const accounted = [...fates.values()].reduce((sum, n) => sum + n, 0);
    console.log(`\n  ${table.padEnd(24)} ${String(rows ?? accounted).padStart(10)} rows`);
    for (const [fate, n] of [...fates].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(n).padStart(10)}  ${fate}`);
    }
    if (rows !== null && accounted !== rows) {
      clean = false;
      console.log(
        `      !! MISMATCH: ${accounted} accounted for, the source holds ${rows} — ` +
          `a row fell through a branch nothing counted`,
      );
    } else {
      console.log(`      ${'='.padStart(10)}  all ${rows ?? accounted} accounted for`);
    }
  }
  console.log(
    `\n  (runs: 1 row and failures: 0 rows are the scraper's own bookkeeping and stay in the bundle.)`,
  );
  return clean;
}

// ─── The archive and the monograph ───────────────────────────────────────────

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * A merge cursor over a table sorted by `product_id`.
 *
 * The archive pass walks products in id order, and each sibling table is read
 * once, sorted the same way, so "this product's rows" is a pointer advance
 * rather than 57,033 unindexed queries — the source database carries no index
 * on `product_id` for most of these tables, so per-product `WHERE` would be
 * 57,033 full scans.
 *
 * Rows that sort *before* the product being asked for would mean a product id
 * the run has never seen; measured zero everywhere, but counted rather than
 * assumed so the reconciliation cannot silently swallow one.
 */
function tableCursor<T extends { product_id: number }>(rows: Iterator<T>) {
  let current = rows.next();
  const cursor = {
    skipped: 0,
    take(productId: number): T[] {
      while (!current.done && current.value.product_id < productId) {
        cursor.skipped += 1;
        current = rows.next();
      }
      const matched: T[] = [];
      while (!current.done && current.value.product_id === productId) {
        matched.push(current.value);
        current = rows.next();
      }
      return matched;
    },
    /** Rows never claimed — a `--limit` run's leftovers, counted for real. */
    drain(): number {
      let n = cursor.skipped;
      while (!current.done) {
        n += 1;
        current = rows.next();
      }
      return n;
    },
  };
  return cursor;
}

interface ComputedRelationRow {
  from_id: number;
  to_id: number;
  type: string;
  rank: number;
  basis: string;
}

/**
 * `computed_relations.csv`, queryable by product — 2,550,388 rows that go to
 * the archive and **only** the archive. They are derived from `generic_id`,
 * `category_id` and `brand_id`, all of which the catalogue stores, so they
 * carry no information the live collections would not still hold — and the
 * query version cannot go stale when a product is delisted, where this
 * snapshot can.
 *
 * The file is not sorted by `from_id` (it is written in per-basis blocks), so
 * the merge cursor the sqlite tables use cannot work here. A full run streams
 * it once into an in-memory sqlite table behind an index — a few seconds and
 * ~100 MB, against the alternative of 2.5 million JS objects held in V8. A
 * `--limit` run keeps only the slice's rows in a Map instead, so a 20-product
 * dry run is not taxed for an index it would use twenty times.
 */
async function loadComputedRelations(
  dataDirectory: string,
  members: Set<number> | null,
): Promise<{
  total: number;
  rowsFor(productId: number): ComputedRelationRow[];
  close(): void;
} | null> {
  const file = join(dataDirectory, 'computed_relations.csv');
  if (!existsSync(file)) return null;

  const byMember = new Map<number, ComputedRelationRow[]>();
  const store = members ? null : new DatabaseSync(':memory:');
  const insert = store
    ? (store.exec(
        'create table rows (from_id integer, to_id integer, type text, rank integer, basis text)',
      ),
      store.prepare('insert into rows values (?, ?, ?, ?, ?)'))
    : null;
  if (store) store.exec('begin');

  let header: string[] | null = null;
  let column: Record<string, number> = {};
  let total = 0;
  const feeder = csvFeeder((row) => {
    if (!header) {
      header = row;
      column = Object.fromEntries(row.map((name, index) => [name, index]));
      return;
    }
    if (row.length < header.length) return;
    total += 1;
    const parsed: ComputedRelationRow = {
      from_id: Number(row[column.from_id!]),
      to_id: Number(row[column.to_id!]),
      type: row[column.type!] ?? '',
      rank: Number(row[column.rank!]),
      basis: row[column.basis!] ?? '',
    };
    if (insert && store) {
      insert.run(parsed.from_id, parsed.to_id, parsed.type, parsed.rank, parsed.basis);
      if (total % 100_000 === 0) {
        store.exec('commit');
        store.exec('begin');
      }
    } else if (members?.has(parsed.from_id)) {
      const list = byMember.get(parsed.from_id) ?? [];
      list.push(parsed);
      byMember.set(parsed.from_id, list);
    }
  });
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    feeder.push(chunk as string);
  }
  feeder.end();
  if (store) {
    store.exec('commit');
    store.exec('create index ix_rows_from on rows(from_id)');
  }
  const query = store?.prepare(
    'select from_id, to_id, type, rank, basis from rows where from_id = ?',
  );

  return {
    total,
    rowsFor(productId: number): ComputedRelationRow[] {
      if (query) return query.all(productId) as unknown as ComputedRelationRow[];
      return byMember.get(productId) ?? [];
    },
    close() {
      store?.close();
    },
  };
}

interface ArchivePassContext {
  db: DatabaseSync;
  dataDirectory: string;
  names: Map<number, string>;
  localId: Map<number, mongoose.Types.ObjectId>;
  refusedIds: Set<number>;
  copiedImages: Set<string>;
  absentImages: Set<string>;
  record: (error: unknown) => void;
}

interface ArchivePassStats {
  archived: number;
  unparseable: number;
  enDocuments: number;
  bnDocuments: number;
  sections: number;
}

/**
 * The third pass: the complete source record into `CatalogueSourceRecord`, and
 * the monograph into `MedicineContent` — one ordered walk over the products,
 * shared by both, because both need the same sibling rows.
 *
 * **Every** product is archived, including the ~1,000 the catalogue refuses:
 * the archive is the record of what the supplier said, not of what we accepted,
 * and the refused rows are precisely the ones a later fix would want to re-read
 * without a re-scrape. The monograph is written only for accepted products —
 * `MedicineContent` hangs off a medicine that must exist.
 *
 * Memory is the binding constraint and the reason for every `iterate()` here:
 * `raw_json` averages 55 KB and totals 3.1 GB, so products stream one at a
 * time and flush in batches of {@link ARCHIVE_BATCH}; at no point does more
 * than one batch of parsed records exist.
 */
const ARCHIVE_BATCH = 100;

async function archiveAndMonographs(context: ArchivePassContext): Promise<ArchivePassStats> {
  const { db, names, localId, refusedIds, copiedImages, absentImages } = context;
  const stats: ArchivePassStats = {
    archived: 0,
    unparseable: 0,
    enDocuments: 0,
    bnDocuments: 0,
    sections: 0,
  };

  /*
   * The sibling tables, each read once in product order. `select *` on images
   * is deliberate: the archive's job is the columns the raw JSON does *not*
   * carry — `local_path`, `logo_bbox`, `logo_confidence`, `is_placeholder` —
   * and naming them individually is how one gets lost in a later export.
   */
  const images = tableCursor(
    db.prepare('select * from images order by product_id').iterate() as Iterator<
      Record<string, unknown> & {
        product_id: number;
        is_placeholder: number;
        local_path: string | null;
      }
    >,
  );
  const seo = tableCursor(
    db
      .prepare('select id, product_id, heading, text from seo_sections order by product_id, id')
      .iterate() as Iterator<{
      id: number;
      product_id: number;
      heading: string;
      text: string | null;
    }>,
  );
  const faq = tableCursor(
    db
      .prepare('select id, product_id, question, answer from faq order by product_id, id')
      .iterate() as Iterator<{ id: number; product_id: number; question: string; answer: string }>,
  );
  const productCategories = tableCursor(
    db
      .prepare(
        'select product_id, category_id, position from product_categories order by product_id, position',
      )
      .iterate() as Iterator<{ product_id: number; category_id: number; position: number }>,
  );

  /*
   * The category rows themselves are joined in beside each product that uses
   * them, so an archived record is readable without the bundle. All 1,204 are
   * referenced by at least one product, so embedding loses none of them.
   */
  const categoryById = new Map<number, Record<string, unknown>>();
  for (const row of db
    .prepare('select category_id, name, slug, url, level from categories')
    .all() as unknown as Array<Record<string, unknown> & { category_id: number }>) {
    categoryById.set(row.category_id, row);
  }
  const categoriesUsed = new Set<number>();

  const computed = await loadComputedRelations(
    context.dataDirectory,
    LIMIT ? new Set(names.keys()) : null,
  );
  let computedMemberRows = 0;

  /** The five distinct Q&As, verified: `285,165 = 5 × 57,033`, one set each. */
  const faqDistinct = new Set<string>();
  let faqMemberRows = 0;

  let archiveOps: Array<Record<string, unknown>> = [];
  let monographs: Array<Record<string, unknown>> = [];
  let monographOwners: mongoose.Types.ObjectId[] = [];

  const flush = async () => {
    if (APPLY && archiveOps.length) {
      try {
        await CatalogueSourceRecord.bulkWrite(archiveOps as never[], { ordered: false });
      } catch (error) {
        context.record(error);
      }
    }
    if (APPLY && monographOwners.length) {
      try {
        /*
         * Delete-then-insert rather than upsert, for the sibling that stops
         * existing: a product whose Bengali copy vanishes from the source must
         * lose its stale `bn` document, and an upsert would leave it standing.
         */
        await MedicineContent.deleteMany({ medicineId: { $in: monographOwners } });
        if (monographs.length) await MedicineContent.insertMany(monographs, { ordered: false });
      } catch (error) {
        context.record(error);
      }
    }
    archiveOps = [];
    monographs = [];
    monographOwners = [];
  };

  const productStatement = db.prepare(
    'select product_id, name, raw_json, description_html, description_structured, scraped_at ' +
      'from products order by product_id' +
      (LIMIT ? ` limit ${LIMIT}` : ''),
  );

  for (const product of productStatement.iterate() as Iterable<{
    product_id: number;
    name: string;
    raw_json: string;
    description_html: string | null;
    description_structured: string | null;
    scraped_at: string;
  }>) {
    const productId = product.product_id;
    const medicineId = localId.get(productId);
    const accepted = medicineId !== undefined;
    const productName = names.get(productId) ?? product.name;
    const scrapedAt = new Date(product.scraped_at);

    const imageRows = images.take(productId);
    const seoRows = seo.take(productId);
    const faqRows = faq.take(productId);
    const categoryRows = productCategories.take(productId);
    const computedRows = computed ? computed.rowsFor(productId) : [];
    computedMemberRows += computedRows.length;

    for (const row of imageRows) {
      if (row.is_placeholder) {
        account('images', 'folded — placeholder art became hasSupplierPhoto: false');
      } else if (copiedImages.has(`${productId} ${row.local_path}`)) {
        account('images', 'imported — copied into the media root');
      } else if (!accepted) {
        account('images', 'archived only — the product itself was refused');
      } else if (!WITH_IMAGES) {
        account('images', 'archived only (--no-images)');
      } else if (absentImages.has(`${productId} ${row.local_path}`)) {
        account('images', 'archived only — named by the export but absent from the bundle');
      } else {
        account('images', 'archived only — the export records no local file');
      }
    }

    for (const row of faqRows) {
      faqMemberRows += 1;
      faqDistinct.add(`${row.question} ${row.answer}`);
    }

    for (const row of categoryRows) {
      categoriesUsed.add(row.category_id);
      account(
        'product_categories',
        accepted
          ? 'imported — became categoryIds on the medicine'
          : 'archived only — the product itself was refused',
      );
    }

    /*
     * The monograph, assembled in the order a reader meets it: the four
     * structured groups, then the long-form body non-drug lines carry instead,
     * then the SEO prose. `position` keeps counting across the three sources
     * because it records the document's order, not the tables'.
     */
    const wantContent = accepted && WITH_DESCRIPTIONS;
    let structured: Record<string, unknown> | undefined;
    if (wantContent && product.description_structured) {
      try {
        structured = JSON.parse(product.description_structured) as Record<string, unknown>;
      } catch {
        noteAdjustment('description_structured would not parse, monograph left to the archive');
      }
    }

    const enSections = wantContent ? monographSections(structured, productName, 'en') : [];
    if (wantContent && product.description_html) {
      const body = passage(product.description_html, productName);
      if (body) {
        enSections.push({
          group: MedicineContentGroup.BODY,
          body,
          position: enSections.length,
        });
      }
    }
    for (const row of seoRows) {
      const kind = seoKind(row.heading);
      if (kind === 'boilerplate') {
        account('seo_sections', 'archived only — duplicates the faq and rating tables verbatim');
        continue;
      }
      if (kind === 'attribute') {
        account(
          'seo_sections',
          accepted
            ? 'folded — heading/value pairs became supplier attributes'
            : 'archived only — the product itself was refused',
        );
        continue;
      }
      if (!wantContent) {
        account(
          'seo_sections',
          accepted
            ? 'archived only (--no-descriptions)'
            : 'archived only — the product itself was refused',
        );
        continue;
      }
      const title = readable(row.heading, productName);
      const body = readable(row.text ?? '', productName);
      if (!body) {
        account('seo_sections', 'archived only — empty once markup was stripped');
        continue;
      }
      enSections.push({
        group: MedicineContentGroup.FEATURE,
        ...(title ? { title } : {}),
        body,
        position: enSections.length,
      });
      account('seo_sections', 'imported — became FEATURE sections of the monograph');
    }
    const bnSections = wantContent ? monographSections(structured, productName, 'bn') : [];

    if (wantContent) {
      // Cleared even when both lists are empty: idempotency includes forgetting.
      monographOwners.push(medicineId!);
      const source = { name: 'AROGGA', scrapedAt };
      if (enSections.length) {
        monographs.push({
          medicineId,
          lang: ContentLanguage.EN,
          sections: enSections,
          source,
        });
        stats.enDocuments += 1;
        stats.sections += enSections.length;
      }
      if (bnSections.length) {
        monographs.push({
          medicineId,
          lang: ContentLanguage.BN,
          sections: bnSections,
          source,
        });
        stats.bnDocuments += 1;
        stats.sections += bnSections.length;
      }
    }

    /*
     * The archive document. `raw` is the supplier's own nested record, parsed
     * and untouched; `aux` is the sibling rows that record what *our* pipeline
     * knows and theirs does not. The digest is of the source bytes, so "the
     * archive is faithful" is a hash comparison, not a promise.
     */
    /*
     * A record that will not parse is still archived, as bytes.
     *
     * This used to `continue`, which skipped the archive write — while the
     * product pass had already accounted that product as "imported into the
     * catalogue (and archived)". The reconciliation would therefore have
     * balanced *while losing the record*, which is the one failure this whole
     * archive exists to make impossible. Now the bytes are kept under
     * `rawText`, the fate is its own line in the table, and the run exits
     * non-zero so nobody reads the balance as a clean bill of health.
     */
    let raw: unknown;
    let rawText: string | undefined;
    const bytes = typeof product.raw_json === 'string' ? product.raw_json : '';
    try {
      if (!bytes) throw new Error('empty');
      raw = JSON.parse(bytes);
    } catch {
      stats.unparseable += 1;
      rawText = bytes;
      account('products', 'archived as raw bytes — the supplier record would not parse');
      process.exitCode = 1;
    }
    archiveOps.push({
      replaceOne: {
        filter: { source: 'AROGGA', sourceId: String(productId) },
        replacement: {
          source: 'AROGGA',
          sourceId: String(productId),
          scrapedAt,
          digest: sha256(bytes),
          raw,
          rawText,
          aux: {
            images: imageRows.length ? imageRows : undefined,
            seoSections: seoRows.length ? seoRows : undefined,
            faq: faqRows.length ? faqRows : undefined,
            computedRelations: computedRows.length ? computedRows : undefined,
            categories: categoryRows.length
              ? categoryRows.map((row) => ({
                  ...row,
                  ...(categoryById.get(row.category_id) ?? {}),
                }))
              : undefined,
          },
        },
        upsert: true,
      },
    });
    stats.archived += 1;

    if (archiveOps.length >= ARCHIVE_BATCH) {
      await flush();
      if (stats.archived % 2000 < ARCHIVE_BATCH) {
        process.stdout.write(`\r  archiving ${stats.archived}…`);
      }
    }
  }
  await flush();
  if (stats.archived >= 2000) process.stdout.write(`\r${' '.repeat(40)}\r`);

  // What the walk never reached — drained and counted, not inferred.
  account('images', 'outside this run (--limit)', images.drain());
  account('seo_sections', 'outside this run (--limit)', seo.drain());
  account('product_categories', 'outside this run (--limit)', productCategories.drain());
  const faqOutside = faq.drain();
  account(
    'faq',
    `imported — the ${faqDistinct.size} distinct question–answer pairs, archived with every product`,
    faqDistinct.size,
  );
  account(
    'faq',
    'folded — the same five repeated verbatim on every product',
    faqMemberRows - faqDistinct.size,
  );
  account('faq', 'outside this run (--limit)', faqOutside);
  account(
    'categories',
    'folded — archived, joined beside every product that uses them',
    categoriesUsed.size,
  );
  account(
    'categories',
    'referenced only by products outside this run',
    categoryById.size - categoriesUsed.size,
  );
  accountTotal('categories', categoryById.size);
  if (computed) {
    account(
      'computed_relations.csv',
      'archived only — derivable from fields the catalogue stores',
      computedMemberRows,
    );
    account(
      'computed_relations.csv',
      'outside this run (--limit)',
      computed.total - computedMemberRows,
    );
    accountTotal('computed_relations.csv', computed.total);
    computed.close();
  }

  return stats;
}

// ─── Reporting ───────────────────────────────────────────────────────────────

interface Skipped {
  productId: number;
  name: string;
  type: string;
  reason: string;
}

/**
 * Both spellings, `--limit=25` and `--limit 25`.
 *
 * Only the `=` form used to parse, and the space form did not error — it fell
 * through to "no limit", which on this importer means the difference between a
 * 20-row dry run and fifty-seven thousand products with three and a half
 * million relations. A flag that half-works is worse than one that refuses.
 */
function argValue(flag: string): string | undefined {
  const joined = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (joined) return joined.slice(flag.length + 1);
  const at = process.argv.indexOf(flag);
  const next = at >= 0 ? process.argv[at + 1] : undefined;
  return next && !next.startsWith('--') ? next : undefined;
}

const APPLY = process.argv.includes('--apply');
/** How many of each list to print before summarising the rest. */
const SAMPLE = 5;
const WITH_IMAGES = !process.argv.includes('--no-images');
const WITH_DESCRIPTIONS = !process.argv.includes('--no-descriptions');
const WITH_RELATIONS = !process.argv.includes('--no-relations');
const LIMIT = Number(argValue('--limit') ?? '0') || 0;
/**
 * Finds the bundle by walking up from wherever this file ended up.
 *
 * `__dirname` is `scripts/` in the source tree and `dist-scripts/scripts/` once
 * compiled, so a fixed number of `..` segments is right in exactly one of the
 * two places and silently wrong in the other. The export also arrives with the
 * zip's own nesting intact — `arogga_export (6)/arogga_export (5)/data` — which
 * is a shape nobody should have to type, and which changes with every
 * re-download. So: find the repository root, then find the database under it.
 *
 * Both spellings of the folder are tried. This looked only for the spaced form,
 * while the bundle on disk was `arogga_export` — so discovery failed on the one
 * layout anybody actually had, and `--source=` was mandatory without the error
 * message ever saying why.
 */
const BUNDLE_NAMES = ['arogga export', 'arogga_export'];

function findExport(): string {
  let directory = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    for (const name of BUNDLE_NAMES) {
      const candidate = join(directory, name);
      if (!existsSync(candidate)) continue;
      const found = search(candidate, 4);
      if (found) return found;
    }
    directory = resolve(directory, '..');
  }
  return '';
}

function search(directory: string, depth: number): string {
  if (depth < 0) return '';
  const direct = join(directory, 'data', 'arogga.sqlite');
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = search(join(directory, entry.name), depth - 1);
    if (found) return found;
  }
  return '';
}

const SOURCE = argValue('--source') ?? findExport();

async function main() {
  if (!SOURCE || !existsSync(SOURCE)) {
    throw new Error(
      'Could not find arogga.sqlite. Pass --source=<path>, or unzip the bundle into ' +
        `an ${BUNDLE_NAMES.map((name) => `"${name}"`).join(' or ')} folder at the repository root.`,
    );
  }

  const db = new DatabaseSync(SOURCE, { readOnly: true });

  const products = db
    .prepare(
      `select product_id, name, full_name, slug, type, form, strength, generic_id, generic_name,
              brand_name, manufacturer, rx_required, cold_chain, dhaka_only, availability,
              category_path, mrp, price, view_count, rating_count, tags,
              short_description, url, scraped_at
         from products order by product_id` + (LIMIT ? ` limit ${LIMIT}` : ''),
    )
    .all() as unknown as SourceProduct[];

  /**
   * The slice this run covers. `--limit` takes a prefix of the id order, which
   * is what lets every streamed sibling table stop at `maxMemberId` instead of
   * being read to the end for a 20-product dry run.
   */
  const names = new Map(products.map((product) => [product.product_id, product.name]));
  const maxMemberId = products.length ? products[products.length - 1]!.product_id : -1;

  /** Source row counts, taken up front — the reconciliation is checked against these. */
  const countOf = (table: string) =>
    (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  accountTotal('products', countOf('products'));
  accountTotal('variants', countOf('variants'));
  accountTotal('images', countOf('images'));
  accountTotal('faq', countOf('faq'));
  accountTotal('seo_sections', countOf('seo_sections'));
  accountTotal('relations', countOf('relations'));
  accountTotal('product_categories', countOf('product_categories'));

  const variants = new Map<number, SourceVariant>();
  for (const row of db
    .prepare('select * from variants where is_base = 1')
    .all() as unknown as SourceVariant[]) {
    variants.set(row.product_id, row);
  }

  const imagesByProduct = new Map<number, SourceImage[]>();
  for (const row of db
    .prepare(
      'select product_id, position, local_path, is_placeholder, logo_removed, logo_residual, ' +
        'logo_confidence from images where is_placeholder = 0 order by product_id, position',
    )
    .all() as unknown as SourceImage[]) {
    const list = imagesByProduct.get(row.product_id) ?? [];
    list.push(row);
    imagesByProduct.set(row.product_id, list);
  }

  /*
   * Whether the supplier has a real photograph, from the whole images table —
   * including the placeholder rows the gallery query above rightly excludes.
   * 8,471 of 90,764 rows are the grey "no image" graphic; the fact worth
   * keeping is "they have no photo of this", not the graphic itself.
   */
  const photoFacts = new Map<number, { pictures: number; placeholders: number }>();
  for (const row of db
    .prepare(
      'select product_id, count(*) as pictures, sum(is_placeholder) as placeholders ' +
        'from images group by product_id',
    )
    .all() as unknown as Array<{ product_id: number; pictures: number; placeholders: number }>) {
    photoFacts.set(row.product_id, { pictures: row.pictures, placeholders: row.placeholders });
  }

  /** The supplier's category ids per product, in their display order. */
  const categoriesOf = new Map<number, number[]>();
  for (const row of db
    .prepare('select product_id, category_id from product_categories order by product_id, position')
    .all() as unknown as Array<{ product_id: number; category_id: number }>) {
    const list = categoriesOf.get(row.product_id) ?? [];
    list.push(row.category_id);
    categoriesOf.set(row.product_id, list);
  }

  const seoAttributes = collectSeoAttributes(db, names, maxMemberId);

  /** Everything the bundle references is relative to the database's own folder. */
  const dataDirectory = dirname(SOURCE);

  const summaries = WITH_DESCRIPTIONS
    ? await loadDescriptions(dataDirectory, names)
    : { byProduct: new Map<number, string>(), rows: 0, contributed: 0 };
  const descriptions = summaries.byProduct;
  if (WITH_DESCRIPTIONS && summaries.rows) {
    account(
      'descriptions.csv',
      'folded into the 2,000-character description summary',
      summaries.contributed,
    );
    account(
      'descriptions.csv',
      'archived only — the same passages, unflattened, live in raw_json.description',
      summaries.rows - summaries.contributed,
    );
    accountTotal('descriptions.csv', summaries.rows);
  }

  await mongoose.connect(env.MONGODB_URI);

  /*
   * Every catalogue row records who put it there, and an import is somebody.
   *
   * Attributing 49,000 products to whichever administrator happened to be first
   * in the collection would be a lie the audit log then repeats, so this looks
   * for a dedicated importer account and falls back to a named administrator
   * only if there is not one — and says which it used.
   */
  const importer =
    (await User.findOne({ email: 'catalogue-import@medsupply.local' })) ??
    (await User.findOne({ role: { $in: [UserRole.SUPER_ADMIN, UserRole.ADMIN] } }));
  if (!importer) {
    throw new Error(
      'No administrator to attribute the import to. Run `pnpm --filter @medsupply/api bootstrap` first.',
    );
  }

  const skipped: Skipped[] = [];
  const needsReview: string[] = [];
  /** Reviewed entries this run actually met, so a stale one can be named. */
  const settledResidue = new Set<string>();
  const imagesMissing: string[] = [];
  let imagesPlaced = 0;
  let noCostPrice = 0;
  /** Products kept in the catalogue but switched off for having no price. */
  let zeroPriced = 0;
  /** Source ids this run refused — the reconciliation needs them by name. */
  const refusedIds = new Set<number>();
  /**
   * Which image files actually landed, keyed `productId localPath` — written
   * here, read by the archive pass so each images row gets exactly one fate.
   */
  const copiedImages = new Set<string>();
  const absentImages = new Set<string>();

  /*
   * Which products this catalogue already holds, in one query rather than one
   * per row.
   *
   * The upsert used to be `findOne` then `create`, which is unremarkable at the
   * sample size this was written against and is 55,998 round trips at full
   * scale — before the reference counter adds another one each. Loading the
   * existing external ids costs a single indexed read of a projection.
   */
  const existingByExternalId = new Map<string, mongoose.Types.ObjectId>();
  for (const row of await Medicine.find(
    { 'externalRef.source': 'AROGGA' },
    { _id: 1, 'externalRef.id': 1 },
  ).lean()) {
    const id = (row as { externalRef?: { id?: string } }).externalRef?.id;
    if (id) existingByExternalId.set(String(id), row._id as mongoose.Types.ObjectId);
  }

  /**
   * The source's product id to ours.
   *
   * Built whether or not `--apply` is passed, because it is what the relation
   * pass resolves `to_id` through, and a dry run has to be able to report how
   * many relations *would* land rather than guessing. Ids for new products are
   * minted here rather than read back after insertion — an `ObjectId` is
   * client-generated by design, and waiting for 55,998 of them to come back
   * from the server would reintroduce exactly the round trip this removes.
   */
  const localId = new Map<number, mongoose.Types.ObjectId>();

  const WRITE_BATCH = 1000;
  let pendingCreates: Record<string, unknown>[] = [];
  let pendingUpdates: Array<{ id: mongoose.Types.ObjectId; document: Record<string, unknown> }> =
    [];
  let createdCount = 0;
  let updatedCount = 0;
  const sampleCreated: string[] = [];
  const sampleUpdated: string[] = [];

  /*
   * A write that fails is counted, not fatal.
   *
   * This run copies four gigabytes of photography and writes a million rows; a
   * single rejected document thirty minutes in must not throw away the other
   * fifty-five thousand. `ordered: false` already tells the server to carry on
   * past a bad row, but the driver still raises afterwards, so the raise is
   * caught, the count is kept, and the summary reports it beside everything
   * else that did not go in.
   */
  const writeFailures: string[] = [];
  function record(error: unknown) {
    const bulk = error as { writeErrors?: Array<{ errmsg?: string }>; message?: string };
    for (const failure of bulk.writeErrors ?? []) {
      if (writeFailures.length < 20) writeFailures.push(failure.errmsg ?? 'unknown write error');
    }
    if (!bulk.writeErrors?.length && writeFailures.length < 20) {
      writeFailures.push(bulk.message ?? String(error));
    }
  }

  async function flush() {
    if (APPLY && pendingCreates.length) {
      // One `$inc` for the whole batch. See `reserveReferences`.
      const references = await reserveReferences('MED', pendingCreates.length);
      try {
        await Medicine.insertMany(
          pendingCreates.map((document, index) => ({ ...document, reference: references[index] })),
          { ordered: false },
        );
      } catch (error) {
        record(error);
      }
    }
    if (APPLY && pendingUpdates.length) {
      try {
        await Medicine.bulkWrite(
          pendingUpdates.map(({ id, document }) => ({
            updateOne: { filter: { _id: id }, update: { $set: document } },
          })),
          { ordered: false },
        );
      } catch (error) {
        record(error);
      }
    }
    pendingCreates = [];
    pendingUpdates = [];
  }

  let seen = 0;
  for (const product of products) {
    seen += 1;
    if (seen % 5000 === 0) {
      process.stdout.write(`\r  mapping ${seen}/${products.length}…`);
    }
    const variant = variants.get(product.product_id);
    if (!variant) {
      refusedIds.add(product.product_id);
      account('products', 'refused — no base variant, archived whole');
      skipped.push({
        productId: product.product_id,
        name: product.name,
        type: product.type,
        reason: 'no base variant, so there is no price or pack to import',
      });
      continue;
    }

    /*
     * Every photograph, not only the first.
     *
     * This took `position === 1` and dropped the rest, so 36,000 pictures in the
     * bundle went nowhere and a pharmacy choosing between two similar packs saw
     * one angle of each. `position` is the supplier's display order, so sorting
     * on it is what makes the gallery open on the shot they consider the front
     * of the box.
     */
    const images = [...(imagesByProduct.get(product.product_id) ?? [])].sort(
      (left, right) => left.position - right.position,
    );

    const photo = photoFacts.get(product.product_id);
    const mapped = mapProduct(product, variant, {
      attributes: mergeAttributes(
        variantAttributes(variant),
        seoAttributes.get(product.product_id) ?? [],
      ),
      categoryIds: categoriesOf.get(product.product_id),
      hasSupplierPhoto: photo ? photo.pictures - photo.placeholders > 0 : false,
    });
    if (WITH_DESCRIPTIONS && descriptions.has(product.product_id)) {
      mapped.fields.description = descriptions.get(product.product_id)!;
    }

    /*
     * Probed here, copied only after the schema says yes. The first version
     * copied during mapping, so a product the parse then refused had already
     * left its photographs in the media root — orphan files nothing served and
     * a reconciliation line nobody could make add up.
     */
    const galleryFiles: string[] = [];
    const galleryMissing: string[] = [];
    if (WITH_IMAGES) {
      const gallery: string[] = [];
      for (const image of images) {
        if (!image.local_path) continue;
        const served = placeImage(dataDirectory, image.local_path, product.product_id, false);
        if (served) {
          gallery.push(served);
          galleryFiles.push(image.local_path);
        } else {
          // The database names a file the bundle does not contain. Counted
          // rather than fatal — the row is still a product, it just has one
          // photograph fewer — but reported, because a bundle that has lost its
          // images is worth knowing about before somebody blames the screen.
          galleryMissing.push(image.local_path);
        }
      }
      if (gallery.length) {
        // The two are set together, here and nowhere else. `productImageUrl`
        // mirrors the first entry; see the note on the model.
        mapped.fields.productImages = gallery;
        mapped.fields.productImageUrl = gallery[0];
      }
    }

    // Assets go through the same schema as everything else. Bolting them on
    // after the parse would make them the one part of an imported row that
    // nothing checked.
    const parsed = CreateMedicineSchema.safeParse(mapped.fields);
    if (!parsed.success) {
      // The API's own rules, reported as the reason. A product rejected here is
      // one a person could not have entered through the form either.
      const reason = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      refusedIds.add(product.product_id);
      account('products', 'refused — the schema said no, archived whole');
      skipped.push({
        productId: product.product_id,
        name: product.name,
        type: product.type,
        reason,
      });
      continue;
    }
    account('products', 'imported into the catalogue (and archived)');

    if (WITH_IMAGES) {
      for (const file of galleryFiles) {
        placeImage(dataDirectory, file, product.product_id, APPLY);
        copiedImages.add(`${product.product_id} ${file}`);
        imagesPlaced += 1;
      }
      for (const file of galleryMissing) {
        absentImages.add(`${product.product_id} ${file}`);
        if (imagesMissing.length < 20) imagesMissing.push(`${product.product_id} ${file}`);
      }
    }

    for (const image of images) {
      if (image.logo_residual !== 1) continue;
      if (image.local_path && LOGO_RESIDUE_REVIEWED[image.local_path]) {
        settledResidue.add(image.local_path);
        continue;
      }
      needsReview.push(
        `${product.product_id} ${product.name}\n        ${image.local_path}` +
          `\n        confidence ${image.logo_confidence ?? '(none)'}, position ${image.position}` +
          (galleryFiles[0] === image.local_path
            ? '  — THIS IS THE PRIMARY PHOTOGRAPH'
            : '  — a gallery image, not the one on the card'),
      );
    }

    /*
     * `isActive` is ours again. The previous import wrote
     * `availability === 'in_stock'` here, which handed a competitor's warehouse
     * the decision over which products our shops may browse — 24,188 lines
     * switched off by their stock on the day of the scrape. Their availability
     * now lives in `listedElsewhere`, dated; the only imports that arrive
     * switched off are the zero-price rows, which cannot be purchased and
     * would otherwise be orderable at ৳0.00.
     */
    const priced =
      (parsed.data as { defaultSellingPriceMinor: number }).defaultSellingPriceMinor > 0;
    if (!priced) zeroPriced += 1;
    const document: Record<string, unknown> = {
      ...parsed.data,
      isActive: priced,
      externalRef: { source: 'AROGGA', id: mapped.externalId },
      createdBy: importer._id,
    };
    // Cost is not in the export at all. Recorded equal to the trade price so
    // margin reads as zero — visibly unknown — rather than as a plausible
    // figure nobody entered. A goods receipt supplies the real one.
    noCostPrice += 1;

    const existing = existingByExternalId.get(mapped.externalId);

    if (existing) {
      localId.set(product.product_id, existing);
      updatedCount += 1;
      if (sampleUpdated.length < SAMPLE) sampleUpdated.push(`${mapped.sku} ${product.name}`);
      pendingUpdates.push({ id: existing, document });
    } else {
      const minted = new mongoose.Types.ObjectId();
      localId.set(product.product_id, minted);
      createdCount += 1;
      if (sampleCreated.length < SAMPLE) sampleCreated.push(`${mapped.sku} ${product.name}`);
      pendingCreates.push({ ...document, _id: minted });
    }

    if (pendingCreates.length + pendingUpdates.length >= WRITE_BATCH) await flush();
  }
  await flush();
  if (seen >= 5000) process.stdout.write(`\r${' '.repeat(40)}\r`);

  account('products', 'outside this run (--limit)', reconciliation.get('products')!.rows! - seen);

  /*
   * Variant rows, each to its fate. Counted by streaming the whole table even
   * under `--limit` — 57,113 rows cost nothing, and a count that is *observed*
   * keeps the reconciliation check honest where a subtraction would always
   * balance by construction.
   */
  for (const row of db.prepare('select product_id, is_base from variants').iterate() as Iterable<{
    product_id: number;
    is_base: number;
  }>) {
    if (!names.has(row.product_id)) {
      account('variants', 'outside this run (--limit)');
    } else if (row.is_base === 1 && localId.has(row.product_id)) {
      account('variants', 'imported — price, pack and demand folded into the medicine');
    } else {
      account('variants', 'archived only — inside raw_json.variants');
    }
  }

  const relations = WITH_RELATIONS
    ? await importRelations(db, localId, refusedIds, maxMemberId)
    : undefined;
  if (relations) {
    account('relations', 'imported — ranked items in per-(product, kind) lists', relations.items);
    account(
      'relations',
      'refused — points at a product the catalogue refused',
      relations.danglingEnd,
    );
    account(
      'relations',
      'refused — starts from a product the catalogue refused',
      relations.fromRefused,
    );
    account('relations', 'points at a product outside this run (--limit)', relations.pointsOutside);
    account('relations', 'outside this run (--limit)', relations.outsideRun);
  } else {
    account('relations', 'skipped (--no-relations)', reconciliation.get('relations')!.rows!);
  }

  const archive = await archiveAndMonographs({
    db,
    dataDirectory,
    names,
    localId,
    refusedIds,
    copiedImages,
    absentImages,
    record,
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  const mode = APPLY ? 'APPLIED' : 'DRY RUN — nothing was written';
  console.log(`\n  Arogga catalogue import — ${mode}`);
  console.log(`  source: ${SOURCE}`);
  console.log(`  attributed to: ${importer.email}\n`);

  const verb = APPLY ? '' : 'would ';
  console.log(`  ${verb}create : ${createdCount}`);
  for (const line of sampleCreated) console.log(`      + ${line}`);
  if (createdCount > sampleCreated.length) {
    console.log(`      … and ${createdCount - sampleCreated.length} more`);
  }
  console.log(`  ${verb}update : ${updatedCount}`);
  for (const line of sampleUpdated) console.log(`      ~ ${line}`);
  if (updatedCount > sampleUpdated.length) {
    console.log(`      … and ${updatedCount - sampleUpdated.length} more`);
  }

  /*
   * Skips grouped by reason rather than listed.
   *
   * At the sample size this was written against, 1,285 skipped rows printed as
   * 2,570 lines of scrollback that nobody reads to the end of — and the thing
   * worth knowing is not which product was refused, it is *what kind of thing*
   * is being refused and how often. The ids are still there, a few per reason,
   * so any one of them can be looked up in the source.
   */
  console.log(`\n  skipped      : ${skipped.length}`);
  const byReason = new Map<string, Skipped[]>();
  for (const row of skipped) {
    const list = byReason.get(row.reason) ?? [];
    list.push(row);
    byReason.set(row.reason, list);
  }
  for (const [reason, rows] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`      ${String(rows.length).padStart(6)}  ${reason}`);
    console.log(
      `              e.g. ${rows
        .slice(0, 3)
        .map((row) => `${row.productId} [${row.type}] ${row.name.slice(0, 40)}`)
        .join(' · ')}`,
    );
  }

  if (writeFailures.length) {
    console.log(`\n  REFUSED BY THE DATABASE — these did not go in:`);
    for (const line of writeFailures) console.log(`      ! ${line}`);
  }

  if (adjustments.size) {
    console.log(`\n  reshaped to fit (imported, but not exactly as supplied):`);
    for (const [what, count] of [...adjustments].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(count).padStart(6)}  ${what}`);
    }
  }

  if (unmappedTypes.size) {
    console.log(`\n  SHELF UNKNOWN — the source type maps to nothing, so the trail decided:`);
    for (const [type, count] of [...unmappedTypes].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(count).padStart(6)}  ${type}`);
    }
    console.log(
      `      Resolved from the head of category_path via SHELVES_BY_TRAIL, or MEDICINE if\n` +
        `      that is unknown too. Add to SHELVES if any of these is a shelf of its own.`,
    );
  }

  console.log(`\n  notes`);
  console.log(
    `    cost price is absent from the export; ${noCostPrice} rows take the trade price,`,
  );
  console.log(`    so margin reads as zero until a goods receipt supplies the real figure.`);
  console.log(
    `    ${zeroPriced} zero-price rows ${verb}stay inactive — unpurchasable at Taka 0.00;`,
  );
  console.log(`    everything else arrives active, whatever the supplier's own stock said.`);
  if (WITH_IMAGES) {
    console.log(
      `    images       : ${imagesPlaced} ${APPLY ? 'copied to' : 'would be copied to'} ${mediaRoot}`,
    );
    console.log(`                   served at ${MEDIA_PREFIX}/catalogue/arogga/<product>/<file>`);
    if (imagesMissing.length) {
      console.log(
        `                   ${imagesMissing.length} named by the database but not present:`,
      );
      for (const line of imagesMissing) console.log(`                     ? ${line}`);
    }
  } else {
    console.log(`    images       : skipped (--no-images)`);
  }
  if (WITH_DESCRIPTIONS) {
    console.log(
      `    monographs   : ${archive.enDocuments} English + ${archive.bnDocuments} Bangla documents, ` +
        `${archive.sections} sections, ${APPLY ? 'written' : 'would be written'} whole`,
    );
    console.log(
      `                   supplier copy, labelled with provenance on screen — never cut to fit`,
    );
  } else {
    console.log(`    monographs   : skipped (--no-descriptions)`);
  }
  if (relations) {
    console.log(
      `    relations    : ${relations.documents} (product, kind) lists holding ` +
        `${relations.items} ranked items ${APPLY ? 'written' : 'would be written'} — ` +
        `all four kinds, every rank kept`,
    );
    console.log(
      `                   ${relations.danglingEnd + relations.fromRefused} rows dropped because ` +
        `an end was refused; PROMOTED is advertising and screens must label it so`,
    );
  } else {
    console.log(`    relations    : skipped (--no-relations)`);
  }
  console.log(
    `    archive      : ${archive.archived} complete source records ${APPLY ? 'kept' : 'would be kept'} in ` +
      `CatalogueSourceRecord, sha256-digested` +
      (archive.unparseable ? ` — ${archive.unparseable} rows of raw_json WOULD NOT PARSE` : ''),
  );
  if (needsReview.length) {
    console.log(`\n  REVIEW BY HAND — logo removal left a residue on these:`);
    for (const line of needsReview) console.log(`      ! ${line}`);
  }
  if (settledResidue.size) {
    console.log(
      `\n  ${settledResidue.size} residue flag(s) already looked at and settled ` +
        `— see LOGO_RESIDUE_REVIEWED for what was seen.`,
    );
  }
  /*
   * The rule that makes the list shrink. Without it a note about an image that
   * is no longer flagged — or no longer in the bundle — would outlive the
   * question it answered, and the list would only ever grow.
   */
  const stale = Object.keys(LOGO_RESIDUE_REVIEWED).filter((path) => !settledResidue.has(path));
  if (stale.length) {
    console.log(`\n  STALE REVIEW NOTES — the flag is gone, so delete these entries:`);
    for (const path of stale) console.log(`      ? ${path}`);
    process.exitCode = 1;
  }

  const reconciled = printReconciliation();
  if (!reconciled) {
    console.log(`\n  !! The reconciliation does not balance. Treat this run as suspect.`);
    process.exitCode = 1;
  }
  console.log('');

  db.close();
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
