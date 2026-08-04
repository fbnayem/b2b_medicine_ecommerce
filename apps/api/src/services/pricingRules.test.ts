import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PriceSource,
  marginBasisPoints,
  priceListInForce,
  resolvePriceFrom,
} from './pricingService';

/**
 * What a customer is charged, and why.
 *
 * This replaces two adjacent lines in `orderService` that read
 * `medicine.defaultSellingPriceMinor` and `shop.defaultDiscount` — one price
 * for everybody, one percentage per customer, no record of either. The
 * precedence is settled in `docs/ASSUMPTIONS.md` and asserted here, because it
 * decides what a customer pays and should not need a database to be proved.
 */

const medicine = { _id: 'med-1', defaultSellingPriceMinor: 1080 };

const list = {
  reference: 'PRL-2026-000001',
  lines: [{ medicineId: 'med-1', unitPriceMinor: 950, discountPercent: 5 }],
};

test('a price list beats the medicine default, and says so', () => {
  const price = resolvePriceFrom(medicine, {}, list);
  assert.equal(price.unitPriceMinor, 950);
  assert.equal(price.discountPercent, 5);
  assert.equal(price.source, PriceSource.PRICE_LIST);
  assert.equal(
    price.priceListReference,
    'PRL-2026-000001',
    'the reference is what answers "why was I charged this" months later',
  );
});

test('a shop’s own arrangement beats the list', () => {
  const price = resolvePriceFrom(medicine, { defaultDiscount: 10 }, list);
  assert.equal(price.source, PriceSource.SHOP_OVERRIDE);
  assert.equal(price.discountPercent, 10);
  assert.equal(
    price.unitPriceMinor,
    1080,
    'against the ordinary price, not the list price: a customer who negotiated ' +
      'ten percent off negotiated it against the ordinary price, and applying ' +
      'it to a cheaper list price hands them more than either party agreed',
  );
});

test('a list that does not name the medicine falls through rather than pricing it at zero', () => {
  const price = resolvePriceFrom({ _id: 'med-2', defaultSellingPriceMinor: 2400 }, {}, list);
  assert.equal(price.unitPriceMinor, 2400);
  assert.equal(price.discountPercent, 0);
  assert.equal(price.source, PriceSource.MEDICINE_DEFAULT);
});

test('no list at all is the medicine default', () => {
  for (const absent of [null, undefined]) {
    const price = resolvePriceFrom(medicine, {}, absent);
    assert.equal(price.unitPriceMinor, 1080);
    assert.equal(price.source, PriceSource.MEDICINE_DEFAULT);
  }
});

test('a zero shop discount is not an arrangement', () => {
  // `defaultDiscount` defaults to 0 on every shop, so treating it as an
  // override would mean the price list never applied to anybody.
  const price = resolvePriceFrom(medicine, { defaultDiscount: 0 }, list);
  assert.equal(price.source, PriceSource.PRICE_LIST);
});

test('a list is in force when it is active and the moment is inside its bounds', () => {
  const march = new Date('2026-03-15T00:00:00.000Z');

  assert.equal(priceListInForce({ isActive: true }, march), true);
  assert.equal(priceListInForce({ isActive: false }, march), false);

  // An absent bound is not a closed one — a list with no end runs until
  // somebody ends it, which is how most price lists in this trade work.
  assert.equal(priceListInForce({ validFrom: new Date('2026-01-01') }, march), true);
  assert.equal(priceListInForce({ validTo: new Date('2026-12-31') }, march), true);

  assert.equal(priceListInForce({ validFrom: new Date('2026-06-01') }, march), false);
  assert.equal(priceListInForce({ validTo: new Date('2026-02-01') }, march), false);
});

test('margin is derived from MRP, in basis points', () => {
  // ৳12.00 printed, ৳10.80 trade: 10% margin, which is 1000 basis points.
  assert.equal(marginBasisPoints(1200, 1080), 1000);
  // ৳12.00 printed, ৳10.50 trade: 12.5%.
  assert.equal(marginBasisPoints(1200, 1050), 1250);
});

test('no MRP means no answer, which is not a margin of zero', () => {
  // The catalogue is not backfilled, and a screen that reported every
  // un-backfilled product as sold at cost would be worse than one that says
  // nothing.
  assert.equal(marginBasisPoints(undefined, 1080), undefined);
  assert.equal(marginBasisPoints(0, 1080), undefined);
});

test('a trade price above MRP is a negative margin, reported rather than clamped', () => {
  // Buying above the printed price happens, and it is exactly the thing
  // somebody needs to see rather than have rounded away to zero.
  assert.equal(marginBasisPoints(1200, 1400), -1667);
});
