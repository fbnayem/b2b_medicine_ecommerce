export type PriceLine = {
  medicineId: string;
  quantity: number;
  unitPriceMinor: number;
  discountPercent: number;
  available: number;
};
export function calculateOrderEstimate(lines: PriceLine[], deliveryChargeMinor = 0) {
  const items = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0)
      throw new Error('Quantity must be a positive integer');
    const gross = line.unitPriceMinor * line.quantity;
    const discount = Math.round((gross * line.discountPercent) / 100);
    return {
      medicineId: line.medicineId,
      subtotalMinor: gross,
      discountMinor: discount,
      lineTotalMinor: gross - discount,
      available: line.available,
    };
  });
  const subtotalMinor = items.reduce((sum, item) => sum + item.subtotalMinor, 0);
  const discountMinor = items.reduce((sum, item) => sum + item.discountMinor, 0);
  return {
    items,
    subtotalMinor,
    discountMinor,
    deliveryChargeMinor,
    totalMinor: subtotalMinor - discountMinor + deliveryChargeMinor,
  };
}
