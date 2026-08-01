import { describe, expect, it } from 'vitest';
import { validateDeliveryCollection } from './collection';
import { FinancePaymentMethod } from './types';

const proof = {
  fileName: 'proof.jpg',
  mimeType: 'image/jpeg' as const,
  base64Data: 'base64-payment-proof',
};

describe('delivery collection payload safety', () => {
  it('makes no-payment collection explicit', () => {
    expect(
      validateDeliveryCollection({
        noPaymentCollected: true,
        amount: '999',
        method: FinancePaymentMethod.CASH,
        transactionReference: '',
        paymentProof: proof,
      }),
    ).toEqual({
      ok: true,
      payload: { noPaymentCollected: true, collectedAmountMinor: 0 },
    });
  });

  it('creates an exact minor-unit cash collection', () => {
    const result = validateDeliveryCollection(
      {
        noPaymentCollected: false,
        amount: '100.05',
        method: FinancePaymentMethod.CASH,
        transactionReference: '',
      },
      20_000,
    );
    expect(result).toEqual({
      ok: true,
      payload: {
        noPaymentCollected: false,
        collectedAmountMinor: 10_005,
        collectionMethod: FinancePaymentMethod.CASH,
        transactionReference: undefined,
        paymentProof: undefined,
      },
    });
  });

  it('requires transfer evidence and prevents an unsupported advance', () => {
    const missingProof = validateDeliveryCollection({
      noPaymentCollected: false,
      amount: '50',
      method: FinancePaymentMethod.BANK_TRANSFER,
      transactionReference: 'BANK-1',
    });
    expect(missingProof.ok).toBe(false);

    const aboveDue = validateDeliveryCollection(
      {
        noPaymentCollected: false,
        amount: '100.01',
        method: FinancePaymentMethod.CASH,
        transactionReference: '',
      },
      10_000,
    );
    expect(aboveDue).toEqual({
      ok: false,
      error: 'Collected amount cannot exceed the invoice amount due.',
    });
  });
});
