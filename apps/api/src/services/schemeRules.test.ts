import test from 'node:test';
import assert from 'node:assert/strict';
import { freeUnitsFor, schemeAppliesToShop, schemeInForce } from './schemeService';
import { prorateMinor } from './invoiceMath';
import { lineRefundMinor } from './returnRules';

/**
 * Free goods.
 *
 * The property everything rests on: `quantity` is the chargeable quantity and
 * `freeQuantity` rides alongside it. Eleven units leave the warehouse, ten are
 * charged, and the invoice arithmetic never learns that anything changed.
 */

const tenPlusOne = { reference: 'SCH-2026-000001', buyQuantity: 10, freeQuantity: 1 };

test('a whole multiple earns the free units', () => {
  assert.equal(freeUnitsFor(10, tenPlusOne), 1);
  assert.equal(freeUnitsFor(20, tenPlusOne), 2);
  assert.equal(freeUnitsFor(95, tenPlusOne), 9);
});

test('a short line earns nothing, because that is what the offer says', () => {
  // Rounding up here would be a discount nobody agreed to, applied silently,
  // on every line that fell short.
  assert.equal(freeUnitsFor(9, tenPlusOne), 0);
  assert.equal(freeUnitsFor(1, tenPlusOne), 0);
  assert.equal(freeUnitsFor(0, tenPlusOne), 0);
});

test('no scheme is no free units, not an error', () => {
  assert.equal(freeUnitsFor(100, null), 0);
  assert.equal(freeUnitsFor(100, undefined), 0);
  // A malformed scheme must not divide by zero and hand out infinity.
  assert.equal(freeUnitsFor(100, { reference: 'x', buyQuantity: 0, freeQuantity: 5 }), 0);
});

test('a scheme is in force when it is active and inside its dates', () => {
  const march = new Date('2026-03-15T00:00:00.000Z');
  assert.equal(schemeInForce({ isActive: true }, march), true);
  assert.equal(schemeInForce({ isActive: false }, march), false);
  assert.equal(schemeInForce({ validFrom: new Date('2026-04-01') }, march), false);
  assert.equal(schemeInForce({ validTo: new Date('2026-02-01') }, march), false);
  // An absent bound is not a closed one.
  assert.equal(schemeInForce({ validFrom: new Date('2026-01-01') }, march), true);
});

test('no named shops means every shop', () => {
  // The ordinary case: a supplier's 10+1 runs for everybody.
  assert.equal(schemeAppliesToShop({}, 'shop-1'), true);
  assert.equal(schemeAppliesToShop({ shopIds: [] }, 'shop-1'), true);
  assert.equal(schemeAppliesToShop({ shopIds: ['shop-1'] }, 'shop-1'), true);
  assert.equal(schemeAppliesToShop({ shopIds: ['shop-2'] }, 'shop-1'), false);
});

test('crediting a scheme line prorates over what was dispatched', () => {
  /*
   * Eleven went out, ten were charged at ৳10.80. Returning six credits six
   * **elevenths** of ৳108.00, not six tenths — crediting per charged unit
   * refunds more than the customer handed over, a tenth too much every time,
   * and it comes out of margin rather than out of anything anybody decided.
   */
  const scheme = {
    invoicedQuantity: 10,
    dispatchedQuantity: 11,
    unitPriceMinor: 1080,
    lineDiscountMinor: 0,
    quantity: 6,
  };
  assert.equal(lineRefundMinor(scheme).refundMinor, 5891);

  // Everything back is everything credited, with nothing lost to rounding.
  assert.equal(lineRefundMinor({ ...scheme, quantity: 11 }).refundMinor, 10_800);

  // More than went out is refused rather than credited.
  assert.throws(() => lineRefundMinor({ ...scheme, quantity: 12 }));
});

test('a line with no scheme credits exactly as it always did', () => {
  // The path that every invoice already issued takes. Ten charged, ten sent:
  // six back is six units' worth, unchanged by any of this.
  const ordinary = {
    invoicedQuantity: 10,
    unitPriceMinor: 1080,
    lineDiscountMinor: 0,
    quantity: 6,
  };
  assert.equal(lineRefundMinor(ordinary).refundMinor, 6480);
  assert.equal(lineRefundMinor({ ...ordinary, dispatchedQuantity: 10 }).refundMinor, 6480);
});

test('a return of six from eleven credits the chargeable proportion', () => {
  /*
   * The plan's rule, and the reason it reuses `prorateMinor` rather than
   * inventing a second proration: ten units were charged and eleven were sent,
   * so returning six credits six elevenths of what was paid — not six tenths,
   * which would refund more than the customer handed over.
   */
  const lineTotalMinor = 10_800; // ten units at ৳10.80.
  assert.equal(prorateMinor(lineTotalMinor, 6, 11), 5891);

  // The whole line back is the whole line credited, with nothing lost to
  // rounding along the way.
  assert.equal(prorateMinor(lineTotalMinor, 11, 11), 10_800);
  assert.equal(prorateMinor(lineTotalMinor, 0, 11), 0);
});
