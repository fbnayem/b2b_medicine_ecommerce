import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePackedInvoice, prorateMinor } from './invoiceMath';
import { createSimplePdf } from './pdfService';

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

test('A4 and thermal PDF generation is deterministic and produces valid page sizes', () => {
  const lines = ['MedSupply B2B', 'Invoice INV-2026-000001', 'Authorised signature'];
  const a4 = createSimplePdf(lines, 'A4');
  const repeated = createSimplePdf(lines, 'A4');
  const thermal = createSimplePdf(lines, 'THERMAL');
  assert.equal(a4.subarray(0, 8).toString(), '%PDF-1.4');
  assert.match(a4.toString(), /MediaBox \[0 0 595 842\]/);
  assert.match(thermal.toString(), /MediaBox \[0 0 226 842\]/);
  assert.match(a4.toString(), /%%EOF$/);
  assert.deepEqual(a4, repeated);
});

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
