import { describe, expect, it } from 'vitest';
import { OrderStatus } from '@medsupply/shared-types';
import type { Order } from '@medsupply/shared-types';
import { STILL_COMING, stillComing, worthRepeating } from './openOrders';

/**
 * The two judgements the home screen makes about a shop's orders.
 *
 * Both are the same class of thing as the approvals tile that said "3 waiting"
 * when one was: a list filtered by a rule nobody wrote down, read as a fact
 * about today. So the rules are written down here.
 */

const order = (status: string, reference = 'ORD-1'): Order =>
  ({ _id: reference, reference, status, items: [] }) as unknown as Order;

describe('what is still on its way', () => {
  it('counts an order at every step between sent and arrived', () => {
    for (const status of [
      OrderStatus.SUBMITTED,
      OrderStatus.APPROVED,
      OrderStatus.PACKING,
      OrderStatus.OUT_FOR_DELIVERY,
    ]) {
      expect(stillComing([order(status)]), status).toHaveLength(1);
    }
  });

  it('does not count what has finished', () => {
    /*
     * Delivered, rejected and cancelled are done. Listing them under "on its
     * way" is exactly the defect the approvals tile had — history presented as
     * outstanding work — and a shop that reads it stops trusting the screen.
     */
    for (const status of [
      OrderStatus.DELIVERED,
      OrderStatus.PARTIALLY_DELIVERED,
      OrderStatus.REJECTED,
      OrderStatus.CANCELLED,
      OrderStatus.RETURNED,
      OrderStatus.DRAFT,
    ]) {
      expect(stillComing([order(status)]), status).toEqual([]);
    }
  });

  it('still counts a failed delivery, which is when they most want to know', () => {
    // Nothing arrived, so it is still outstanding — and it is the case a shop
    // most needs on opening the application.
    expect(stillComing([order(OrderStatus.DELIVERY_FAILED)])).toHaveLength(1);
  });

  it('names only statuses that exist', () => {
    const known = new Set<string>(Object.values(OrderStatus));
    for (const status of STILL_COMING) {
      expect(known.has(status), `${status} is not an order status`).toBe(true);
    }
  });

  it('leaves a draft out, because nobody has been told about it', () => {
    expect(STILL_COMING).not.toContain(OrderStatus.DRAFT);
  });
});

describe('which order is worth offering again', () => {
  it('is the most recent one that actually arrived', () => {
    /*
     * `GET /orders` is newest first, and this trusts that ordering rather than
     * re-sorting on a date the list may not carry.
     */
    const found = worthRepeating([
      order(OrderStatus.SUBMITTED, 'ORD-3'),
      order(OrderStatus.DELIVERED, 'ORD-2'),
      order(OrderStatus.DELIVERED, 'ORD-1'),
    ]);
    expect(found?.reference).toBe('ORD-2');
  });

  it('accepts a partial delivery, because some of it did arrive', () => {
    expect(worthRepeating([order(OrderStatus.PARTIALLY_DELIVERED)])).toBeDefined();
  });

  it('never offers an order somebody already decided against', () => {
    // Repeating a rejected or cancelled order suggests the shop try again at
    // something a manager has just refused.
    expect(worthRepeating([order(OrderStatus.REJECTED)])).toBeUndefined();
    expect(worthRepeating([order(OrderStatus.CANCELLED)])).toBeUndefined();
  });

  it('never offers one that is still coming, which would double the delivery', () => {
    expect(worthRepeating([order(OrderStatus.OUT_FOR_DELIVERY)])).toBeUndefined();
  });

  it('offers nothing at all to a shop that has never received anything', () => {
    expect(worthRepeating([])).toBeUndefined();
  });
});
