import { Types } from 'mongoose';
import { PriceList } from '../models/PriceList';

/**
 * What one customer pays for one medicine, and why.
 *
 * `orderService` read `medicine.defaultSellingPriceMinor` and
 * `shop.defaultDiscount` on two adjacent lines: one price for everybody, one
 * percentage per customer, and no record of where either came from. This
 * replaces both, at that same hook point, and the important half is the
 * **source**: a price that cannot say where it came from is a price nobody can
 * defend, and disputes about price are the ordinary case in this trade.
 *
 * Precedence, settled in `docs/ASSUMPTIONS.md`: **shop override → assigned
 * price list → medicine default.** The most specific arrangement wins.
 */

export const PriceSource = {
  /** `Shop.defaultDiscount` — an arrangement with this one customer. */
  SHOP_OVERRIDE: 'SHOP_OVERRIDE',
  PRICE_LIST: 'PRICE_LIST',
  MEDICINE_DEFAULT: 'MEDICINE_DEFAULT',
} as const;
export type PriceSource = (typeof PriceSource)[keyof typeof PriceSource];

export interface ResolvedPrice {
  unitPriceMinor: number;
  discountPercent: number;
  source: PriceSource;
  priceListReference?: string;
}

export interface PricingMedicine {
  _id: Types.ObjectId | string;
  defaultSellingPriceMinor: number;
}

export interface PricingShop {
  defaultDiscount?: number;
  priceListId?: Types.ObjectId | string | null;
}

/**
 * A list is in force at a moment when it is active and the moment sits inside
 * whatever bounds it declares.
 *
 * Both bounds are optional, and an absent bound is not a closed one: a list
 * with no `validTo` runs until somebody ends it, which is how most price lists
 * in this trade actually work.
 */
export function priceListInForce(
  list: { isActive?: boolean; validFrom?: Date | null; validTo?: Date | null },
  at: Date,
): boolean {
  if (list.isActive === false) return false;
  if (list.validFrom && at < list.validFrom) return false;
  if (list.validTo && at > list.validTo) return false;
  return true;
}

/**
 * Resolves the price without touching the database.
 *
 * Split out so the precedence is testable on its own — it is the part that
 * decides what a customer is charged, and it should not need a database to be
 * proved correct.
 */
export function resolvePriceFrom(
  medicine: PricingMedicine,
  shop: PricingShop,
  list:
    | {
        reference: string;
        lines: Array<{
          medicineId: Types.ObjectId | string;
          unitPriceMinor: number;
          discountPercent?: number;
        }>;
      }
    | null
    | undefined,
): ResolvedPrice {
  const shopDiscount = shop.defaultDiscount ?? 0;

  /*
   * A per-customer discount is the most specific arrangement there is, so it
   * wins outright. It applies to the medicine's own price rather than to the
   * list's: a customer who negotiated "ten percent off" negotiated it against
   * the ordinary price, and quietly applying it to a cheaper list price would
   * hand them a bigger concession than either party agreed.
   */
  if (shopDiscount > 0) {
    return {
      unitPriceMinor: medicine.defaultSellingPriceMinor,
      discountPercent: shopDiscount,
      source: PriceSource.SHOP_OVERRIDE,
    };
  }

  const line = list?.lines.find((entry) => String(entry.medicineId) === String(medicine._id));
  if (list && line) {
    return {
      unitPriceMinor: line.unitPriceMinor,
      discountPercent: line.discountPercent ?? 0,
      source: PriceSource.PRICE_LIST,
      priceListReference: list.reference,
    };
  }

  /*
   * A list that does not name this medicine is not a list that prices it at
   * zero. Falling through to the medicine's own price is the only safe reading,
   * and the source says so.
   */
  return {
    unitPriceMinor: medicine.defaultSellingPriceMinor,
    discountPercent: 0,
    source: PriceSource.MEDICINE_DEFAULT,
  };
}

/**
 * The list a shop is priced from: its own, or the default, or none.
 *
 * One read per order rather than one per line — an order of forty lines against
 * one shop asks the same question forty times otherwise.
 */
export async function priceListForShop(shop: PricingShop, at: Date = new Date()) {
  if (shop.priceListId) {
    const assigned = await PriceList.findById(shop.priceListId).lean();
    if (assigned && priceListInForce(assigned, at)) return assigned;
  }
  const fallback = await PriceList.findOne({ isDefault: true, isActive: true }).lean();
  return fallback && priceListInForce(fallback, at) ? fallback : null;
}

/** The margin a pharmacy makes, in basis points. Derived, never stored. */
export function marginBasisPoints(
  mrpMinor: number | undefined,
  tradeMinor: number,
): number | undefined {
  // No MRP means no answer, which is different from a margin of zero. A
  // catalogue that has not been backfilled must not report every product as
  // sold at cost.
  if (!mrpMinor || mrpMinor <= 0) return undefined;
  return Math.round(((mrpMinor - tradeMinor) * 10_000) / mrpMinor);
}
