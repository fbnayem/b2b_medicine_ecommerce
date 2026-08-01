import { FinancePaymentMethod } from './types';
import { parseMoneyToMinor } from './money';

export const deliveryCollectionMethods = [
  FinancePaymentMethod.CASH,
  FinancePaymentMethod.BANK_TRANSFER,
  FinancePaymentMethod.MOBILE_FINANCIAL_SERVICE,
  FinancePaymentMethod.CHEQUE,
  FinancePaymentMethod.OTHER,
] as const;

export type DeliveryCollectionMethod = (typeof deliveryCollectionMethods)[number];

export type PaymentProofInput = {
  fileName: string;
  mimeType: 'image/jpeg';
  base64Data: string;
};

export type CollectionDraft = {
  noPaymentCollected: boolean;
  amount: string;
  method: DeliveryCollectionMethod;
  transactionReference: string;
  paymentProof?: PaymentProofInput;
};

export type CollectionValidation =
  | {
      ok: true;
      payload: {
        noPaymentCollected: boolean;
        collectedAmountMinor: number;
        collectionMethod?: DeliveryCollectionMethod;
        transactionReference?: string;
        paymentProof?: PaymentProofInput;
      };
    }
  | { ok: false; error: string };

const methodsRequiringReference = new Set<DeliveryCollectionMethod>([
  FinancePaymentMethod.BANK_TRANSFER,
  FinancePaymentMethod.MOBILE_FINANCIAL_SERVICE,
  FinancePaymentMethod.CHEQUE,
]);

export function validateDeliveryCollection(
  draft: CollectionDraft,
  invoiceAmountDueMinor?: number,
): CollectionValidation {
  if (draft.noPaymentCollected) {
    return { ok: true, payload: { noPaymentCollected: true, collectedAmountMinor: 0 } };
  }

  const amountMinor = parseMoneyToMinor(draft.amount);
  if (amountMinor === null || amountMinor <= 0) {
    return { ok: false, error: 'Enter a collected amount greater than zero.' };
  }
  if (
    invoiceAmountDueMinor !== undefined &&
    Number.isSafeInteger(invoiceAmountDueMinor) &&
    amountMinor > invoiceAmountDueMinor
  ) {
    return { ok: false, error: 'Collected amount cannot exceed the invoice amount due.' };
  }

  const reference = draft.transactionReference.trim();
  if (methodsRequiringReference.has(draft.method) && reference.length < 3) {
    return { ok: false, error: 'Enter the bank, mobile service, or cheque reference.' };
  }
  if (methodsRequiringReference.has(draft.method) && !draft.paymentProof) {
    return { ok: false, error: 'Capture payment proof for this payment method.' };
  }

  return {
    ok: true,
    payload: {
      noPaymentCollected: false,
      collectedAmountMinor: amountMinor,
      collectionMethod: draft.method,
      transactionReference: reference || undefined,
      paymentProof: draft.paymentProof,
    },
  };
}
