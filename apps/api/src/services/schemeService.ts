import { Types } from 'mongoose';
import { Scheme } from '../models/Scheme';

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
