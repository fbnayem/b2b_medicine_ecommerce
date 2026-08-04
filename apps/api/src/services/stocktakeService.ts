import mongoose, { Types } from 'mongoose';
import { StockMovementType, StockQuantities, UserRole } from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { MedicineBatch } from '../models/MedicineBatch';
import { StockMovement } from '../models/StockMovement';
import { Stocktake, StocktakeStatus } from '../models/Stocktake';
import { nextReference } from '../models/Counter';
import { availableAfterAdjustment } from './inventoryRules';

type Actor = { _id: Types.ObjectId; role: UserRole };

/**
 * A physical stock count, from opening the sheet to posting the adjustments.
 *
 * `POST /batches/:id/adjust` corrects one batch with one reason. That is the
 * right tool for "six of these are damaged" and it cannot express a stocktake:
 * a count is one event over many batches, approved once and posted once, and
 * for an inspected operation it is a document rather than a series of edits.
 *
 * Three properties this is built around, in order of how much they matter:
 *
 *   1. **The count is blind.** `systemQuantity` is never sent to the counting
 *      screen. A count that shows the expected figure first is not a count.
 *   2. **Posting is one transaction.** Either every adjustment lands or none
 *      does. A stocktake that half-posted would leave the shelf and the system
 *      disagreeing in a way nobody could reconstruct.
 *   3. **Uncounted is not zero.** A line nobody visited stays `null` and is
 *      never posted, so a session cannot silently write off an aisle that was
 *      simply missed.
 */

function failure(message: string, code: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

const snapshot = (quantities: StockQuantities): StockQuantities => ({
  onHand: quantities.onHand,
  available: quantities.available,
  reserved: quantities.reserved,
  picking: quantities.picking,
  packed: quantities.packed,
  damaged: quantities.damaged,
  expired: quantities.expired,
  returned: quantities.returned,
  quarantined: quantities.quarantined,
});

export interface OpenStocktakeInput {
  warehouseLocation?: string;
  medicineIds?: string[];
  notes?: string;
}

/**
 * Opens a session over everything in scope.
 *
 * The system figure for each batch is frozen here. A count is a statement about
 * a moment, so re-reading it at posting time would silently change the variance
 * a supervisor approved.
 */
export async function openStocktake(input: OpenStocktakeInput, actor: Actor) {
  const filter: Record<string, unknown> = {};
  if (input.warehouseLocation) filter.warehouseLocation = input.warehouseLocation;
  if (input.medicineIds?.length) {
    filter.medicineId = { $in: input.medicineIds.map((id) => new Types.ObjectId(id)) };
  }

  const batches = await MedicineBatch.find(filter)
    .populate('medicineId', 'brandName genericName strength')
    .sort({ warehouseLocation: 1, expiryDate: 1 })
    .lean();

  if (batches.length === 0) {
    throw failure('There is nothing on the shelf matching that scope', 'EMPTY_SCOPE');
  }

  /*
   * One open session at a time for a given location. Two people counting the
   * same aisle against two sheets is how a variance gets posted twice.
   */
  const existing = await Stocktake.findOne({
    status: { $in: [StocktakeStatus.COUNTING, StocktakeStatus.REVIEW] },
    'scope.warehouseLocation': input.warehouseLocation ?? { $exists: false },
  });
  if (existing) {
    throw failure(
      `A count is already open for this scope: ${existing.reference}`,
      'STOCKTAKE_ALREADY_OPEN',
      409,
    );
  }

  return Stocktake.create({
    reference: await nextReference('STK'),
    status: StocktakeStatus.COUNTING,
    scope: {
      warehouseLocation: input.warehouseLocation,
      medicineIds: input.medicineIds ?? [],
    },
    notes: input.notes,
    openedBy: actor._id,
    lines: batches.map((batch) => {
      const medicine = batch.medicineId as unknown as {
        brandName?: string;
        genericName?: string;
        strength?: string;
        _id: Types.ObjectId;
      };
      return {
        batchId: batch._id,
        medicineId: medicine._id ?? batch.medicineId,
        snapshot: {
          brandName: medicine.brandName,
          genericName: medicine.genericName,
          strength: medicine.strength,
          batchNumber: batch.batchNumber,
          warehouseLocation: batch.warehouseLocation,
          expiryDate: batch.expiryDate,
        },
        systemQuantity: batch.quantities.onHand,
        countedQuantity: null,
      };
    }),
  });
}

export interface CountInput {
  version: number;
  counts: Array<{ lineId: string; countedQuantity: number; varianceReason?: string }>;
}

/** Records what somebody counted. Called repeatedly as they walk the aisle. */
export async function recordCounts(stocktakeId: string, input: CountInput, actor: Actor) {
  const stocktake = await Stocktake.findById(stocktakeId);
  if (!stocktake) throw failure('Stocktake not found', 'NOT_FOUND', 404);
  if (stocktake.status !== StocktakeStatus.COUNTING) {
    throw failure('This count is no longer open for counting', 'STOCKTAKE_CLOSED', 409);
  }
  if (stocktake.version !== input.version) {
    throw failure('Somebody else has changed this count', 'VERSION_CONFLICT', 409);
  }

  for (const entry of input.counts) {
    const line = stocktake.lines.id(entry.lineId);
    if (!line) throw failure('That line is not on this count', 'LINE_NOT_FOUND', 404);
    line.countedQuantity = entry.countedQuantity;
    line.countedAt = new Date();
    line.countedBy = actor._id;
    if (entry.varianceReason !== undefined) line.varianceReason = entry.varianceReason;
  }

  stocktake.version += 1;
  await stocktake.save();
  return stocktake;
}

/** Moves a finished sheet to review, where the variance becomes visible. */
export async function submitForReview(stocktakeId: string, version: number) {
  const stocktake = await Stocktake.findById(stocktakeId);
  if (!stocktake) throw failure('Stocktake not found', 'NOT_FOUND', 404);
  if (stocktake.status !== StocktakeStatus.COUNTING) {
    throw failure('This count is not being counted', 'STOCKTAKE_CLOSED', 409);
  }
  if (stocktake.version !== version) {
    throw failure('Somebody else has changed this count', 'VERSION_CONFLICT', 409);
  }
  if (!stocktake.lines.some((line) => line.countedQuantity !== null)) {
    throw failure('Nothing has been counted yet', 'NOTHING_COUNTED');
  }

  stocktake.status = StocktakeStatus.REVIEW;
  stocktake.version += 1;
  await stocktake.save();
  return stocktake;
}

export interface PostInput {
  version: number;
  idempotencyKey: string;
}

/**
 * Approves the sheet and posts every variance, once, in one transaction.
 *
 * Only counted lines move. An uncounted line is an aisle nobody reached, and
 * treating it as zero would write off stock that is sitting there — which is
 * the single worst thing this feature could do.
 */
export async function postStocktake(stocktakeId: string, input: PostInput, actor: Actor) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const stocktake = await Stocktake.findById(stocktakeId).session(session);
      if (!stocktake) throw failure('Stocktake not found', 'NOT_FOUND', 404);

      // A retried approval finds the key already recorded and returns the
      // posted sheet rather than adjusting the shelf a second time.
      if (stocktake.status === StocktakeStatus.POSTED) {
        if (stocktake.postingIdempotencyKey === input.idempotencyKey) {
          result = stocktake;
          return;
        }
        throw failure('This count has already been posted', 'STOCKTAKE_POSTED', 409);
      }
      if (stocktake.status !== StocktakeStatus.REVIEW) {
        throw failure('This count is not ready to be posted', 'STOCKTAKE_NOT_IN_REVIEW', 409);
      }
      if (stocktake.version !== input.version) {
        throw failure('Somebody else has changed this count', 'VERSION_CONFLICT', 409);
      }

      const counted = stocktake.lines.filter((line) => line.countedQuantity !== null);
      const unexplained = counted.filter(
        (line) =>
          line.countedQuantity !== line.systemQuantity && !line.varianceReason?.trim().length,
      );
      if (unexplained.length > 0) {
        throw failure(
          `${unexplained.length} lines differ from the system and have no explanation`,
          'VARIANCE_REASON_REQUIRED',
        );
      }

      let adjusted = 0;
      for (const line of counted) {
        if (line.countedQuantity === line.systemQuantity) continue;

        const batch = await MedicineBatch.findById(line.batchId).session(session);
        if (!batch) {
          throw failure(
            `The batch on line ${line.snapshot?.batchNumber ?? ''} no longer exists`,
            'BATCH_MISSING',
            409,
          );
        }

        const committed =
          batch.quantities.reserved + batch.quantities.picking + batch.quantities.packed;
        const unavailable =
          batch.quantities.damaged + batch.quantities.expired + batch.quantities.quarantined;
        const newOnHand = line.countedQuantity as number;

        /*
         * A count below what is already promised to somebody is refused rather
         * than posted. Reserved and picked units are attached to real orders,
         * and quietly making them negative would break the order rather than
         * report the problem.
         */
        if (newOnHand < committed) {
          throw failure(
            `Counted ${newOnHand} of ${line.snapshot?.batchNumber ?? 'a batch'} but ${committed} are already promised to orders`,
            'INSUFFICIENT_STOCK',
            409,
          );
        }

        const before = snapshot(batch.quantities);
        batch.quantities.onHand = newOnHand;
        batch.quantities.available = availableAfterAdjustment(newOnHand, committed, unavailable);
        batch.version += 1;
        await batch.save({ session });

        await StockMovement.create(
          [
            {
              medicineId: batch.medicineId,
              batchId: batch._id,
              type: StockMovementType.ADJUSTMENT,
              quantity: newOnHand - before.onHand,
              reason: `${stocktake.reference}: ${line.varianceReason}`,
              // Per line, and derived from the session's key, so a retry of the
              // whole posting reproduces exactly the same movement keys.
              idempotencyKey: `${input.idempotencyKey}-${String(line._id)}`,
              referenceType: 'Stocktake',
              referenceId: String(stocktake._id),
              before,
              after: snapshot(batch.quantities),
              actorId: actor._id,
              actorRole: actor.role,
            },
          ],
          { session },
        );
        adjusted += 1;
      }

      stocktake.status = StocktakeStatus.POSTED;
      stocktake.postedAt = new Date();
      stocktake.postedBy = actor._id;
      stocktake.postingIdempotencyKey = input.idempotencyKey;
      stocktake.version += 1;
      await stocktake.save({ session });

      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'STOCKTAKE_POSTED',
            entityType: 'Stocktake',
            entityId: stocktake._id,
            after: {
              reference: stocktake.reference,
              linesCounted: counted.length,
              linesAdjusted: adjusted,
              linesUncounted: stocktake.lines.length - counted.length,
            },
          },
        ],
        { session },
      );

      result = stocktake;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function abandonStocktake(
  stocktakeId: string,
  input: { version: number; reason: string },
  actor: Actor,
) {
  const stocktake = await Stocktake.findById(stocktakeId);
  if (!stocktake) throw failure('Stocktake not found', 'NOT_FOUND', 404);
  if (stocktake.status === StocktakeStatus.POSTED) {
    throw failure('A posted count cannot be abandoned', 'STOCKTAKE_POSTED', 409);
  }
  if (stocktake.version !== input.version) {
    throw failure('Somebody else has changed this count', 'VERSION_CONFLICT', 409);
  }

  stocktake.status = StocktakeStatus.ABANDONED;
  stocktake.abandonedAt = new Date();
  stocktake.abandonedReason = input.reason;
  stocktake.version += 1;
  await stocktake.save();

  await AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    action: 'STOCKTAKE_ABANDONED',
    entityType: 'Stocktake',
    entityId: stocktake._id,
    after: { reference: stocktake.reference, reason: input.reason },
  });

  return stocktake;
}

/**
 * The variance sheet.
 *
 * Computed rather than stored, because it is a view of two numbers that are
 * both already on the record — and a stored variance is one more thing that can
 * disagree with what it was derived from.
 */
export interface CountedLine {
  systemQuantity: number;
  /** `null` while nobody has counted it, which is not the same as zero. */
  countedQuantity?: number | null;
}

export function varianceSummary(lines: readonly CountedLine[]) {
  const counted = lines.filter(
    (line) => line.countedQuantity !== null && line.countedQuantity !== undefined,
  );
  const differing = counted.filter((line) => line.countedQuantity !== line.systemQuantity);
  return {
    linesTotal: lines.length,
    linesCounted: counted.length,
    linesUncounted: lines.length - counted.length,
    linesDiffering: differing.length,
    unitsOver: differing.reduce(
      (sum, line) => sum + Math.max(0, (line.countedQuantity as number) - line.systemQuantity),
      0,
    ),
    unitsShort: differing.reduce(
      (sum, line) => sum + Math.max(0, line.systemQuantity - (line.countedQuantity as number)),
      0,
    ),
  };
}
