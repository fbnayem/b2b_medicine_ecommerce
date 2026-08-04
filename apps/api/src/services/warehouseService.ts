import mongoose, { Types } from 'mongoose';
import { UserRole } from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { MedicineBatch } from '../models/MedicineBatch';
import { Warehouse } from '../models/Warehouse';
import { nextReference } from '../models/Counter';

type Actor = { _id: Types.ObjectId; role: UserRole };

/**
 * Where stock is held.
 *
 * The whole design rests on one property: **everything that does not name a
 * warehouse belongs to the default one.** That is what lets an operation with a
 * single godown carry on exactly as before while the second depot becomes a
 * data change rather than a migration of every batch in the system.
 */

function failure(message: string, code: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

/**
 * The default warehouse, created on first use.
 *
 * Lazily rather than by a migration, because a migration that has to run before
 * the application works is a migration somebody will forget on a fresh clone —
 * which is the class of defect phase 0 was spent on.
 */
export async function defaultWarehouse(actor?: Actor) {
  const existing = await Warehouse.findOne({ isDefault: true });
  if (existing) return existing;
  if (!actor) return null;

  return Warehouse.create({
    reference: await nextReference('WHS'),
    code: 'MAIN',
    name: 'Main warehouse',
    isDefault: true,
    createdBy: actor._id,
  });
}

export interface CreateWarehouseInput {
  code: string;
  name: string;
  address?: { line1?: string; city?: string; district?: string };
  contactPhone?: string;
  notes?: string;
  makeDefault?: boolean;
}

export async function createWarehouse(input: CreateWarehouseInput, actor: Actor) {
  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      const duplicate = await Warehouse.findOne({ code: input.code.toUpperCase() }).session(
        session,
      );
      if (duplicate) {
        throw failure(`A warehouse already uses the code ${input.code}`, 'DUPLICATE_CODE', 409);
      }

      const first = (await Warehouse.countDocuments({}).session(session)) === 0;
      const becomesDefault = first || Boolean(input.makeDefault);

      /*
       * One default, moved rather than added. Two defaults would make "which
       * warehouse does this batch belong to" ambiguous for every batch that
       * names none, which is all of them today.
       */
      if (becomesDefault) {
        await Warehouse.updateMany({ isDefault: true }, { isDefault: false }, { session });
      }

      const [warehouse] = await Warehouse.create(
        [
          {
            reference: await nextReference('WHS'),
            code: input.code.toUpperCase(),
            name: input.name,
            address: input.address,
            contactPhone: input.contactPhone,
            notes: input.notes,
            isDefault: becomesDefault,
            createdBy: actor._id,
          },
        ],
        { session },
      );

      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'WAREHOUSE_CREATED',
            entityType: 'Warehouse',
            entityId: warehouse!._id,
            after: { code: warehouse!.code, name: warehouse!.name, isDefault: becomesDefault },
          },
        ],
        { session },
      );

      created = warehouse;
    });
    return created;
  } finally {
    await session.endSession();
  }
}

/**
 * What each warehouse is holding.
 *
 * Batches that name no warehouse are counted against the default, which is the
 * same rule the rest of the system follows and the reason a one-godown
 * operation sees its whole stock here without anything having been backfilled.
 */
export async function warehouseStock() {
  const fallback = await defaultWarehouse();
  const warehouses = await Warehouse.find({}).sort({ isDefault: -1, code: 1 }).lean();

  const grouped = await MedicineBatch.aggregate([
    {
      $group: {
        _id: '$warehouseId',
        batches: { $sum: 1 },
        onHand: { $sum: '$quantities.onHand' },
        available: { $sum: '$quantities.available' },
      },
    },
  ]);

  const byWarehouse = new Map<string, { batches: number; onHand: number; available: number }>();
  for (const row of grouped) {
    // `null` is "belongs to the default", not "belongs to nothing".
    const key = row._id ? String(row._id) : String(fallback?._id ?? 'unassigned');
    const existing = byWarehouse.get(key) ?? { batches: 0, onHand: 0, available: 0 };
    byWarehouse.set(key, {
      batches: existing.batches + row.batches,
      onHand: existing.onHand + row.onHand,
      available: existing.available + row.available,
    });
  }

  return warehouses.map((warehouse) => ({
    ...warehouse,
    stock: byWarehouse.get(String(warehouse._id)) ?? { batches: 0, onHand: 0, available: 0 },
  }));
}

/**
 * Resolves whichever warehouse a caller meant.
 *
 * Absent means the default, which is what every existing caller passes and why
 * nothing had to change to add this.
 */
export async function resolveWarehouseId(
  warehouseId: string | undefined,
  actor: Actor,
): Promise<Types.ObjectId | undefined> {
  if (warehouseId) {
    const named = await Warehouse.findById(warehouseId);
    if (!named) throw failure('That warehouse does not exist', 'WAREHOUSE_NOT_FOUND', 404);
    if (!named.isActive) throw failure('That warehouse is closed', 'WAREHOUSE_INACTIVE', 409);
    return named._id;
  }
  const fallback = await defaultWarehouse(actor);
  return fallback?._id;
}
