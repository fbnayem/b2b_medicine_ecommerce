import { OrderStatus } from '@medsupply/shared-types';
import type { Order } from '@medsupply/shared-types';

/**
 * What a customer may do with an order they are looking at.
 *
 * The order screen was read-only. Every one of these is an endpoint that has
 * existed for phases and had **no caller anywhere in this application** — so a
 * shop owner who wanted the same order again, or wanted to stop one, or wanted
 * their invoice, had to find a computer.
 *
 * The server decides all of this too; this only decides whether a button is
 * worth showing. A button that 403s is worse than no button, and a button that
 * is absent when the action is available is a feature nobody finds.
 */

/**
 * Asking to cancel, which is not cancelling.
 *
 * Exactly the three statuses `orderController.requestCancellation` admits.
 * Once an order is approved the warehouse may already be picking it, and the
 * answer then is a return rather than a cancellation.
 */
export const CANCELLABLE: readonly string[] = [
  OrderStatus.SUBMITTED,
  OrderStatus.UNDER_REVIEW,
  OrderStatus.ON_HOLD,
];

/**
 * When there is a delivery to follow.
 *
 * From the moment one is assigned, and not before: `GET /deliveries/order/:id`
 * answers 404 with "Delivery not created yet" until then, and a button that
 * opens a not-found is worse than no button. `INVOICE_GENERATED` and
 * `READY_FOR_DELIVERY` are deliberately absent for that reason — the order is
 * packed and waiting, and there is nothing yet to show on a map or a phone.
 *
 * `DELIVERY_FAILED` **is** included. That is precisely when a shop wants to
 * know what happened.
 */
export const TRACKABLE: readonly string[] = [
  OrderStatus.DELIVERY_ASSIGNED,
  OrderStatus.HANDED_TO_DELIVERY,
  OrderStatus.PICKED_UP,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.PARTIALLY_DELIVERED,
  OrderStatus.DELIVERY_FAILED,
];

export interface OrderActions {
  /** Always. Ordering the same things again is the commonest thing a shop does. */
  reorder: boolean;
  askToCancel: boolean;
  track: boolean;
}

/**
 * Deliberately no "see the invoice" and no "send this back".
 *
 * Both need an invoice id and **`Order` does not carry one** — the link is held
 * the other way round, on `Invoice.orderId`, and `GET /orders/{id}` returns the
 * order alone. The web client has the same shape and answers it the same way:
 * every invoice link in `apps/web` starts from the account, a delivery or a pick
 * list, and `ReturnRequest` opens with a picker over `GET /finance/my/invoices`.
 *
 * So invoices and returns are reached from the invoice, which is where a
 * pharmacy looks for them anyway — they file by invoice, not by order. Adding
 * `GET /fulfilment/invoices/by-order/{id}` to put one button here would be a new
 * endpoint, a new waiver and a regenerated specification, for a path the product
 * already has.
 */
export function actionsFor(order: Pick<Order, 'status'>): OrderActions {
  const status = String(order.status);
  return {
    reorder: true,
    askToCancel: CANCELLABLE.includes(status),
    track: TRACKABLE.includes(status),
  };
}

/**
 * The reason a cancellation needs, checked before the round trip.
 *
 * `CancellationRequestSchema` requires 5 to 500 characters. Saying so in the
 * prompt is the difference between a refusal a person can act on and a 400
 * they have to guess at.
 */
export const CANCELLATION_REASON = { minimum: 5, maximum: 500 } as const;

export function cancellationReasonProblem(value: string): 'tooShort' | 'tooLong' | null {
  const trimmed = value.trim();
  if (trimmed.length < CANCELLATION_REASON.minimum) return 'tooShort';
  if (trimmed.length > CANCELLATION_REASON.maximum) return 'tooLong';
  return null;
}
