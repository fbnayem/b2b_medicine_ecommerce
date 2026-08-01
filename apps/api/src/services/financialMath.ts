import { LedgerAccount, PaymentMethod } from '@medsupply/shared-types';

export type FinancialEntry = {
  account: LedgerAccount;
  debitMinor: number;
  creditMinor: number;
};

export type PaymentAllocation = {
  invoiceAppliedMinor: number;
  advanceCreatedMinor: number;
  advanceConsumedMinor: number;
  customerBalanceDeltaMinor: number;
};

export function assertSafeMoney(value: number, name: string, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw Object.assign(new Error(`${name} must be a safe integer amount in minor units`), {
      statusCode: 400,
      code: 'INVALID_MONEY',
    });
  }
  return value;
}

export function safeAdd(...values: number[]) {
  const total = values.reduce((sum, value) => {
    assertSafeMoney(Math.abs(value), 'Ledger amount');
    const next = sum + value;
    if (!Number.isSafeInteger(next)) {
      throw Object.assign(new Error('Financial total exceeds the safe integer range'), {
        statusCode: 400,
        code: 'MONEY_OVERFLOW',
      });
    }
    return next;
  }, 0);
  return total;
}

export function assertBalancedEntries(entries: FinancialEntry[]) {
  if (entries.length < 2) {
    throw Object.assign(new Error('A ledger transaction requires at least two entries'), {
      statusCode: 400,
      code: 'UNBALANCED_LEDGER',
    });
  }
  let debit = 0;
  let credit = 0;
  for (const entry of entries) {
    assertSafeMoney(entry.debitMinor, 'Debit');
    assertSafeMoney(entry.creditMinor, 'Credit');
    if (
      (entry.debitMinor === 0 && entry.creditMinor === 0) ||
      (entry.debitMinor > 0 && entry.creditMinor > 0)
    ) {
      throw Object.assign(new Error('Each ledger line must contain one debit or one credit'), {
        statusCode: 400,
        code: 'UNBALANCED_LEDGER',
      });
    }
    debit = safeAdd(debit, entry.debitMinor);
    credit = safeAdd(credit, entry.creditMinor);
  }
  if (debit !== credit) {
    throw Object.assign(new Error('Ledger debits and credits must balance'), {
      statusCode: 400,
      code: 'UNBALANCED_LEDGER',
    });
  }
  return debit;
}

export function allocatePayment(input: {
  amountMinor: number;
  method: PaymentMethod;
  invoiceDueMinor?: number;
  availableAdvanceMinor: number;
  allowAdvance: boolean;
}): PaymentAllocation {
  const amount = assertSafeMoney(input.amountMinor, 'Payment amount', false);
  const availableAdvance = assertSafeMoney(input.availableAdvanceMinor, 'Available advance');
  const invoiceDue =
    input.invoiceDueMinor === undefined
      ? undefined
      : assertSafeMoney(input.invoiceDueMinor, 'Invoice due');

  if (input.method === PaymentMethod.CREDIT) {
    throw Object.assign(new Error('CREDIT is an order term, not a received payment'), {
      statusCode: 400,
      code: 'INVALID_PAYMENT_METHOD',
    });
  }
  if (input.method === PaymentMethod.ADVANCE_BALANCE) {
    if (invoiceDue === undefined) {
      throw Object.assign(new Error('Advance balance must be applied to an invoice'), {
        statusCode: 400,
        code: 'INVOICE_REQUIRED',
      });
    }
    if (amount > invoiceDue) {
      throw Object.assign(new Error('Advance application exceeds the invoice due'), {
        statusCode: 409,
        code: 'OVERPAYMENT',
      });
    }
    if (amount > availableAdvance) {
      throw Object.assign(new Error('Available advance balance is insufficient'), {
        statusCode: 409,
        code: 'INSUFFICIENT_ADVANCE',
      });
    }
    return {
      invoiceAppliedMinor: amount,
      advanceCreatedMinor: 0,
      advanceConsumedMinor: amount,
      customerBalanceDeltaMinor: 0,
    };
  }

  const applied = invoiceDue === undefined ? 0 : Math.min(invoiceDue, amount);
  const excess = amount - applied;
  if (excess > 0 && !input.allowAdvance) {
    throw Object.assign(
      new Error(
        invoiceDue === undefined
          ? 'A payment without an invoice must be explicitly recorded as advance balance'
          : 'Payment exceeds the invoice due; explicitly allow advance balance',
      ),
      { statusCode: 409, code: 'OVERPAYMENT' },
    );
  }
  return {
    invoiceAppliedMinor: applied,
    advanceCreatedMinor: excess,
    advanceConsumedMinor: 0,
    customerBalanceDeltaMinor: -amount,
  };
}

export function reverseEntries(entries: FinancialEntry[]) {
  assertBalancedEntries(entries);
  return entries.map((entry) => ({
    account: entry.account,
    debitMinor: entry.creditMinor,
    creditMinor: entry.debitMinor,
  }));
}

export function utilisationBasisPoints(outstandingMinor: number, creditLimitMinor: number) {
  assertSafeMoney(outstandingMinor, 'Outstanding balance');
  assertSafeMoney(creditLimitMinor, 'Credit limit');
  if (creditLimitMinor === 0) return outstandingMinor === 0 ? 0 : 10_001;
  const result = (BigInt(outstandingMinor) * 10_000n) / BigInt(creditLimitMinor);
  const numeric = Number(result);
  return Number.isSafeInteger(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}
