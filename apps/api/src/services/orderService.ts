import { Types } from 'mongoose';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { Shop } from '../models/Shop';
import { calculateOrderEstimate } from './orderPricing';
import { priceListForShop, resolvePriceFrom, type ResolvedPrice } from './pricingService';
import { freeUnitsFor, schemesForOrder } from './schemeService';

export type OrderInput = {
  items: Array<{ medicineId: string; requestedQuantity: number; shopNotes?: string }>;
  deliveryAddressId?: string;
  requestedPaymentMethod?: string;
  purchaseOrderReference?: string;
  shopNotes?: string;
};
export async function buildOrderSnapshot(shopId: Types.ObjectId, input: OrderInput) {
  const ids = input.items.map((item) => String(item.medicineId));
  if (new Set(ids).size !== ids.length)
    throw Object.assign(new Error('A medicine may appear only once'), {
      statusCode: 400,
      code: 'DUPLICATE_ITEM',
    });
  const [shop, medicines, availability] = await Promise.all([
    Shop.findById(shopId),
    Medicine.find({ _id: { $in: ids }, isActive: true }),
    MedicineBatch.aggregate([
      {
        $match: {
          medicineId: { $in: ids.map((id) => new Types.ObjectId(id)) },
          isBlocked: false,
          isQuarantined: false,
          expiryDate: { $gt: new Date() },
        },
      },
      { $group: { _id: '$medicineId', available: { $sum: '$quantities.available' } } },
    ]),
  ]);
  if (!shop)
    throw Object.assign(new Error('Shop not found'), { statusCode: 404, code: 'NOT_FOUND' });
  if (medicines.length !== ids.length)
    throw Object.assign(new Error('One or more medicines are unavailable'), {
      statusCode: 400,
      code: 'MEDICINE_UNAVAILABLE',
    });
  const map = new Map(medicines.map((medicine) => [String(medicine._id), medicine]));
  const availableMap = new Map(
    availability.map((row) => [String(row._id), row.available as number]),
  );
  for (const item of input.items) {
    const medicine = map.get(item.medicineId)!;
    if (
      item.requestedQuantity < medicine.minimumOrderQuantity ||
      (medicine.maximumOrderQuantity && item.requestedQuantity > medicine.maximumOrderQuantity)
    )
      throw Object.assign(new Error(`${medicine.brandName} quantity is outside its order limits`), {
        statusCode: 400,
        code: 'QUANTITY_INVALID',
      });
  }
  /*
   * What this customer pays, and why.
   *
   * These two lines read `medicine.defaultSellingPriceMinor` and
   * `shop.defaultDiscount` directly: one price for everybody, one percentage
   * per customer, and no record of where either came from. `resolvePriceFrom`
   * replaces both at the same point, and the important half is the **source**,
   * which is snapshotted onto the line — a price that cannot say where it came
   * from is a price nobody can defend, and disputes about price are the
   * ordinary case in this trade.
   *
   * One list read for the whole order rather than one per line.
   */
  const priceList = await priceListForShop(shop);
  /*
   * Free goods, resolved beside the price and at the same hook point.
   *
   * `requestedQuantity` stays the chargeable quantity throughout; the free
   * units ride alongside it, so `calculateOrderEstimate` below prices exactly
   * what it always priced.
   */
  const schemes = await schemesForOrder(
    input.items.map((item) => item.medicineId),
    shop._id,
  );
  const resolved = new Map<string, ResolvedPrice>(
    input.items.map((item) => [
      item.medicineId,
      resolvePriceFrom(map.get(item.medicineId)!, shop, priceList),
    ]),
  );

  const priced = calculateOrderEstimate(
    input.items.map((item) => {
      const price = resolved.get(item.medicineId)!;
      return {
        medicineId: item.medicineId,
        quantity: item.requestedQuantity,
        unitPriceMinor: price.unitPriceMinor,
        discountPercent: price.discountPercent,
        available: availableMap.get(item.medicineId) ?? 0,
      };
    }),
  );
  const items = input.items.map((item) => {
    const medicine = map.get(item.medicineId)!;
    const price = priced.items.find((value) => value.medicineId === item.medicineId)!;
    return {
      medicineId: medicine._id,
      medicineSnapshot: {
        reference: medicine.reference,
        sku: medicine.sku,
        brandName: medicine.brandName,
        genericName: medicine.genericName,
        manufacturer: medicine.manufacturer,
        strength: medicine.strength,
        dosageForm: medicine.dosageForm,
        packSize: medicine.packSize,
        unit: medicine.unit,
      },
      requestedQuantity: item.requestedQuantity,
      // Dispatched but not charged. Zero unless a scheme applies, which is why
      // nothing already in the database needed touching.
      freeQuantity: freeUnitsFor(item.requestedQuantity, schemes.get(item.medicineId)),
      schemeReference: schemes.get(item.medicineId)?.reference,
      estimatedUnitPriceMinor: resolved.get(item.medicineId)!.unitPriceMinor,
      // Where the price came from, on the line. A price change next month
      // cannot rewrite what was ordered, and a dispute can be answered from
      // the order rather than by reconstructing a list's history.
      priceSource: resolved.get(item.medicineId)!.source,
      priceListReference: resolved.get(item.medicineId)!.priceListReference,
      estimatedDiscountMinor: price.discountMinor,
      estimatedLineTotalMinor: price.lineTotalMinor,
      availableStockSnapshot: price.available,
      shopNotes: item.shopNotes,
    };
  });
  return {
    shop,
    items,
    estimatedSubtotalMinor: priced.subtotalMinor,
    estimatedDiscountMinor: priced.discountMinor,
    estimatedDeliveryChargeMinor: priced.deliveryChargeMinor,
    estimatedTotalMinor: priced.totalMinor,
  };
}
