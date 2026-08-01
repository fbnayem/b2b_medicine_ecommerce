import mongoose, { ClientSession, Types } from 'mongoose';
import {
  RETURN_STOCK_MOVEMENTS,
  StockMovementType,
  StockQuantities,
  UserRole,
} from '@medsupply/shared-types';
import { MedicineBatch } from '../models/MedicineBatch';
import { StockMovement } from '../models/StockMovement';
import { availableAfterAdjustment, planFefoAllocation } from './inventoryRules';

type Actor = { _id: Types.ObjectId; role: UserRole };
type Operation = {
  type: StockMovementType;
  quantity: number;
  reason: string;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
};

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

const transitions: Partial<
  Record<StockMovementType, { from: keyof StockQuantities; to: keyof StockQuantities }>
> = {
  [StockMovementType.DAMAGE]: { from: 'available', to: 'damaged' },
  [StockMovementType.EXPIRY]: { from: 'available', to: 'expired' },
  [StockMovementType.QUARANTINE]: { from: 'available', to: 'quarantined' },
  [StockMovementType.QUARANTINE_RELEASE]: { from: 'quarantined', to: 'available' },
  [StockMovementType.RESERVATION]: { from: 'available', to: 'reserved' },
  [StockMovementType.RESERVATION_RELEASE]: { from: 'reserved', to: 'available' },
  [StockMovementType.PICKING]: { from: 'reserved', to: 'picking' },
  [StockMovementType.PICKING_RETURN]: { from: 'picking', to: 'reserved' },
  [StockMovementType.PACKING]: { from: 'picking', to: 'packed' },
  [StockMovementType.PACKING_REVERSAL]: { from: 'packed', to: 'picking' },
  // Inspected customer returns leave the holding bucket for a final state.
  [StockMovementType.RETURN_RESTOCK]: { from: 'returned', to: 'available' },
  [StockMovementType.RETURN_DAMAGED]: { from: 'returned', to: 'damaged' },
  [StockMovementType.RETURN_EXPIRED]: { from: 'returned', to: 'expired' },
  [StockMovementType.RETURN_QUARANTINED]: { from: 'returned', to: 'quarantined' },
};

/**
 * Damaged and expired units are physically present but permanently unsaleable,
 * so they leave `onHand` exactly as the existing write-off movements do.
 */
const reducesOnHand: StockMovementType[] = [
  StockMovementType.DAMAGE,
  StockMovementType.EXPIRY,
  StockMovementType.RETURN_DAMAGED,
  StockMovementType.RETURN_EXPIRED,
];

async function createMovement(
  batch: { _id: Types.ObjectId; medicineId: Types.ObjectId },
  before: StockQuantities,
  after: StockQuantities,
  operation: Operation,
  actor: Actor,
  session: ClientSession,
) {
  await StockMovement.create(
    [
      {
        medicineId: batch.medicineId,
        batchId: batch._id,
        ...operation,
        before,
        after,
        actorId: actor._id,
        actorRole: actor.role,
      },
    ],
    { session },
  );
}

export async function receiveStock(
  data: {
    medicineId: string;
    batchNumber: string;
    manufacturingDate: Date;
    expiryDate: Date;
    costPriceMinor: number;
    sellingPriceOverrideMinor?: number;
    quantity: number;
    warehouseLocation: string;
    notes?: string;
  },
  actor: Actor,
) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const quantities: StockQuantities = {
        onHand: data.quantity,
        available: data.quantity,
        reserved: 0,
        picking: 0,
        packed: 0,
        damaged: 0,
        expired: 0,
        returned: 0,
        quarantined: 0,
      };
      const [batch] = await MedicineBatch.create(
        [{ ...data, receivedQuantity: data.quantity, quantities, createdBy: actor._id }],
        { session },
      );
      await createMovement(
        batch,
        { ...quantities, onHand: 0, available: 0 },
        quantities,
        {
          type: StockMovementType.RECEIPT,
          quantity: data.quantity,
          reason: 'Initial stock receipt',
          idempotencyKey: `receipt:${batch._id}`,
        },
        actor,
        session,
      );
      result = batch;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function applyStockOperation(batchId: string, operation: Operation, actor: Actor) {
  const transition = transitions[operation.type];
  if (!transition && operation.type !== StockMovementType.ADDITION)
    throw Object.assign(new Error('Unsupported stock operation'), {
      statusCode: 400,
      code: 'INVALID_OPERATION',
    });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const existing = await StockMovement.findOne({
        idempotencyKey: operation.idempotencyKey,
      }).session(session);
      if (existing) {
        result = await MedicineBatch.findById(existing.batchId).session(session);
        return;
      }
      if (operation.type === StockMovementType.ADDITION) {
        const beforeBatch = await MedicineBatch.findById(batchId).session(session);
        if (!beforeBatch)
          throw Object.assign(new Error('Batch not found'), { statusCode: 404, code: 'NOT_FOUND' });
        const updated = await MedicineBatch.findOneAndUpdate(
          { _id: batchId, version: beforeBatch.version },
          {
            $inc: {
              'quantities.onHand': operation.quantity,
              'quantities.available': operation.quantity,
              receivedQuantity: operation.quantity,
              version: 1,
            },
          },
          { new: true, session },
        );
        if (!updated)
          throw Object.assign(new Error('Inventory changed concurrently; retry operation'), {
            statusCode: 409,
            code: 'CONCURRENT_STOCK_CHANGE',
          });
        await createMovement(
          updated,
          snapshot(beforeBatch.quantities),
          snapshot(updated.quantities),
          operation,
          actor,
          session,
        );
        result = updated;
        return;
      }
      if (!transition)
        throw Object.assign(new Error('Unsupported stock operation'), {
          statusCode: 400,
          code: 'INVALID_OPERATION',
        });
      const fromPath = `quantities.${transition.from}`;
      const update: Record<string, number> = {
        [fromPath]: -operation.quantity,
        [`quantities.${transition.to}`]: operation.quantity,
      };
      if (reducesOnHand.includes(operation.type)) update['quantities.onHand'] = -operation.quantity;
      const beforeBatch = await MedicineBatch.findOne({
        _id: batchId,
        [fromPath]: { $gte: operation.quantity },
      }).session(session);
      if (!beforeBatch)
        throw Object.assign(new Error('Insufficient stock or batch not found'), {
          statusCode: 409,
          code: 'INSUFFICIENT_STOCK',
        });
      if (
        operation.type === StockMovementType.RESERVATION &&
        (beforeBatch.isBlocked || beforeBatch.isQuarantined || beforeBatch.expiryDate <= new Date())
      )
        throw Object.assign(new Error('Batch is not eligible for reservation'), {
          statusCode: 409,
          code: 'BATCH_UNAVAILABLE',
        });
      const updated = await MedicineBatch.findOneAndUpdate(
        { _id: batchId, version: beforeBatch.version, [fromPath]: { $gte: operation.quantity } },
        { $inc: { ...update, version: 1 } },
        { new: true, session },
      );
      if (!updated)
        throw Object.assign(new Error('Inventory changed concurrently; retry operation'), {
          statusCode: 409,
          code: 'CONCURRENT_STOCK_CHANGE',
        });
      await createMovement(
        updated,
        snapshot(beforeBatch.quantities),
        snapshot(updated.quantities),
        operation,
        actor,
        session,
      );
      result = updated;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function adjustStock(
  batchId: string,
  newOnHand: number,
  reason: string,
  idempotencyKey: string,
  actor: Actor,
) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const duplicate = await StockMovement.findOne({ idempotencyKey }).session(session);
      if (duplicate) {
        result = await MedicineBatch.findById(duplicate.batchId).session(session);
        return;
      }
      const batch = await MedicineBatch.findById(batchId).session(session);
      if (!batch)
        throw Object.assign(new Error('Batch not found'), { statusCode: 404, code: 'NOT_FOUND' });
      const committed =
        batch.quantities.reserved + batch.quantities.picking + batch.quantities.packed;
      const unavailable =
        batch.quantities.damaged + batch.quantities.expired + batch.quantities.quarantined;
      if (newOnHand < committed)
        throw Object.assign(new Error('Adjustment cannot reduce stock below committed quantity'), {
          statusCode: 409,
          code: 'INSUFFICIENT_STOCK',
        });
      let available: number;
      try {
        available = availableAfterAdjustment(newOnHand, committed, unavailable);
      } catch (error) {
        throw Object.assign(error as Error, { statusCode: 409, code: 'NEGATIVE_STOCK' });
      }
      const before = snapshot(batch.quantities);
      batch.quantities.onHand = newOnHand;
      batch.quantities.available = available;
      batch.version += 1;
      await batch.save({ session });
      await createMovement(
        batch,
        before,
        snapshot(batch.quantities),
        {
          type: StockMovementType.ADJUSTMENT,
          quantity: newOnHand - before.onHand,
          reason,
          idempotencyKey,
        },
        actor,
        session,
      );
      result = batch;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Applies one customer-return stock movement inside a caller-owned transaction.
 * Returns must book stock in the same transaction that advances the Return
 * document, so unlike `applyStockOperation` this never opens a session of its
 * own. Replaying the same idempotency key is a no-op rather than an error.
 */
export async function applyReturnMovement(
  batchId: Types.ObjectId | string,
  operation: Operation,
  actor: Actor,
  session: ClientSession,
) {
  if (!RETURN_STOCK_MOVEMENTS.includes(operation.type)) {
    throw Object.assign(new Error('Not a customer-return stock movement'), {
      statusCode: 400,
      code: 'INVALID_OPERATION',
    });
  }
  if (!Number.isSafeInteger(operation.quantity) || operation.quantity <= 0) {
    throw Object.assign(new Error('Return quantity must be a positive integer'), {
      statusCode: 400,
      code: 'INVALID_QUANTITY',
    });
  }
  const existing = await StockMovement.findOne({
    idempotencyKey: operation.idempotencyKey,
  }).session(session);
  if (existing)
    return {
      batch: await MedicineBatch.findById(existing.batchId).session(session),
      replayed: true,
    };

  const receipt = operation.type === StockMovementType.RETURN_RECEIPT;
  const transition = transitions[operation.type];
  if (!receipt && !transition) {
    throw Object.assign(new Error('Unsupported return stock movement'), {
      statusCode: 400,
      code: 'INVALID_OPERATION',
    });
  }

  const increments: Record<string, number> = receipt
    ? { 'quantities.onHand': operation.quantity, 'quantities.returned': operation.quantity }
    : {
        [`quantities.${transition!.from}`]: -operation.quantity,
        [`quantities.${transition!.to}`]: operation.quantity,
        ...(reducesOnHand.includes(operation.type)
          ? { 'quantities.onHand': -operation.quantity }
          : {}),
      };

  // A receipt only adds, so it has no source bucket to guard against.
  const guard = receipt ? {} : { [`quantities.${transition!.from}`]: { $gte: operation.quantity } };
  const before = await MedicineBatch.findOne({ _id: batchId, ...guard }).session(session);
  if (!before) {
    throw Object.assign(new Error('Batch not found or holds insufficient returned stock'), {
      statusCode: 409,
      code: 'INSUFFICIENT_STOCK',
    });
  }
  const updated = await MedicineBatch.findOneAndUpdate(
    { _id: batchId, version: before.version, ...guard },
    { $inc: { ...increments, version: 1 } },
    { new: true, session },
  );
  if (!updated) {
    throw Object.assign(new Error('Inventory changed concurrently; retry the receipt'), {
      statusCode: 409,
      code: 'CONCURRENT_STOCK_CHANGE',
    });
  }
  await createMovement(
    updated,
    snapshot(before.quantities),
    snapshot(updated.quantities),
    operation,
    actor,
    session,
  );
  return { batch: updated, replayed: false };
}

export async function reserveFefo(
  medicineId: string,
  quantity: number,
  idempotencyKey: string,
  referenceType: string,
  referenceId: string,
  actor: Actor,
) {
  const session = await mongoose.startSession();
  try {
    const allocations: unknown[] = [];
    await session.withTransaction(async () => {
      const escapedKey = idempotencyKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const idempotencyFilter = {
        referenceType,
        referenceId,
        idempotencyKey: { $regex: `^${escapedKey}:` },
      };
      const existing = await StockMovement.find(idempotencyFilter).session(session);
      if (existing.length) {
        allocations.push(...existing);
        return;
      }
      const batches = await MedicineBatch.find({
        medicineId,
        isBlocked: false,
        isQuarantined: false,
        expiryDate: { $gt: new Date() },
        'quantities.available': { $gt: 0 },
      })
        .sort({ expiryDate: 1, createdAt: 1 })
        .session(session);
      let plan;
      try {
        plan = planFefoAllocation(
          batches.map((batch) => ({
            id: String(batch._id),
            expiryDate: batch.expiryDate,
            available: batch.quantities.available,
            isBlocked: batch.isBlocked,
            isQuarantined: batch.isQuarantined,
          })),
          quantity,
        );
      } catch (error) {
        throw Object.assign(error as Error, { statusCode: 409, code: 'INSUFFICIENT_STOCK' });
      }
      for (const allocation of plan) {
        const beforeBatch = batches.find((batch) => String(batch._id) === allocation.batchId)!;
        const updated = await MedicineBatch.findOneAndUpdate(
          {
            _id: allocation.batchId,
            version: beforeBatch.version,
            'quantities.available': { $gte: allocation.quantity },
            isBlocked: false,
            isQuarantined: false,
            expiryDate: { $gt: new Date() },
          },
          {
            $inc: {
              'quantities.available': -allocation.quantity,
              'quantities.reserved': allocation.quantity,
              version: 1,
            },
          },
          { new: true, session },
        );
        if (!updated)
          throw Object.assign(new Error('Inventory changed concurrently; retry reservation'), {
            statusCode: 409,
            code: 'CONCURRENT_STOCK_CHANGE',
          });
        const operation = {
          type: StockMovementType.RESERVATION,
          quantity: allocation.quantity,
          reason: 'FEFO reservation',
          idempotencyKey: `${idempotencyKey}:${allocation.batchId}`,
          referenceType,
          referenceId,
        };
        await createMovement(
          updated,
          snapshot(beforeBatch.quantities),
          snapshot(updated.quantities),
          operation,
          actor,
          session,
        );
        allocations.push(updated);
      }
    });
    return allocations;
  } finally {
    await session.endSession();
  }
}
