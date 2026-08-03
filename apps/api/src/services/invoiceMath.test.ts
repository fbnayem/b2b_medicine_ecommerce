import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePackedInvoice, prorateMinor } from './invoiceMath';

test('packed invoice uses integer minor units and configured tax', () => {
  const invoice = calculatePackedInvoice(
    [
      { quantity: 3, unitPriceMinor: 125, discountMinor: 25 },
      { quantity: 2, unitPriceMinor: 200, discountMinor: 0 },
    ],
    50,
    100,
    750,
  );
  assert.deepEqual(invoice.items, [
    { gross: 375, discount: 25, total: 350 },
    { gross: 400, discount: 0, total: 400 },
  ]);
  assert.equal(invoice.subtotalMinor, 750);
  assert.equal(invoice.orderDiscountMinor, 50);
  assert.equal(invoice.taxMinor, 60);
  assert.equal(invoice.grandTotalMinor, 860);
  assert.ok(Number.isSafeInteger(invoice.grandTotalMinor));
});

test('discounts cannot reduce an invoice below zero', () => {
  const invoice = calculatePackedInvoice(
    [{ quantity: 1, unitPriceMinor: 100, discountMinor: 500 }],
    500,
    0,
  );
  assert.equal(invoice.subtotalMinor, 0);
  assert.equal(invoice.orderDiscountMinor, 0);
  assert.equal(invoice.grandTotalMinor, 0);
});

// Document rendering moved to `pdfDocument.test.ts` when the fixed-offset text
// stamper was replaced. The assertions there are about pagination and character
// coverage; this file is about the money arithmetic and stays that way.

test('financial ratios use exact integer rounding and reject unsafe totals', () => {
  assert.equal(prorateMinor(100, 1, 3), 33);
  assert.equal(prorateMinor(100, 2, 3), 67);
  assert.equal(
    calculatePackedInvoice([{ quantity: 1, unitPriceMinor: 1, discountMinor: 0 }], 0, 0, 5_000)
      .taxMinor,
    1,
  );
  assert.throws(
    () =>
      calculatePackedInvoice(
        [{ quantity: 2, unitPriceMinor: Number.MAX_SAFE_INTEGER, discountMinor: 0 }],
        0,
        0,
      ),
    /safe integer range/,
  );
});
