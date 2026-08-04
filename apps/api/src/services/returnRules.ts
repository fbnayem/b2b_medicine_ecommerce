import {
  CLOSED_RETURN_STATUSES,
  ReturnDisposition,
  ReturnStatus,
  UserRole,
} from '@medsupply/shared-types';
import { prorateMinor } from './invoiceMath';

export type ReturnAction =
  | 'REQUEST'
  | 'START_REVIEW'
  | 'APPROVE'
  | 'REJECT'
  | 'CANCEL'
  | 'COLLECT'
  | 'RECEIVE'
  | 'ISSUE_CREDIT_NOTE';

export interface ReturnTransition {
  action: ReturnAction;
  from: ReturnStatus[];
  to: ReturnStatus | 'DERIVED';
  roles: UserRole[];
  requiredData: string[];
  sideEffects: string[];
  auditEvent: string;
}

const MANAGEMENT: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];

/**
 * The whole customer-return policy in one table, mirroring the delivery policy.
 * `DERIVED` means the target depends on the decision itself — a review that
 * approves every requested unit lands on APPROVED, anything less on
 * PARTIALLY_APPROVED, and approving nothing is a rejection.
 */
export const RETURN_TRANSITIONS: ReturnTransition[] = [
  {
    action: 'REQUEST',
    from: [],
    to: ReturnStatus.REQUESTED,
    roles: [...MANAGEMENT, UserRole.SHOP_OWNER],
    requiredData: ['invoice', 'lines', 'reason'],
    sideEffects: ['order moves to RETURN_REQUESTED', 'managers notified'],
    auditEvent: 'RETURN_REQUESTED',
  },
  {
    action: 'START_REVIEW',
    from: [ReturnStatus.REQUESTED],
    to: ReturnStatus.UNDER_REVIEW,
    roles: MANAGEMENT,
    requiredData: [],
    sideEffects: ['claims the request for one reviewer'],
    auditEvent: 'RETURN_REVIEW_STARTED',
  },
  {
    action: 'APPROVE',
    from: [ReturnStatus.REQUESTED, ReturnStatus.UNDER_REVIEW],
    to: 'DERIVED',
    roles: MANAGEMENT,
    requiredData: ['approved quantities'],
    sideEffects: ['refund value calculated', 'shop notified'],
    auditEvent: 'RETURN_APPROVED',
  },
  {
    action: 'REJECT',
    from: [ReturnStatus.REQUESTED, ReturnStatus.UNDER_REVIEW],
    to: ReturnStatus.REJECTED,
    roles: MANAGEMENT,
    requiredData: ['rejection reason'],
    sideEffects: ['order returns to its delivered status', 'shop notified'],
    auditEvent: 'RETURN_REJECTED',
  },
  {
    action: 'CANCEL',
    from: [
      ReturnStatus.REQUESTED,
      ReturnStatus.UNDER_REVIEW,
      ReturnStatus.APPROVED,
      ReturnStatus.PARTIALLY_APPROVED,
    ],
    to: ReturnStatus.CANCELLED,
    roles: [...MANAGEMENT, UserRole.SHOP_OWNER],
    requiredData: ['reason'],
    sideEffects: ['order returns to its delivered status'],
    auditEvent: 'RETURN_CANCELLED',
  },
  {
    action: 'COLLECT',
    from: [ReturnStatus.APPROVED, ReturnStatus.PARTIALLY_APPROVED],
    to: ReturnStatus.COLLECTED,
    roles: [...MANAGEMENT, UserRole.DELIVERY_PERSON],
    requiredData: [],
    sideEffects: ['goods are in transit back to the warehouse'],
    auditEvent: 'RETURN_COLLECTED',
  },
  {
    action: 'RECEIVE',
    from: [ReturnStatus.APPROVED, ReturnStatus.PARTIALLY_APPROVED, ReturnStatus.COLLECTED],
    to: ReturnStatus.RECEIVED,
    roles: [...MANAGEMENT, UserRole.STOREKEEPER],
    requiredData: ['inspected quantities per disposition'],
    sideEffects: ['stock booked in and dispositioned', 'refund value recalculated'],
    auditEvent: 'RETURN_RECEIVED',
  },
  {
    action: 'ISSUE_CREDIT_NOTE',
    from: [ReturnStatus.RECEIVED],
    to: ReturnStatus.COMPLETED,
    roles: MANAGEMENT,
    requiredData: [],
    sideEffects: ['credit note issued', 'ledger credited', 'order moves to RETURNED'],
    auditEvent: 'CREDIT_NOTE_ISSUED',
  },
];

const byAction = new Map<ReturnAction, ReturnTransition>(
  RETURN_TRANSITIONS.map((transition) => [transition.action, transition]),
);

export function transitionFor(action: ReturnAction): ReturnTransition {
  const found = byAction.get(action);
  if (!found) throw new Error(`No return transition registered for ${action}`);
  return found;
}

function ruleError(message: string, code: string, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

/** Role gate on its own, so callers can refuse before revealing any state. */
export function assertReturnRole(action: ReturnAction, role: UserRole) {
  const transition = transitionFor(action);
  if (!transition.roles.includes(role)) {
    throw ruleError(`A ${role} may not perform this return action`, 'FORBIDDEN', 403);
  }
  return transition;
}

export function assertReturnTransition(
  action: ReturnAction,
  currentStatus: ReturnStatus,
  role: UserRole,
) {
  const transition = assertReturnRole(action, role);
  if (!transition.from.includes(currentStatus)) {
    throw ruleError(
      `A return in ${currentStatus} cannot be ${action.toLowerCase().replaceAll('_', ' ')}`,
      'INVALID_RETURN_STATE',
    );
  }
  return transition;
}

/**
 * Approving fewer units than requested is a partial approval; approving none is
 * a rejection, which we surface rather than leaving a zero-value return alive.
 */
export function decisionStatus(
  lines: Array<{ requestedQuantity: number; approvedQuantity: number }>,
): ReturnStatus {
  const approved = lines.reduce((sum, line) => sum + line.approvedQuantity, 0);
  if (approved === 0) return ReturnStatus.REJECTED;
  const requested = lines.reduce((sum, line) => sum + line.requestedQuantity, 0);
  return approved === requested ? ReturnStatus.APPROVED : ReturnStatus.PARTIALLY_APPROVED;
}

/**
 * How many units of an invoice line may still be returned. Returns already
 * rejected or cancelled release their claim; everything else holds it, so two
 * open requests can never together exceed what was invoiced.
 */
export function remainingReturnableQuantity(input: {
  invoicedQuantity: number;
  openQuantities: Array<{
    status: ReturnStatus;
    requestedQuantity: number;
    approvedQuantity: number;
  }>;
}) {
  const claimed = input.openQuantities.reduce((sum, entry) => {
    if (CLOSED_RETURN_STATUSES.includes(entry.status)) return sum;
    // Before review the request is the claim; after review the decision is.
    const claim =
      entry.status === ReturnStatus.REQUESTED || entry.status === ReturnStatus.UNDER_REVIEW
        ? entry.requestedQuantity
        : entry.approvedQuantity;
    return sum + claim;
  }, 0);
  return Math.max(0, input.invoicedQuantity - claimed);
}

export interface DispositionInput {
  restockQuantity: number;
  damagedQuantity: number;
  expiredQuantity: number;
  quarantinedQuantity: number;
}

export function dispositionTotal(line: DispositionInput) {
  return (
    line.restockQuantity + line.damagedQuantity + line.expiredQuantity + line.quarantinedQuantity
  );
}

/**
 * Received units must equal what was inspected, must not exceed what was
 * approved, and an expired batch may never be restocked — it would re-enter the
 * catalogue as saleable stock.
 */
export function assertDispositionValid(input: {
  approvedQuantity: number;
  batchExpired: boolean;
  disposition: DispositionInput;
}) {
  const total = dispositionTotal(input.disposition);
  if (total > input.approvedQuantity) {
    throw ruleError(
      'Inspected quantity exceeds the approved return quantity',
      'RECEIPT_EXCEEDS_APPROVAL',
    );
  }
  if (input.batchExpired && input.disposition.restockQuantity > 0) {
    throw ruleError(
      'An expired batch cannot be restocked; record the units as expired',
      'EXPIRED_BATCH_RESTOCK',
    );
  }
  return total;
}

export function dispositionMovements(disposition: DispositionInput) {
  return [
    { disposition: ReturnDisposition.RESTOCK, quantity: disposition.restockQuantity },
    { disposition: ReturnDisposition.DAMAGED, quantity: disposition.damagedQuantity },
    { disposition: ReturnDisposition.EXPIRED, quantity: disposition.expiredQuantity },
    { disposition: ReturnDisposition.QUARANTINED, quantity: disposition.quarantinedQuantity },
  ].filter((entry) => entry.quantity > 0);
}

/**
 * Refund for part of an invoice line. The discount is prorated with the same
 * rounding the invoice used, and the result is capped at the line's own value
 * so a rounding step can never credit more than was charged.
 */
export function lineRefundMinor(input: {
  invoicedQuantity: number;
  unitPriceMinor: number;
  lineDiscountMinor: number;
  quantity: number;
  /**
   * How many units physically went out, where a scheme sent more than were
   * charged. Absent means they are the same, which is every line issued before
   * schemes existed and every line without one.
   */
  dispatchedQuantity?: number;
}) {
  if (input.quantity === 0) return { refundMinor: 0, discountMinor: 0 };

  const dispatched = input.dispatchedQuantity ?? input.invoicedQuantity;

  /*
   * A scheme line: eleven went out and ten were charged.
   *
   * Returning six credits six **elevenths** of what was paid, not six tenths.
   * Crediting per charged unit would refund more than the customer handed over
   * — on a 10+1 that is a tenth too much, every time, and it comes out of
   * margin rather than out of anything anybody decided.
   *
   * `prorateMinor` rather than a second proration written here: it is already
   * BigInt, already rounds half-up, and is already the primitive the rest of
   * the credit arithmetic uses.
   */
  if (dispatched > input.invoicedQuantity) {
    if (input.quantity > dispatched) {
      throw ruleError('Return quantity exceeds what was dispatched', 'RETURN_EXCEEDS_INVOICE');
    }
    const chargedTotal = input.unitPriceMinor * input.invoicedQuantity - input.lineDiscountMinor;
    if (!Number.isSafeInteger(chargedTotal)) {
      throw ruleError('Return line value exceeds the safe integer range', 'MONEY_OVERFLOW', 500);
    }
    const refundMinor = prorateMinor(Math.max(0, chargedTotal), input.quantity, dispatched);
    return {
      refundMinor,
      discountMinor: prorateMinor(input.lineDiscountMinor, input.quantity, dispatched),
    };
  }

  if (input.quantity > input.invoicedQuantity) {
    throw ruleError('Return quantity exceeds the invoiced quantity', 'RETURN_EXCEEDS_INVOICE');
  }
  const gross = input.unitPriceMinor * input.quantity;
  if (!Number.isSafeInteger(gross)) {
    throw ruleError('Return line value exceeds the safe integer range', 'MONEY_OVERFLOW', 500);
  }
  const discountMinor = Math.min(
    gross,
    prorateMinor(input.lineDiscountMinor, input.quantity, input.invoicedQuantity),
  );
  return { refundMinor: gross - discountMinor, discountMinor };
}

/**
 * Tax credited back, prorated over the invoice's taxable base. Delivery charge
 * is part of that base but is never itself refunded, so returning every unit of
 * an invoice still leaves the delivery charge and its tax with the customer.
 */
export function refundTaxMinor(input: {
  refundSubtotalMinor: number;
  invoiceTaxMinor: number;
  invoiceTaxableBaseMinor: number;
}) {
  if (input.invoiceTaxMinor === 0 || input.invoiceTaxableBaseMinor <= 0) return 0;
  const capped = Math.min(input.refundSubtotalMinor, input.invoiceTaxableBaseMinor);
  return prorateMinor(input.invoiceTaxMinor, capped, input.invoiceTaxableBaseMinor);
}

export interface CreditLineInput {
  invoicedQuantity: number;
  unitPriceMinor: number;
  lineDiscountMinor: number;
  quantity: number;
}

/**
 * The full credit for a set of returned lines, in the same order the invoice
 * built its total: line discounts first, then the order-level discount shared
 * in proportion, then tax on what remains. Crediting the gross line value
 * without the order discount share would refund more than was charged.
 */
export function computeReturnCredit(input: {
  lines: CreditLineInput[];
  invoiceSubtotalMinor: number;
  invoiceOrderDiscountMinor: number;
  invoiceDeliveryChargeMinor: number;
  invoiceTaxMinor: number;
}) {
  const lines = input.lines.map((line) => lineRefundMinor(line));
  const grossRefundMinor = lines.reduce((sum, line) => sum + line.refundMinor, 0);
  if (!Number.isSafeInteger(grossRefundMinor)) {
    throw ruleError('Return credit exceeds the safe integer range', 'MONEY_OVERFLOW', 500);
  }
  const orderDiscountShareMinor =
    input.invoiceOrderDiscountMinor === 0 || input.invoiceSubtotalMinor <= 0
      ? 0
      : Math.min(
          grossRefundMinor,
          prorateMinor(
            input.invoiceOrderDiscountMinor,
            Math.min(grossRefundMinor, input.invoiceSubtotalMinor),
            input.invoiceSubtotalMinor,
          ),
        );
  const subtotalMinor = grossRefundMinor - orderDiscountShareMinor;
  const taxMinor = refundTaxMinor({
    refundSubtotalMinor: subtotalMinor,
    invoiceTaxMinor: input.invoiceTaxMinor,
    invoiceTaxableBaseMinor:
      input.invoiceSubtotalMinor -
      input.invoiceOrderDiscountMinor +
      input.invoiceDeliveryChargeMinor,
  });
  return {
    lines,
    grossRefundMinor,
    orderDiscountShareMinor,
    subtotalMinor,
    taxMinor,
    totalMinor: subtotalMinor + taxMinor,
  };
}

/** Refuses a credit that would take total credits past the invoice value. */
export function assertCreditWithinInvoice(input: {
  invoiceGrandTotalMinor: number;
  alreadyCreditedMinor: number;
  proposedCreditMinor: number;
}) {
  const total = input.alreadyCreditedMinor + input.proposedCreditMinor;
  if (!Number.isSafeInteger(total)) {
    throw ruleError('Credit total exceeds the safe integer range', 'MONEY_OVERFLOW', 500);
  }
  if (total > input.invoiceGrandTotalMinor) {
    throw ruleError(
      'Credit notes for this invoice would exceed the invoiced total',
      'CREDIT_EXCEEDS_INVOICE',
    );
  }
  return total;
}
