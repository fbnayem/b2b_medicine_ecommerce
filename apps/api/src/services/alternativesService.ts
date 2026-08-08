import mongoose from 'mongoose';
import { AlternativeGroupKind, MedicineRelationKind } from '@medsupply/shared-types';
import { Medicine } from '../models/Medicine';
import { MedicineRelation } from '../models/MedicineRelation';

/**
 * What else a shop could be offered when the thing they asked for is not
 * available.
 *
 * Several questions, answered two different ways, and the difference is the
 * whole design.
 *
 * **"Another brand of the same drug"** is a *query*, not a stored list. Two
 * medicines are alternatives when they share an active ingredient, and the row
 * already says what its active ingredient is — so the answer is computed at the
 * moment it is asked and cannot be out of date. The supplier export shipped
 * 436,348 rows expressing this as data; every one of them would have been a
 * snapshot of one afternoon, wrong the first time a line was delisted, and
 * nothing in this system would have rebuilt them.
 *
 * The other four kinds are stored, in `MedicineRelation` — the full history of
 * which used to be stored and why the rest now are lives on
 * `MedicineRelationKind`'s doc comment. What matters here is that they are not
 * all the same sort of thing. `SIMILAR`, `BOUGHT_TOGETHER` and `SAME_BRAND`
 * are genuine suggestions. `PROMOTED` is the supplier's bestseller carousel:
 * advertising, which on a prescription line names products with no connection
 * to the medicine at all. It is returned as **its own group, last, and never
 * blended into the others**, so every screen can label it as the promotion it
 * is — a paid placement presented as a clinical match is the one output of
 * this service that could actually hurt somebody.
 *
 * Everything returned is in stock or at least sellable: an alternative nobody
 * can be sent is not an alternative. That is the point of the exercise.
 */

/** No screen shows more than a dozen suggestions, and a long list is not kinder. */
const PER_GROUP = 12;

/*
 * The kind vocabulary used to be declared here and grew a twin in
 * `@medsupply/shared-types` for the clients; when `SAME_BRAND` and `PROMOTED`
 * arrived the local copy was retired rather than extended, because two lists
 * of the same six strings is how one of them ends up five long.
 */
export { AlternativeGroupKind };

export interface AlternativeGroup {
  kind: AlternativeGroupKind;
  items: Record<string, unknown>[];
}

/** Case- and accent-insensitive, matching the index in `Medicine`. */
const COLLATION = { locale: 'en', strength: 2 } as const;

/**
 * The fields a suggestion card needs, and the free stock behind it.
 *
 * `$lookup` rather than a second round of queries because a caller showing
 * three groups of twelve would otherwise make thirty-six of them. Blocked,
 * quarantined and expired batches do not count as stock — the same rule
 * `listMedicines` applies, and the reason it is repeated rather than shared is
 * that this pipeline runs under a collation and that one does not.
 */
type SubPipelineStage = Exclude<
  mongoose.PipelineStage,
  mongoose.PipelineStage.Merge | mongoose.PipelineStage.Out
>;

const withStock = (): SubPipelineStage[] => [
  {
    $lookup: {
      from: 'medicinebatches',
      let: { medicineId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ['$medicineId', '$$medicineId'] },
            isBlocked: false,
            isQuarantined: false,
            expiryDate: { $gt: new Date() },
          },
        },
        { $group: { _id: null, total: { $sum: '$quantities.available' } } },
      ],
      as: 'stock',
    },
  },
  { $set: { totalAvailable: { $ifNull: [{ $first: '$stock.total' }, 0] } } },
  { $unset: 'stock' },
];

/**
 * Other brands of the same drug.
 *
 * Ranked the way somebody standing at a counter would rank them: the same
 * strength first, because 500mg and 665mg of the same molecule are not
 * interchangeable and offering the wrong one is worse than offering nothing;
 * then what is actually in stock; then the cheaper.
 *
 * **The guard on an absent ingredient is load-bearing.** Most of this catalogue
 * is not a drug — a shampoo, a glucometer, a box of nappies — and those rows
 * have no `genericName` at all. Matching on it without this check makes every
 * product with a blank ingredient an alternative for every other, which reads
 * as a recommendation engine and is a null-equals-null bug.
 */
async function sameIngredient(medicine: {
  _id: mongoose.Types.ObjectId;
  genericName?: string | null;
  strength?: string | null;
}): Promise<Record<string, unknown>[]> {
  const ingredient = medicine.genericName?.trim();
  if (!ingredient) return [];

  return Medicine.aggregate([
    { $match: { genericName: ingredient, isActive: true, _id: { $ne: medicine._id } } },
    ...withStock(),
    {
      $set: {
        sameStrength: {
          $cond: [{ $eq: ['$strength', medicine.strength ?? null] }, 0, 1],
        },
        inStock: { $cond: [{ $gt: ['$totalAvailable', 0] }, 0, 1] },
      },
    },
    { $sort: { sameStrength: 1, inStock: 1, defaultSellingPriceMinor: 1, brandName: 1 } },
    { $limit: PER_GROUP },
    { $unset: ['sameStrength', 'inStock'] },
  ]).collation(COLLATION);
}

/**
 * A stored relation, resolved to the products it names.
 *
 * The `$match` now finds at most one document — a relation is a whole list
 * under `(fromId, kind)` since the row-per-relation shape was retired — and
 * `$unwind` turns it back into the row stream the rest of the pipeline always
 * read, one entry per suggestion, sorted by the supplier's rank.
 *
 * `$lookup` into the catalogue rather than `populate`, so the whole group is
 * one round trip and the supplier's ranking survives into the output. The
 * lookup sits after the sort and streams into the `$limit`, so however long
 * the stored list is, only enough entries are joined to fill the dozen slots
 * — plus one extra per delisted product the inner `isActive` match discards.
 */
async function stored(
  medicineId: mongoose.Types.ObjectId,
  kind: MedicineRelationKind,
): Promise<Record<string, unknown>[]> {
  const rows = await MedicineRelation.aggregate([
    { $match: { fromId: medicineId, kind } },
    { $unwind: '$items' },
    { $sort: { 'items.rank': 1 } },
    {
      $lookup: {
        from: 'medicines',
        let: { toId: '$items.toId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$toId'] }, isActive: true } },
          ...withStock(),
        ],
        as: 'medicine',
      },
    },
    { $unwind: '$medicine' },
    { $limit: PER_GROUP },
    { $replaceRoot: { newRoot: '$medicine' } },
  ]);
  return rows;
}

/**
 * Others on the same shelf — the last resort.
 *
 * Deliberately **not** offered when anything better exists. "Others in this
 * category" beside a full list of same-ingredient alternatives is noise, and
 * noise on a suggestion list teaches people to stop reading it. It exists for
 * the products that would otherwise show an empty space: 225 of 55,998 have
 * neither a stored suggestion nor an active ingredient — a shampoo, a walking
 * stick, a one-off device — and for those, "here is the rest of this shelf" is
 * the only true thing the catalogue can say.
 *
 * Matched on the **leaf** category rather than anywhere in the trail. Matching
 * a branch would offer a nebuliser mask against a walking stick on the grounds
 * that both are Healthcare, which is not a suggestion.
 */
async function sameCategory(medicine: {
  _id: mongoose.Types.ObjectId;
  category?: string | null;
}): Promise<Record<string, unknown>[]> {
  const shelf = medicine.category?.trim();
  // The same guard as the ingredient one, for the same reason.
  if (!shelf) return [];

  return Medicine.aggregate([
    { $match: { category: shelf, isActive: true, _id: { $ne: medicine._id } } },
    ...withStock(),
    { $set: { inStock: { $cond: [{ $gt: ['$totalAvailable', 0] }, 0, 1] } } },
    { $sort: { inStock: 1, brandName: 1 } },
    { $limit: PER_GROUP },
    { $unset: 'inStock' },
  ]);
}

/**
 * Everything worth offering beside one catalogue line.
 *
 * The five queries run concurrently and the empty groups are dropped, so a
 * caller renders what came back rather than testing each for length.
 *
 * The shelf group is asked for **only when no genuine group came back with
 * anything** — it is a floor, not a fifth suggestion. `PROMOTED` deliberately
 * does not count as "anything" for that decision: it is advertising, not an
 * answer to "what else could you send?", so a product whose only relation is
 * the supplier's carousel still gets its shelf — the blank space the floor
 * exists to prevent would otherwise come back wearing an advert. The
 * promotion, when present, is appended last either way, after every genuine
 * suggestion, and the UI labels it. If everything is empty the answer is
 * `[]`, which is a real answer and not an error.
 */
export async function alternativesFor(medicine: {
  _id: mongoose.Types.ObjectId;
  genericName?: string | null;
  strength?: string | null;
  category?: string | null;
}): Promise<AlternativeGroup[]> {
  const [ingredient, similar, together, sameBrand, promoted] = await Promise.all([
    sameIngredient(medicine),
    stored(medicine._id, MedicineRelationKind.SIMILAR),
    stored(medicine._id, MedicineRelationKind.BOUGHT_TOGETHER),
    stored(medicine._id, MedicineRelationKind.SAME_BRAND),
    stored(medicine._id, MedicineRelationKind.PROMOTED),
  ]);

  const genuine = (
    [
      { kind: AlternativeGroupKind.SAME_INGREDIENT, items: ingredient },
      { kind: AlternativeGroupKind.SIMILAR, items: similar },
      { kind: AlternativeGroupKind.BOUGHT_TOGETHER, items: together },
      { kind: AlternativeGroupKind.SAME_BRAND, items: sameBrand },
    ] as AlternativeGroup[]
  ).filter((group) => group.items.length > 0);

  const promotion: AlternativeGroup[] = promoted.length
    ? [{ kind: AlternativeGroupKind.PROMOTED, items: promoted }]
    : [];

  if (genuine.length) return [...genuine, ...promotion];

  const shelf = await sameCategory(medicine);
  return [
    ...(shelf.length ? [{ kind: AlternativeGroupKind.SAME_CATEGORY, items: shelf }] : []),
    ...promotion,
  ];
}
