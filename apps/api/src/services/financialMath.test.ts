import assert from 'node:assert/strict';
import test from 'node:test';
import { LedgerAccount, PaymentMethod } from '@medsupply/shared-types';
import {
  allocatePayment,
  assertBalancedEntries,
  reverseEntries,
  safeAdd,
  utilisationBasisPoints,
} from './financialMath';

test('allocates full, partial and multiple invoice payments using integer minor units', () => {
  const partial = allocatePayment({
    amountMinor: 3_333,
    method: PaymentMethod.CASH,
    invoiceDueMinor: 10_000,
    availableAdvanceMinor: 0,
    allowAdvance: false,
  });
  assert.deepEqual(partial, {
    invoiceAppliedMinor: 3_333,
    advanceCreatedMinor: 0,
    advanceConsumedMinor: 0,
    customerBalanceDeltaMinor: -3_333,
  });
  const final = allocatePayment({
    amountMinor: 6_667,
    method: PaymentMethod.BANK_TRANSFER,
    invoiceDueMinor: 6_667,
    availableAdvanceMinor: 0,
    allowAdvance: false,
  });
  assert.equal(partial.invoiceAppliedMinor + final.invoiceAppliedMinor, 10_000);
});

test('blocks overpayment unless advance creation is explicit', () => {
  assert.throws(
    () =>
      allocatePayment({
        amountMinor: 10_001,
        method: PaymentMethod.CASH,
        invoiceDueMinor: 10_000,
        availableAdvanceMinor: 0,
        allowAdvance: false,
      }),
    (error: unknown) => (error as { code?: string }).code === 'OVERPAYMENT',
  );
  assert.deepEqual(
    allocatePayment({
      amountMinor: 10_001,
      method: PaymentMethod.CASH,
      invoiceDueMinor: 10_000,
      availableAdvanceMinor: 0,
      allowAdvance: true,
    }),
    {
      invoiceAppliedMinor: 10_000,
      advanceCreatedMinor: 1,
      advanceConsumedMinor: 0,
      customerBalanceDeltaMinor: -10_001,
    },
  );
});

test('applies existing advance without changing the customer ledger balance', () => {
  assert.deepEqual(
    allocatePayment({
      amountMinor: 1_500,
      method: PaymentMethod.ADVANCE_BALANCE,
      invoiceDueMinor: 2_000,
      availableAdvanceMinor: 1_500,
      allowAdvance: false,
    }),
    {
      invoiceAppliedMinor: 1_500,
      advanceCreatedMinor: 0,
      advanceConsumedMinor: 1_500,
      customerBalanceDeltaMinor: 0,
    },
  );
});

test('requires balanced double-entry journals and reverses them exactly', () => {
  const entries = [
    { account: LedgerAccount.CASH_UNDEPOSITED, debitMinor: 500, creditMinor: 0 },
    { account: LedgerAccount.ACCOUNTS_RECEIVABLE, debitMinor: 0, creditMinor: 500 },
  ];
  assert.equal(assertBalancedEntries(entries), 500);
  const reversed = reverseEntries(entries);
  assert.equal(assertBalancedEntries(reversed), 500);
  assert.equal(reversed[0]?.creditMinor, 500);
});

test('money arithmetic rejects unsafe precision and computes credit ratios with BigInt', () => {
  assert.equal(safeAdd(10, -3, 2), 9);
  assert.throws(() => safeAdd(Number.MAX_SAFE_INTEGER, 1), /safe integer range/);
  assert.equal(utilisationBasisPoints(7_500, 10_000), 7_500);
  assert.equal(utilisationBasisPoints(1, 0), 10_001);
});
