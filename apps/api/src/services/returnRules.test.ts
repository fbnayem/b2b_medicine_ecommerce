import assert from 'node:assert/strict';
import test from 'node:test';
import { ReturnStatus, UserRole } from '@medsupply/shared-types';
import {
  assertCreditWithinInvoice,
  assertDispositionValid,
  assertReturnTransition,
  computeReturnCredit,
  decisionStatus,
  dispositionMovements,
  lineRefundMinor,
  refundTaxMinor,
  remainingReturnableQuantity,
  RETURN_TRANSITIONS,
  transitionFor,
} from './returnRules';

test('every return transition declares roles, side effects and an audit event', () => {
  assert.ok(RETURN_TRANSITIONS.length >= 8);
  for (const transition of RETURN_TRANSITIONS) {
    assert.ok(transition.roles.length, `${transition.action} has no roles`);
    assert.ok(transition.sideEffects.length, `${transition.action} has no side effects`);
    assert.ok(transition.auditEvent.length, `${transition.action} has no audit event`);
  }
});

test('only a storekeeper or management may receive returned goods', () => {
  const receive = transitionFor('RECEIVE');
  assert.ok(receive.roles.includes(UserRole.STOREKEEPER));
  assert.ok(!receive.roles.includes(UserRole.SHOP_OWNER));
  assert.throws(
    () => assertReturnTransition('RECEIVE', ReturnStatus.APPROVED, UserRole.SHOP_OWNER),
    (error: { code?: string; statusCode?: number }) =>
      error.code === 'FORBIDDEN' && error.statusCode === 403,
  );
});

test('a shop owner may not issue the credit note for their own return', () => {
  assert.throws(
    () => assertReturnTransition('ISSUE_CREDIT_NOTE', ReturnStatus.RECEIVED, UserRole.SHOP_OWNER),
    (error: { code?: string }) => error.code === 'FORBIDDEN',
  );
});

test('a return cannot skip receipt on the way to a credit note', () => {
  assert.throws(
    () => assertReturnTransition('ISSUE_CREDIT_NOTE', ReturnStatus.APPROVED, UserRole.MANAGER),
    (error: { code?: string }) => error.code === 'INVALID_RETURN_STATE',
  );
  assert.doesNotThrow(() =>
    assertReturnTransition('ISSUE_CREDIT_NOTE', ReturnStatus.RECEIVED, UserRole.MANAGER),
  );
});

test('a decision approving nothing is recorded as a rejection', () => {
  assert.equal(
    decisionStatus([{ requestedQuantity: 5, approvedQuantity: 0 }]),
    ReturnStatus.REJECTED,
  );
  assert.equal(
    decisionStatus([
      { requestedQuantity: 5, approvedQuantity: 5 },
      { requestedQuantity: 2, approvedQuantity: 2 },
    ]),
    ReturnStatus.APPROVED,
  );
  assert.equal(
    decisionStatus([
      { requestedQuantity: 5, approvedQuantity: 5 },
      { requestedQuantity: 2, approvedQuantity: 1 },
    ]),
    ReturnStatus.PARTIALLY_APPROVED,
  );
});

test('open returns hold their claim on an invoice line but closed ones release it', () => {
  assert.equal(
    remainingReturnableQuantity({
      invoicedQuantity: 10,
      openQuantities: [
        { status: ReturnStatus.REQUESTED, requestedQuantity: 4, approvedQuantity: 0 },
        { status: ReturnStatus.REJECTED, requestedQuantity: 3, approvedQuantity: 0 },
        { status: ReturnStatus.CANCELLED, requestedQuantity: 2, approvedQuantity: 0 },
      ],
    }),
    6,
  );
  // Once reviewed, the approved quantity replaces the request as the claim.
  assert.equal(
    remainingReturnableQuantity({
      invoicedQuantity: 10,
      openQuantities: [
        { status: ReturnStatus.PARTIALLY_APPROVED, requestedQuantity: 8, approvedQuantity: 3 },
      ],
    }),
    7,
  );
  assert.equal(
    remainingReturnableQuantity({
      invoicedQuantity: 10,
      openQuantities: [
        { status: ReturnStatus.COMPLETED, requestedQuantity: 10, approvedQuantity: 10 },
      ],
    }),
    0,
  );
});

test('an expired batch can be received but never restocked', () => {
  assert.throws(
    () =>
      assertDispositionValid({
        approvedQuantity: 5,
        batchExpired: true,
        disposition: {
          restockQuantity: 1,
          damagedQuantity: 0,
          expiredQuantity: 4,
          quarantinedQuantity: 0,
        },
      }),
    (error: { code?: string }) => error.code === 'EXPIRED_BATCH_RESTOCK',
  );
  assert.equal(
    assertDispositionValid({
      approvedQuantity: 5,
      batchExpired: true,
      disposition: {
        restockQuantity: 0,
        damagedQuantity: 0,
        expiredQuantity: 5,
        quarantinedQuantity: 0,
      },
    }),
    5,
  );
});

test('inspection cannot record more units than were approved', () => {
  assert.throws(
    () =>
      assertDispositionValid({
        approvedQuantity: 3,
        batchExpired: false,
        disposition: {
          restockQuantity: 2,
          damagedQuantity: 2,
          expiredQuantity: 0,
          quarantinedQuantity: 0,
        },
      }),
    (error: { code?: string }) => error.code === 'RECEIPT_EXCEEDS_APPROVAL',
  );
});

test('only non-zero dispositions produce stock movements', () => {
  const movements = dispositionMovements({
    restockQuantity: 4,
    damagedQuantity: 0,
    expiredQuantity: 1,
    quarantinedQuantity: 0,
  });
  assert.deepEqual(
    movements.map((movement) => movement.disposition),
    ['RESTOCK', 'EXPIRED'],
  );
});

test('a partial line refund prorates the line discount in integer minor units', () => {
  // 10 units at 12.50 with a 30.00 line discount; returning 3 credits 3/10.
  const result = lineRefundMinor({
    invoicedQuantity: 10,
    unitPriceMinor: 1250,
    lineDiscountMinor: 3000,
    quantity: 3,
  });
  assert.equal(result.discountMinor, 900);
  assert.equal(result.refundMinor, 3750 - 900);
  assert.ok(Number.isSafeInteger(result.refundMinor));
});

test('a full-line return credits exactly the invoiced line total', () => {
  const result = lineRefundMinor({
    invoicedQuantity: 7,
    unitPriceMinor: 333,
    lineDiscountMinor: 111,
    quantity: 7,
  });
  assert.equal(result.discountMinor, 111);
  assert.equal(result.refundMinor, 7 * 333 - 111);
});

test('a refund can never exceed the invoiced quantity', () => {
  assert.throws(
    () =>
      lineRefundMinor({
        invoicedQuantity: 2,
        unitPriceMinor: 100,
        lineDiscountMinor: 0,
        quantity: 3,
      }),
    (error: { code?: string }) => error.code === 'RETURN_EXCEEDS_INVOICE',
  );
});

test('tax is credited in proportion to the refunded subtotal', () => {
  assert.equal(
    refundTaxMinor({
      refundSubtotalMinor: 5000,
      invoiceTaxMinor: 750,
      invoiceTaxableBaseMinor: 10_000,
    }),
    375,
  );
  // A zero-tax invoice credits no tax rather than dividing by its base.
  assert.equal(
    refundTaxMinor({
      refundSubtotalMinor: 5000,
      invoiceTaxMinor: 0,
      invoiceTaxableBaseMinor: 10_000,
    }),
    0,
  );
  assert.equal(
    refundTaxMinor({ refundSubtotalMinor: 5000, invoiceTaxMinor: 750, invoiceTaxableBaseMinor: 0 }),
    0,
  );
});

test('returning an entire invoice credits everything except the delivery charge', () => {
  // Two lines totalling 10,000 poisha after line discounts, a 1,000 order
  // discount, 200 delivery charge and 7.5% tax on 9,200.
  const credit = computeReturnCredit({
    lines: [
      { invoicedQuantity: 10, unitPriceMinor: 600, lineDiscountMinor: 0, quantity: 10 },
      { invoicedQuantity: 8, unitPriceMinor: 500, lineDiscountMinor: 0, quantity: 8 },
    ],
    invoiceSubtotalMinor: 10_000,
    invoiceOrderDiscountMinor: 1000,
    invoiceDeliveryChargeMinor: 200,
    invoiceTaxMinor: 690,
  });
  assert.equal(credit.grossRefundMinor, 10_000);
  assert.equal(credit.orderDiscountShareMinor, 1000);
  assert.equal(credit.subtotalMinor, 9000);
  // 690 * 9000 / 9200, rounded half up.
  assert.equal(credit.taxMinor, 675);
  assert.equal(credit.totalMinor, 9675);
});

test('a partial return shares the order discount rather than crediting gross', () => {
  const credit = computeReturnCredit({
    lines: [{ invoicedQuantity: 10, unitPriceMinor: 600, lineDiscountMinor: 0, quantity: 5 }],
    invoiceSubtotalMinor: 10_000,
    invoiceOrderDiscountMinor: 1000,
    invoiceDeliveryChargeMinor: 200,
    invoiceTaxMinor: 690,
  });
  assert.equal(credit.grossRefundMinor, 3000);
  assert.equal(credit.orderDiscountShareMinor, 300);
  assert.equal(credit.subtotalMinor, 2700);
  assert.ok(credit.totalMinor < credit.grossRefundMinor);
  assert.ok(Number.isSafeInteger(credit.totalMinor));
});

test('a tax-free invoice with no discounts credits exactly the line value', () => {
  const credit = computeReturnCredit({
    lines: [{ invoicedQuantity: 4, unitPriceMinor: 1999, lineDiscountMinor: 0, quantity: 2 }],
    invoiceSubtotalMinor: 7996,
    invoiceOrderDiscountMinor: 0,
    invoiceDeliveryChargeMinor: 0,
    invoiceTaxMinor: 0,
  });
  assert.equal(credit.totalMinor, 3998);
});

test('credit notes cannot cumulatively exceed the invoice they credit', () => {
  assert.equal(
    assertCreditWithinInvoice({
      invoiceGrandTotalMinor: 10_000,
      alreadyCreditedMinor: 4000,
      proposedCreditMinor: 6000,
    }),
    10_000,
  );
  assert.throws(
    () =>
      assertCreditWithinInvoice({
        invoiceGrandTotalMinor: 10_000,
        alreadyCreditedMinor: 4000,
        proposedCreditMinor: 6001,
      }),
    (error: { code?: string }) => error.code === 'CREDIT_EXCEEDS_INVOICE',
  );
});
