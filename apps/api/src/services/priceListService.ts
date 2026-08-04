import mongoose, { Types } from 'mongoose';
import { UserRole } from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { Medicine } from '../models/Medicine';
import { PriceList } from '../models/PriceList';
import { Shop } from '../models/Shop';
import { nextReference } from '../models/Counter';

/**
 * Editing what a group of customers pays.
 *
 * `PriceList` and the resolver have existed since Phase 8 and nothing could
 * write either: the middle tier of the precedence — shop override → **price
 * list** → medicine default — was reachable only by marking one list the
 * default, and even that could not be set. A price list nobody can edit prices
 * nothing.
 */

type Actor = { _id: Types.ObjectId; role: UserRole };

function failure(message: string, code: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

export interface PriceListLineInput {
  medicineId: string;
  unitPriceMinor: number;
  discountPercent?: number;
}

export interface PriceListInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
  validFrom?: Date;
  validTo?: Date;
  lines?: PriceListLineInput[];
}

/**
 * Every medicine a list names has to exist.
 *
 * Not a formality: a line against a deleted or mistyped id prices nothing, and
 * because `resolvePriceFrom` falls through to the medicine's own price when it
 * finds no line, the customer is quietly charged the wrong amount rather than
 * seeing an error.
 */
async function assertMedicinesExist(lines: readonly PriceListLineInput[]) {
  if (lines.length === 0) return;

  const ids = [...new Set(lines.map((line) => line.medicineId))];
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  const found = await Medicine.find({ _id: { $in: valid } })
    .select('_id')
    .lean();

  if (found.length !== ids.length) {
    const known = new Set(found.map((medicine) => String(medicine._id)));
    const missing = ids.filter((id) => !known.has(id));
    throw failure(
      `${missing.length} of the priced medicines could not be found`,
      'MEDICINE_NOT_FOUND',
      404,
    );
  }
}

export async function createPriceList(input: PriceListInput, actor: Actor) {
  const lines = input.lines ?? [];
  await assertMedicinesExist(lines);

  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      /*
       * One default, moved rather than added. Two would make "which list prices
       * this shop" ambiguous for every shop assigned none, which is all of them
       * until somebody assigns one.
       */
      if (input.isDefault) {
        await PriceList.updateMany({ isDefault: true }, { isDefault: false }, { session });
      }

      const [list] = await PriceList.create(
        [
          {
            reference: await nextReference('PRC'),
            name: input.name,
            description: input.description,
            isDefault: Boolean(input.isDefault),
            isActive: input.isActive ?? true,
            validFrom: input.validFrom,
            validTo: input.validTo,
            lines: lines.map((line) => ({
              medicineId: new Types.ObjectId(line.medicineId),
              unitPriceMinor: line.unitPriceMinor,
              discountPercent: line.discountPercent ?? 0,
            })),
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
            action: 'PRICE_LIST_CREATED',
            entityType: 'PriceList',
            entityId: list!._id,
            after: { reference: list!.reference, name: list!.name, lines: lines.length },
          },
        ],
        { session },
      );

      created = list;
    });
    return created!;
  } finally {
    await session.endSession();
  }
}

/**
 * Replaces the list wholesale, under an optimistic version.
 *
 * A price list is edited as a sheet, so a partial line update would need the
 * client and the server to agree on what the other thought the lines were —
 * the same reasoning as `resequenceTrip`. The version is what stops two people
 * editing the same sheet from silently discarding each other's prices, which on
 * a price list means charging a customer an amount nobody chose.
 */
export async function updatePriceList(
  priceListId: string,
  version: number,
  input: PriceListInput,
  actor: Actor,
) {
  if (input.lines) await assertMedicinesExist(input.lines);

  const session = await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async () => {
      const list = await PriceList.findById(priceListId).session(session);
      if (!list) throw failure('Price list not found', 'NOT_FOUND', 404);
      if (list.version !== version) {
        throw failure('Somebody else has changed this price list', 'VERSION_CONFLICT', 409);
      }

      const before = {
        name: list.name,
        isDefault: list.isDefault,
        isActive: list.isActive,
        lines: list.lines.length,
      };

      if (input.isDefault) {
        await PriceList.updateMany(
          { isDefault: true, _id: { $ne: list._id } },
          { isDefault: false },
          { session },
        );
      }

      if (input.name !== undefined) list.name = input.name;
      if (input.description !== undefined) list.description = input.description;
      if (input.isDefault !== undefined) list.isDefault = input.isDefault;
      if (input.isActive !== undefined) list.isActive = input.isActive;
      if (input.validFrom !== undefined) list.validFrom = input.validFrom;
      if (input.validTo !== undefined) list.validTo = input.validTo;
      if (input.lines) {
        list.lines = input.lines.map((line) => ({
          medicineId: new Types.ObjectId(line.medicineId),
          unitPriceMinor: line.unitPriceMinor,
          discountPercent: line.discountPercent ?? 0,
        })) as typeof list.lines;
      }

      list.version += 1;
      await list.save({ session });

      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'PRICE_LIST_UPDATED',
            entityType: 'PriceList',
            entityId: list._id,
            before,
            after: {
              name: list.name,
              isDefault: list.isDefault,
              isActive: list.isActive,
              lines: list.lines.length,
            },
          },
        ],
        { session },
      );

      updated = list;
    });
    return updated!;
  } finally {
    await session.endSession();
  }
}

export interface ListPriceListsOptions {
  page?: number;
  limit?: number;
  activeOnly?: boolean;
}

/**
 * The lists, with how many customers each one prices.
 *
 * The shop count is the figure that tells an administrator whether a list is
 * live work or an abandoned draft, and it is the question they ask before
 * changing a price. One grouped read rather than one per row.
 */
export async function listPriceLists(options: ListPriceListsOptions = {}) {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));

  const filter = options.activeOnly ? { isActive: true } : {};
  const [items, total, counts] = await Promise.all([
    PriceList.find(filter)
      .sort({ isDefault: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PriceList.countDocuments(filter),
    Shop.aggregate<{ _id: Types.ObjectId; shops: number }>([
      { $match: { priceListId: { $ne: null } } },
      { $group: { _id: '$priceListId', shops: { $sum: 1 } } },
    ]),
  ]);

  const byList = new Map(counts.map((row) => [String(row._id), row.shops]));
  return {
    items: items.map((list) => ({
      ...list,
      lines: list.lines.map((line) => ({ ...line, medicineId: String(line.medicineId) })),
      shopCount: byList.get(String(list._id)) ?? 0,
    })),
    total,
    page,
    limit,
  };
}

/**
 * One list, with each line named.
 *
 * The lines carry a medicine id and nothing else, so a screen rendering the
 * sheet would otherwise make one request per row — and `AGENTS.md` forbids
 * showing the id itself, so the brand name is not optional decoration.
 */
export async function getPriceList(priceListId: string) {
  const list = await PriceList.findById(priceListId).lean();
  if (!list) throw failure('Price list not found', 'NOT_FOUND', 404);

  const medicines = await Medicine.find({ _id: { $in: list.lines.map((line) => line.medicineId) } })
    .select('brandName sku strength')
    .lean();
  const byId = new Map(medicines.map((medicine) => [String(medicine._id), medicine]));

  const shopCount = await Shop.countDocuments({ priceListId: list._id });

  return {
    ...list,
    shopCount,
    lines: list.lines.map((line) => {
      const medicine = byId.get(String(line.medicineId));
      return {
        ...line,
        medicineId: String(line.medicineId),
        medicineBrandName: medicine
          ? `${medicine.brandName} ${medicine.strength}`.trim()
          : undefined,
        medicineSku: medicine?.sku,
      };
    }),
  };
}

/**
 * Whether a shop may be assigned this list.
 *
 * An inactive list assigned to a customer is a price that silently does not
 * apply: `priceListForShop` skips a list not in force and falls through to the
 * default, so the shop is charged from a list nobody chose for them.
 */
export async function assertPriceListAssignable(priceListId: string) {
  if (!Types.ObjectId.isValid(priceListId)) {
    throw failure('That price list does not exist', 'PRICE_LIST_NOT_FOUND', 404);
  }
  const list = await PriceList.findById(priceListId).select('isActive').lean();
  if (!list) throw failure('That price list does not exist', 'PRICE_LIST_NOT_FOUND', 404);
  if (!list.isActive) {
    throw failure('That price list is not active', 'PRICE_LIST_INACTIVE', 409);
  }
}
