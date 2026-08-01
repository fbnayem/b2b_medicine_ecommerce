export type PackedPriceLine = { quantity: number; unitPriceMinor: number; discountMinor: number };

function safeNonNegative(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a safe non-negative integer`);
  }
  return value;
}

function safeNumber(value: bigint, name: string) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} exceeds the safe integer range`);
  }
  return Number(value);
}

export function prorateMinor(totalMinor: number, numerator: number, denominator: number) {
  safeNonNegative(totalMinor, 'Prorated amount');
  safeNonNegative(numerator, 'Proration numerator');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('Proration denominator must be a positive safe integer');
  }
  const divisor = BigInt(denominator);
  const value = (BigInt(totalMinor) * BigInt(numerator) + divisor / 2n) / divisor;
  return safeNumber(value, 'Prorated amount');
}

export function calculatePackedInvoice(
  lines: PackedPriceLine[],
  orderDiscountMinor: number,
  deliveryChargeMinor: number,
  taxRateBasisPoints = 0,
) {
  safeNonNegative(orderDiscountMinor, 'Order discount');
  safeNonNegative(deliveryChargeMinor, 'Delivery charge');
  safeNonNegative(taxRateBasisPoints, 'Tax rate');
  const items = lines.map((line) => {
    safeNonNegative(line.quantity, 'Quantity');
    safeNonNegative(line.unitPriceMinor, 'Unit price');
    safeNonNegative(line.discountMinor, 'Line discount');
    const gross = safeNumber(
      BigInt(line.quantity) * BigInt(line.unitPriceMinor),
      'Invoice line gross',
    );
    const discount = Math.min(gross, line.discountMinor);
    return { gross, discount, total: gross - discount };
  });
  const subtotalMinor = safeNumber(
    items.reduce((sum, item) => sum + BigInt(item.total), 0n),
    'Invoice subtotal',
  );
  const appliedOrderDiscount = Math.min(subtotalMinor, orderDiscountMinor);
  const taxable = safeNumber(
    BigInt(subtotalMinor - appliedOrderDiscount) + BigInt(deliveryChargeMinor),
    'Taxable total',
  );
  const taxMinor = safeNumber(
    (BigInt(taxable) * BigInt(taxRateBasisPoints) + 5_000n) / 10_000n,
    'Invoice tax',
  );
  return {
    items,
    subtotalMinor,
    orderDiscountMinor: appliedOrderDiscount,
    deliveryChargeMinor,
    taxMinor,
    grandTotalMinor: safeNumber(BigInt(taxable) + BigInt(taxMinor), 'Invoice grand total'),
  };
}
