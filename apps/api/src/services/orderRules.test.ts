import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderStatus, ShopStatus } from '@medsupply/shared-types';
import { calculateOrderEstimate } from './orderPricing';
import { assertShopMaySubmit, mayEditOrder, mayRequestCancellation } from './orderRules';
test('cart totals use integer minor units and line discounts', () => {
  const value = calculateOrderEstimate(
    [
      { medicineId: 'a', quantity: 3, unitPriceMinor: 1250, discountPercent: 10, available: 9 },
      { medicineId: 'b', quantity: 2, unitPriceMinor: 999, discountPercent: 0, available: 2 },
    ],
    500,
  );
  assert.deepEqual(
    { subtotal: value.subtotalMinor, discount: value.discountMinor, total: value.totalMinor },
    { subtotal: 5748, discount: 375, total: 5873 },
  );
});
test('price calculation is a snapshot independent of later source changes', () => {
  const source = {
    medicineId: 'a',
    quantity: 2,
    unitPriceMinor: 1000,
    discountPercent: 0,
    available: 5,
  };
  const snapshot = calculateOrderEstimate([source]);
  source.unitPriceMinor = 1500;
  assert.equal(snapshot.items[0]?.lineTotalMinor, 2000);
});
test('only active shops may submit', () => {
  assert.doesNotThrow(() => assertShopMaySubmit(ShopStatus.ACTIVE));
  for (const status of [
    ShopStatus.SUSPENDED,
    ShopStatus.INACTIVE,
    ShopStatus.CREDIT_BLOCKED,
    ShopStatus.LICENCE_EXPIRED,
  ])
    assert.throws(() => assertShopMaySubmit(status));
});
test('drafts are editable but submitted orders are immutable', () => {
  assert.equal(mayEditOrder(OrderStatus.DRAFT), true);
  assert.equal(mayEditOrder(OrderStatus.SUBMITTED), false);
});
test('cancellation requests are limited to eligible early states', () => {
  assert.equal(mayRequestCancellation(OrderStatus.SUBMITTED), true);
  assert.equal(mayRequestCancellation(OrderStatus.ON_HOLD), true);
  assert.equal(mayRequestCancellation(OrderStatus.APPROVED), false);
});
