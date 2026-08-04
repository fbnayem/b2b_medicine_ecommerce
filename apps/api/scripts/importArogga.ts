import 'dotenv/config';
import { resolve, join, sep, dirname } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import mongoose from 'mongoose';
import { MedicineClassification, ProductType, UserRole } from '@medsupply/shared-types';
import { CreateMedicineSchema } from '@medsupply/validation';
import { env } from '../src/env';
import { Medicine } from '../src/models/Medicine';
import { User } from '../src/models/User';
import { nextReference } from '../src/models/Counter';

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
 * Two things still need a person after this runs: `meta_title` and
 * `meta_description` in the source name Arogga outright and are deliberately
 * not imported, and a drug monograph is clinical text that should be reviewed
 * before it is shown to a customer as this business's own advice.
 */

// ─── What the export gives us ────────────────────────────────────────────────

interface SourceProduct {
  product_id: number;
  name: string;
  type: string;
  form: string | null;
  strength: string | null;
  generic_name: string | null;
  brand_name: string | null;
  manufacturer: string | null;
  rx_required: number;
  cold_chain: number;
  availability: string;
  category_path: string | null;
  mrp: number | null;
  price: number | null;
  short_description: string | null;
  url: string | null;
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
}

interface SourceImage {
  product_id: number;
  position: number;
  local_path: string | null;
  is_placeholder: number;
  logo_removed: number;
  logo_residual: number;
}

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
 * The pack, as this trade describes it.
 *
 * The export separates what a unit *is* from what is *sold* — a strip of ten
 * tablets is `base_unit=Tablet`, `sales_unit=Strip`, `units_per_pack=10` — and
 * those are our `packSize` and `unit` respectively. Where a product is sold as
 * itself (`600gm Jar` of both) the count adds nothing and is left off.
 */
function packOf(variant: SourceVariant): { packSize: string; unit: string } {
  const base = (variant.base_unit ?? '').trim();
  const sales = (variant.sales_unit ?? '').trim() || base;
  const per = variant.units_per_pack ?? 1;
  return {
    packSize: per > 1 && base ? `${per} ${base}` : base || sales,
    unit: sales || base,
  };
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
};

function shelfOf(product: SourceProduct): ProductType {
  return SHELVES[(product.type ?? '').toLowerCase()] ?? ProductType.MEDICINE;
}

/** `Medicine > Antimicrobial > Anti-Bacterial` → `Anti-Bacterial`. */
function leafCategory(path: string | null): string {
  const parts = (path ?? '')
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

interface Mapped {
  externalId: string;
  sku: string;
  fields: Record<string, unknown>;
}

function mapProduct(product: SourceProduct, variant: SourceVariant): Mapped {
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
      brandName: (product.name ?? '').trim(),
      genericName: (product.generic_name ?? '').trim() || undefined,
      /*
       * Their `brand_name` is our `manufacturer`.
       *
       * Not a slip: the export's `manufacturer` column is empty on every row,
       * and `brand_name` carries "The ACME Laboratories", "Renata Limited",
       * "Apex Pharma" — which is the manufacturer in our vocabulary. The
       * handoff says as much; this is the field that proves it.
       */
      manufacturer: (product.manufacturer || product.brand_name || '').trim(),
      strength: (product.strength ?? '').trim() || undefined,
      dosageForm: (product.form ?? '').trim() || undefined,
      packSize: pack.packSize,
      unit: pack.unit,
      category: leafCategory(product.category_path),
      costPriceMinor: tradeMinor,
      defaultSellingPriceMinor: tradeMinor,
      mrpMinor,
      minimumOrderQuantity: Math.max(1, variant.min_qty ?? 1),
      maximumOrderQuantity: variant.max_qty && variant.max_qty > 0 ? variant.max_qty : undefined,
      classification: product.rx_required
        ? MedicineClassification.PRESCRIPTION
        : MedicineClassification.OTC,
      coldChain: Boolean(product.cold_chain),
    },
  };
}

// ─── Descriptions ────────────────────────────────────────────────────────────

/**
 * RFC 4180, because the descriptions are HTML and HTML is full of commas.
 *
 * `split(',')` would tear a description apart at the first comma inside a
 * quoted field, and a `<p>` tag spanning a newline would be read as a new row —
 * so the file has to be parsed properly rather than approximately. Quoted
 * fields, doubled quotes as an escape, embedded newlines, and `\r\n` folded.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') field += character;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The order the handoff gives for rebuilding a monograph. */
const SECTION_ORDER = ['body', 'brief_description', 'overview', 'quick_tips', 'safety_advice'];

/**
 * Long-form copy, read from the CSV rather than from the database.
 *
 * The handoff says to prefer `arogga.sqlite` because "it has the same data" —
 * it does not. The database's `seo_sections` table carries only `heading` and
 * `text`, with **no `lang` and no `section` column**, so the documented
 * instruction to filter to English cannot be followed from it: English and
 * Bengali arrive interleaved in one field. `descriptions.csv` has the shape the
 * handoff documents, so that is the file this reads.
 */
function loadDescriptions(dataDirectory: string, names: Map<number, string>): Map<number, string> {
  const file = join(dataDirectory, 'descriptions.csv');
  const byProduct = new Map<number, { section: string; title: string; content: string }[]>();
  if (!existsSync(file)) return new Map();

  const rows = parseCsv(readFileSync(file, 'utf8'));
  const header = rows.shift() ?? [];
  const at = (name: string) => header.indexOf(name);

  for (const row of rows) {
    if (row.length < header.length) continue;
    if (row[at('lang')] !== 'en') continue;
    const productId = Number(row[at('product_id')]);
    if (!productId) continue;
    const list = byProduct.get(productId) ?? [];
    list.push({
      section: row[at('section')] ?? '',
      title: row[at('title')] ?? '',
      content: row[at('content')] ?? '',
    });
    byProduct.set(productId, list);
  }

  const assembled = new Map<number, string>();
  for (const [productId, sections] of byProduct) {
    sections.sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
    const text = sections
      .map((entry) => (entry.title ? `${entry.title}: ${entry.content}` : entry.content))
      .join('\n\n')
      // The source templates the product name out as `__NAME__`, which reads as
      // a rendering bug if it reaches a screen.
      .replaceAll('__NAME__', names.get(productId) ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) assembled.set(productId, text);
  }
  return assembled;
}

// ─── Reporting ───────────────────────────────────────────────────────────────

interface Skipped {
  productId: number;
  name: string;
  type: string;
  reason: string;
}

function argValue(flag: string): string | undefined {
  const found = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return found ? found.slice(flag.length + 1) : undefined;
}

const APPLY = process.argv.includes('--apply');
const WITH_IMAGES = !process.argv.includes('--no-images');
const WITH_DESCRIPTIONS = !process.argv.includes('--no-descriptions');
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
 */
function findExport(): string {
  let directory = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(directory, 'arogga export');
    if (existsSync(candidate)) {
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
        'an "arogga export" folder at the repository root.',
    );
  }

  const db = new DatabaseSync(SOURCE, { readOnly: true });

  const products = db
    .prepare(
      `select product_id, name, type, form, strength, generic_name, brand_name, manufacturer,
              rx_required, cold_chain, availability, category_path, mrp, price,
              short_description, url
         from products order by product_id` + (LIMIT ? ` limit ${LIMIT}` : ''),
    )
    .all() as unknown as SourceProduct[];

  const variants = new Map<number, SourceVariant>();
  for (const row of db
    .prepare('select * from variants where is_base = 1')
    .all() as unknown as SourceVariant[]) {
    variants.set(row.product_id, row);
  }

  const imagesByProduct = new Map<number, SourceImage[]>();
  for (const row of db
    .prepare(
      'select product_id, position, local_path, is_placeholder, logo_removed, logo_residual ' +
        'from images where is_placeholder = 0 order by product_id, position',
    )
    .all() as unknown as SourceImage[]) {
    const list = imagesByProduct.get(row.product_id) ?? [];
    list.push(row);
    imagesByProduct.set(row.product_id, list);
  }

  const descriptions = WITH_DESCRIPTIONS
    ? loadDescriptions(
        dirname(SOURCE),
        new Map(products.map((product) => [product.product_id, product.name])),
      )
    : new Map<number, string>();

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
  const created: string[] = [];
  const updated: string[] = [];
  const needsReview: string[] = [];
  let noCostPrice = 0;

  for (const product of products) {
    const variant = variants.get(product.product_id);
    if (!variant) {
      skipped.push({
        productId: product.product_id,
        name: product.name,
        type: product.type,
        reason: 'no base variant, so there is no price or pack to import',
      });
      continue;
    }

    const images = imagesByProduct.get(product.product_id) ?? [];
    const primary = images.find((image) => image.position === 1) ?? images[0];

    const mapped = mapProduct(product, variant);
    if (WITH_DESCRIPTIONS && descriptions.has(product.product_id)) {
      mapped.fields.description = descriptions.get(product.product_id)!.slice(0, 2000);
    }
    if (WITH_IMAGES && primary?.local_path) {
      // Bundle-relative, forward-slashed. Serving it is a separate step; this
      // records which file belongs to which medicine so that step has an input.
      mapped.fields.productImageUrl = primary.local_path.split(sep).join('/');
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
      skipped.push({
        productId: product.product_id,
        name: product.name,
        type: product.type,
        reason,
      });
      continue;
    }

    if (images.some((image) => image.logo_residual === 1)) {
      needsReview.push(`${product.product_id} ${product.name}`);
    }

    const document: Record<string, unknown> = {
      ...parsed.data,
      isActive: product.availability === 'in_stock',
      externalRef: { source: 'AROGGA', id: mapped.externalId },
      createdBy: importer._id,
    };
    // Cost is not in the export at all. Recorded equal to the trade price so
    // margin reads as zero — visibly unknown — rather than as a plausible
    // figure nobody entered. A goods receipt supplies the real one.
    noCostPrice += 1;

    const existing = await Medicine.findOne({
      'externalRef.source': 'AROGGA',
      'externalRef.id': mapped.externalId,
    });

    if (existing) {
      updated.push(`${mapped.sku} ${product.name}`);
      if (APPLY) await Medicine.updateOne({ _id: existing._id }, { $set: document });
    } else {
      created.push(`${mapped.sku} ${product.name}`);
      if (APPLY) {
        await Medicine.create({ ...document, reference: await nextReference('MED') });
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const mode = APPLY ? 'APPLIED' : 'DRY RUN — nothing was written';
  console.log(`\n  Arogga catalogue import — ${mode}`);
  console.log(`  source: ${SOURCE}`);
  console.log(`  attributed to: ${importer.email}\n`);

  console.log(`  would create : ${created.length}`);
  for (const line of created) console.log(`      + ${line}`);
  console.log(`  would update : ${updated.length}`);
  for (const line of updated) console.log(`      ~ ${line}`);

  console.log(`\n  skipped      : ${skipped.length}`);
  for (const row of skipped) {
    console.log(`      - ${row.productId} [${row.type}] ${row.name}`);
    console.log(`          ${row.reason}`);
  }

  console.log(`\n  notes`);
  console.log(
    `    cost price is absent from the export; ${noCostPrice} rows take the trade price,`,
  );
  console.log(`    so margin reads as zero until a goods receipt supplies the real figure.`);
  console.log(
    `    images       : ${WITH_IMAGES ? 'attached from the bundle' : 'skipped (--no-images)'}`,
  );
  console.log(
    `    descriptions : ${WITH_DESCRIPTIONS ? "imported, lang='en'" : 'skipped (--no-descriptions)'}`,
  );
  if (needsReview.length) {
    console.log(`\n  REVIEW BY HAND — logo removal left a residue on these:`);
    for (const line of needsReview) console.log(`      ! ${line}`);
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
