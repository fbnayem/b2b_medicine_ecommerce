import { describe, expect, it } from 'vitest';
import { OrderStatus } from '@medsupply/shared-types';
import { actionsFor, cancellationReasonProblem, CANCELLABLE, TRACKABLE } from './actions';

/**
 * Which buttons a customer sees on their order.
 *
 * The screen had none: reordering, asking to cancel and following a delivery
 * are all endpoints that existed for phases with no caller anywhere on this
 * client. Getting the boundaries right matters in both directions — a button
 * that 403s reads as the application being broken, and a missing button is a
 * feature nobody ever finds.
 */
describe('what a customer may do with an order', () => {
  const at = (status: string) => actionsFor({ status } as never);

  it('lets them order the same things again, whatever happened to this one', () => {
    // Including a rejected or cancelled order: wanting the same list again is
    // independent of how the last attempt ended.
    for (const status of Object.values(OrderStatus)) {
      expect(at(status).reorder, status).toBe(true);
    }
  });

  it('offers to ask for a cancellation exactly while the server would accept one', () => {
    /*
     * `orderController.requestCancellation` admits SUBMITTED, UNDER_REVIEW and
     * ON_HOLD and answers 409 otherwise. These two lists have to agree, and
     * this is what holds them together.
     */
    expect([...CANCELLABLE].sort()).toEqual(
      [OrderStatus.SUBMITTED, OrderStatus.UNDER_REVIEW, OrderStatus.ON_HOLD].sort(),
    );
    expect(at(OrderStatus.SUBMITTED).askToCancel).toBe(true);
    expect(at(OrderStatus.ON_HOLD).askToCancel).toBe(true);
  });

  it('stops offering it once the warehouse may already be picking', () => {
    // After approval the answer is a return, not a cancellation, and offering
    // the wrong one wastes a day of somebody's expectation.
    for (const status of [
      OrderStatus.APPROVED,
      OrderStatus.PACKING,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
    ]) {
      expect(at(status).askToCancel, status).toBe(false);
    }
  });

  it('offers to follow a delivery only once there is one to follow', () => {
    /*
     * `getOrderDelivery` answers 404 with "Delivery not created yet" until a
     * delivery is assigned. An order that is merely packed has none, so the
     * button would open a not-found — which is exactly the shape of defect that
     * makes people stop trusting a screen.
     */
    expect(at(OrderStatus.INVOICE_GENERATED).track).toBe(false);
    expect(at(OrderStatus.READY_FOR_DELIVERY).track).toBe(false);
    expect(at(OrderStatus.DELIVERY_ASSIGNED).track).toBe(true);
    expect(at(OrderStatus.OUT_FOR_DELIVERY).track).toBe(true);
  });

  it('still offers it after a failed delivery, which is when they most want it', () => {
    expect(at(OrderStatus.DELIVERY_FAILED).track).toBe(true);
    expect(TRACKABLE).toContain(OrderStatus.DELIVERY_FAILED);
  });

  it('names every status it decides about, so a new one is a decision', () => {
    // A status added to the enum and to neither list here would silently get
    // "reorder only", which may be right — but it should be chosen, not fallen
    // into. This asserts the two lists only hold statuses that exist.
    const known = new Set<string>(Object.values(OrderStatus));
    for (const status of [...CANCELLABLE, ...TRACKABLE]) {
      expect(known.has(status), `${status} is not an order status`).toBe(true);
    }
  });
});

describe('the reason a cancellation needs', () => {
  it('refuses one too short for a manager to act on', () => {
    // `CancellationRequestSchema` requires five characters. Checking here means
    // the refusal arrives while the text is still on screen and editable.
    expect(cancellationReasonProblem('no')).toBe('tooShort');
    expect(cancellationReasonProblem('    ')).toBe('tooShort');
  });

  it('refuses one the server would reject for length', () => {
    expect(cancellationReasonProblem('x'.repeat(501))).toBe('tooLong');
  });

  it('accepts an ordinary sentence', () => {
    expect(cancellationReasonProblem('Ordered twice by mistake')).toBeNull();
  });

  it('measures the trimmed text, so spaces are not a reason', () => {
    expect(cancellationReasonProblem('  ab  ')).toBe('tooShort');
  });
});
