import type { PipelineStage } from 'mongoose';

/**
 * The stock figure the catalogue shows beside each line.
 *
 * Batches that are blocked, quarantined or expired are not stock anybody can be
 * sent, so they are excluded here rather than subtracted later.
 */
const STOCK_LOOKUP: PipelineStage[] = [
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
 * One page of the catalogue, with the stock lookup **after** the page is cut.
 *
 * The ordering is the whole point of this function existing, and it is why the
 * pipeline is built here rather than written inline in the controller: it can be
 * asserted.
 *
 * A `$lookup` runs once per document that reaches it. Above the `$skip` it
 * reached every document the filter matched, so returning twenty medicines cost
 * a per-product stock aggregation over the entire catalogue — an unfiltered
 * first page measured **6,130 ms** against 55,998 products, and page 500 the
 * same. Below the `$limit` it runs twenty times and that page measures **11 ms**.
 *
 * Both figures were taken with `medicinebatches` empty, which is the most
 * favourable case the old shape could ever have: every batch received made it
 * worse. This is the same defect class as the finance N+1 that Phase 1 fixed,
 * in a place that phase never looked.
 *
 * `$sort` also has to precede the cut, or the page would be twenty arbitrary
 * documents rather than the twenty the caller asked for.
 */
export type MedicineListSort = 'name' | 'popular';

/*
 * Each order is a single key on purpose, because each is exactly one index.
 * `popular` reads the supplier's demand signal descending — the freshly
 * imported catalogue has no local sales for "best sellers" to draw on, which
 * is why `popularity.ordered` exists and is indexed that way round. A
 * tie-breaking second key was considered and rejected: a compound sort is no
 * longer a prefix of either index, which turns every page into a blocking
 * in-memory sort of the whole catalogue — the same class of cost the lookup
 * ordering above was moved to avoid. The never-ordered tail sorts last
 * (missing ranks below any number descending) in natural order, and unstable
 * paging among products nobody has ever bought is the cheaper defect.
 */
const SORT_ORDERS: Record<MedicineListSort, Record<string, 1 | -1>> = {
  name: { brandName: 1 },
  popular: { 'popularity.ordered': -1 },
};

export function medicineListPipeline(
  filter: Record<string, unknown>,
  page: number,
  limit: number,
  sort: MedicineListSort = 'name',
): PipelineStage[] {
  return [
    { $match: filter },
    { $sort: SORT_ORDERS[sort] },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    ...STOCK_LOOKUP,
  ];
}

/**
 * Where the paging stages and the lookup sit, for the gate that keeps them in
 * that order. Returns `-1` for anything absent so a missing stage reads as a
 * failure rather than as position zero.
 */
export function stageOrder(pipeline: PipelineStage[]) {
  const indexOf = (stage: string) => pipeline.findIndex((entry) => stage in entry);
  return {
    match: indexOf('$match'),
    sort: indexOf('$sort'),
    skip: indexOf('$skip'),
    limit: indexOf('$limit'),
    lookup: indexOf('$lookup'),
  };
}
