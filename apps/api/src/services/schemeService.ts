import { Types } from 'mongoose';
import { UserRole } from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { Medicine } from '../models/Medicine';
import { Scheme } from '../models/Scheme';
import { nextReference } from '../models/Counter';

/**
 * Free goods, resolved beside the price.
 *
 * The whole design rests on one property, which is also what makes it safe to
 * add next to a double-entry ledger: **`quantity` stays the chargeable quantity
 * and `freeQuantity` rides alongside it.** Allocation asks for
 * `quantity + freeQuantity` so the warehouse picks eleven; the invoice
 * arithmetic is untouched, because it prices `quantity`. The money does not
 * move — only the dispatched count does.
 *
 * `freeQuantity` defaults to `0`, so **every invoice already issued reads
 * correctly with no backfill** — which is required rather than convenient, since
 * `Invoice.ts` forbids mutating an issued invoice.
 */

export interface SchemeTerms {
  reference: string;
  buyQuantity: number;
  freeQuantity: number;
}

/**
 * How many free units a chargeable quantity earns.
 *
 * Whole multiples only. Nine units under a 10+1 earns nothing, because that is
 * what the offer says — and rounding up here would be a discount nobody agreed
 * to, applied silently, on every short line.
 */
export function freeUnitsFor(quantity: number, terms: SchemeTerms | null | undefined): number {
  if (!terms || terms.buyQuantity <= 0 || quantity <= 0) return 0;
  return Math.floor(quantity / terms.buyQuantity) * terms.freeQuantity;
}

export function schemeInForce(
  scheme: { isActive?: boolean; validFrom?: Date | null; validTo?: Date | null },
  at: Date,
): boolean {
  if (scheme.isActive === false) return false;
  if (scheme.validFrom && at < scheme.validFrom) return false;
  if (scheme.validTo && at > scheme.validTo) return false;
  return true;
}

/**
 * Whether a scheme applies to this customer.
 *
 * Empty `shopIds` means every customer, which is the ordinary case — a
 * supplier's 10+1 runs for everybody. A named list confines it.
 */
export function schemeAppliesToShop(
  scheme: { shopIds?: Array<Types.ObjectId | string> },
  shopId: Types.ObjectId | string,
): boolean {
  if (!scheme.shopIds || scheme.shopIds.length === 0) return true;
  return scheme.shopIds.some((id) => String(id) === String(shopId));
}

/**
 * The schemes in force for one order, keyed by medicine.
 *
 * One read for the whole order. Where two schemes could apply to the same
 * medicine the **more generous** wins — a customer told about an offer should
 * get it, and picking the stingier of two would be a decision nobody made out
 * loud.
 */
export async function schemesForOrder(
  medicineIds: readonly string[],
  shopId: Types.ObjectId | string,
  at: Date = new Date(),
): Promise<Map<string, SchemeTerms>> {
  if (medicineIds.length === 0) return new Map();

  const candidates = await Scheme.find({
    medicineId: { $in: medicineIds.map((id) => new Types.ObjectId(id)) },
    isActive: true,
  }).lean();

  const best = new Map<string, SchemeTerms>();
  for (const scheme of candidates) {
    if (!schemeInForce(scheme, at)) continue;
    if (!schemeAppliesToShop(scheme, shopId)) continue;

    const key = String(scheme.medicineId);
    const terms: SchemeTerms = {
      reference: scheme.reference,
      buyQuantity: scheme.buyQuantity,
      freeQuantity: scheme.freeQuantity,
    };
    const existing = best.get(key);
    // Free units per chargeable unit, so 20+3 beats 10+1.
    if (!existing || rate(terms) > rate(existing)) best.set(key, terms);
  }
  return best;
}

function rate(terms: SchemeTerms): number {
  return terms.freeQuantity / terms.buyQuantity;
}

/*
 * ── Setting the offers ──────────────────────────────────────────────────────
 *
 * The resolver above has been in the order path since the schemes landed, and
 * nothing could create a scheme for it to find.
 */

type Actor = { _id: Types.ObjectId; role: UserRole };

function failure(message: string, code: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

export interface SchemeInput {
  name?: string;
  medicineId?: string;
  buyQuantity?: number;
  freeQuantity?: number;
  validFrom?: Date;
  validTo?: Date;
  shopIds?: string[];
  isActive?: boolean;
  notes?: string;
}

async function assertMedicineExists(medicineId: string) {
  if (!Types.ObjectId.isValid(medicineId)) {
    throw failure('That medicine does not exist', 'MEDICINE_NOT_FOUND', 404);
  }
  const medicine = await Medicine.findById(medicineId).select('_id').lean();
  if (!medicine) throw failure('That medicine does not exist', 'MEDICINE_NOT_FOUND', 404);
}

export async function createScheme(input: SchemeInput, actor: Actor) {
  await assertMedicineExists(input.medicineId!);

  const scheme = await Scheme.create({
    reference: await nextReference('SCH'),
    name: input.name,
    medicineId: new Types.ObjectId(input.medicineId!),
    buyQuantity: input.buyQuantity,
    freeQuantity: input.freeQuantity,
    validFrom: input.validFrom,
    validTo: input.validTo,
    shopIds: (input.shopIds ?? []).map((id) => new Types.ObjectId(id)),
    isActive: input.isActive ?? true,
    notes: input.notes,
    createdBy: actor._id,
  });

  await AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    action: 'SCHEME_CREATED',
    entityType: 'Scheme',
    entityId: scheme._id,
    after: {
      reference: scheme.reference,
      name: scheme.name,
      terms: `${scheme.buyQuantity}+${scheme.freeQuantity}`,
    },
  });

  return scheme;
}

/**
 * Changing an offer, under an optimistic version.
 *
 * Nothing here touches an order already placed: `schemesForOrder` resolves the
 * free units at submission and the order line records what it was given, so
 * ending a scheme stops the next order rather than restating the last one.
 */
export async function updateScheme(
  schemeId: string,
  version: number,
  input: SchemeInput,
  actor: Actor,
) {
  const scheme = await Scheme.findById(schemeId);
  if (!scheme) throw failure('Scheme not found', 'NOT_FOUND', 404);
  if (scheme.version !== version) {
    throw failure('Somebody else has changed this scheme', 'VERSION_CONFLICT', 409);
  }
  if (input.medicineId) await assertMedicineExists(input.medicineId);

  const before = {
    name: scheme.name,
    terms: `${scheme.buyQuantity}+${scheme.freeQuantity}`,
    isActive: scheme.isActive,
  };

  if (input.name !== undefined) scheme.name = input.name;
  if (input.medicineId !== undefined) scheme.medicineId = new Types.ObjectId(input.medicineId);
  if (input.buyQuantity !== undefined) scheme.buyQuantity = input.buyQuantity;
  if (input.freeQuantity !== undefined) scheme.freeQuantity = input.freeQuantity;
  if (input.validFrom !== undefined) scheme.validFrom = input.validFrom;
  if (input.validTo !== undefined) scheme.validTo = input.validTo;
  if (input.shopIds !== undefined) {
    scheme.shopIds = input.shopIds.map((id) => new Types.ObjectId(id)) as typeof scheme.shopIds;
  }
  if (input.isActive !== undefined) scheme.isActive = input.isActive;
  if (input.notes !== undefined) scheme.notes = input.notes;

  scheme.version += 1;
  await scheme.save();

  await AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    action: 'SCHEME_UPDATED',
    entityType: 'Scheme',
    entityId: scheme._id,
    before,
    after: {
      name: scheme.name,
      terms: `${scheme.buyQuantity}+${scheme.freeQuantity}`,
      isActive: scheme.isActive,
    },
  });

  return scheme;
}

export interface ListSchemesOptions {
  page?: number;
  limit?: number;
  activeOnly?: boolean;
}

/** Every offer, each naming the medicine it runs on rather than its id. */
export async function listSchemes(options: ListSchemesOptions = {}) {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const filter = options.activeOnly ? { isActive: true } : {};

  const [items, total] = await Promise.all([
    Scheme.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Scheme.countDocuments(filter),
  ]);

  const medicines = await Medicine.find({ _id: { $in: items.map((row) => row.medicineId) } })
    .select('brandName sku strength')
    .lean();
  const byId = new Map(medicines.map((medicine) => [String(medicine._id), medicine]));

  return {
    items: items.map((scheme) => {
      const medicine = byId.get(String(scheme.medicineId));
      return {
        ...scheme,
        medicineId: String(scheme.medicineId),
        shopIds: scheme.shopIds.map((id) => String(id)),
        medicineBrandName: medicine
          ? `${medicine.brandName} ${medicine.strength}`.trim()
          : undefined,
        medicineSku: medicine?.sku,
      };
    }),
    total,
    page,
    limit,
  };
}

export async function getScheme(schemeId: string) {
  const scheme = await Scheme.findById(schemeId).lean();
  if (!scheme) throw failure('Scheme not found', 'NOT_FOUND', 404);

  const medicine = await Medicine.findById(scheme.medicineId)
    .select('brandName sku strength')
    .lean();

  return {
    ...scheme,
    medicineId: String(scheme.medicineId),
    shopIds: scheme.shopIds.map((id) => String(id)),
    medicineBrandName: medicine ? `${medicine.brandName} ${medicine.strength}`.trim() : undefined,
    medicineSku: medicine?.sku,
  };
}
