import { OrderStatus } from '@medsupply/shared-types';
import type { Order } from '@medsupply/shared-types';

/**
 * Which orders are still happening, and which one to offer again.
 *
 * Pure, so the home screen's two judgements can be tested without a device.
 */

/**
 * An order the shop is still waiting on.
 *
 * Everything from submitted up to the door, and **not** delivered, rejected or
 * cancelled — those are finished, and a home screen that lists finished work
 * as "on its way" is the same defect the approvals tile had: a number that
 * counts history and calls it a backlog.
 *
 * `DELIVERY_FAILED` counts as still happening. Nothing has arrived, and it is
 * the case a shop most needs to see on opening the application.
 */
export const STILL_COMING: readonly string[] = [
  OrderStatus.SUBMITTED,
  OrderStatus.UNDER_REVIEW,
  OrderStatus.ON_HOLD,
  OrderStatus.APPROVED,
  OrderStatus.PARTIALLY_APPROVED,
  OrderStatus.PREPARING,
  OrderStatus.PACKING,
  OrderStatus.PACKED,
  OrderStatus.INVOICE_GENERATED,
  OrderStatus.READY_FOR_DELIVERY,
  OrderStatus.DELIVERY_ASSIGNED,
  OrderStatus.HANDED_TO_DELIVERY,
  OrderStatus.PICKED_UP,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
];

export function stillComing(orders: readonly Order[]): Order[] {
  return orders.filter((order) => STILL_COMING.includes(String(order.status)));
}

/**
 * The order worth offering again: the most recent one that actually arrived.
 *
 * **Delivered, not merely placed.** An order that was rejected, cancelled or is
 * still in the warehouse is a poor thing to suggest repeating — the first two
 * because somebody already decided against them, the third because it is on its
 * way and repeating it doubles the delivery. What a pharmacy re-orders is the
 * list that worked last time.
 *
 * `GET /orders` sorts newest first, and this trusts that rather than sorting
 * again on dates the list may not carry.
 */
export function worthRepeating(orders: readonly Order[]): Order | undefined {
  return orders.find(
    (order) =>
      String(order.status) === OrderStatus.DELIVERED ||
      String(order.status) === OrderStatus.PARTIALLY_DELIVERED,
  );
}
