import { describe, expect, it } from 'vitest';
import {
  APPROVAL_AWAITING,
  APPROVAL_DECIDED,
  APPROVAL_QUEUE,
  OrderStatus,
  PICKING_DONE,
  PICKING_OUTSTANDING,
  PICKING_QUEUE,
} from '@medsupply/shared-types';
import { approvalsQueue, pickingQueue } from './workQueues';
import { signalsFor } from './homeSignals';
import { UserRole } from '@medsupply/shared-types';

/**
 * A number on the home screen means what its words say.
 *
 * Two of the four tiles did not. "Orders waiting for your decision" said 3 when
 * one was waiting; the other two had been approved and rejected days earlier.
 * "Orders to pick" said 15 when one was; fourteen were packed and gone. Both
 * counted the whole of an endpoint whose default returns a queue's history
 * rather than its backlog, and every test passed the entire time, because
 * nothing anywhere said what either number was supposed to exclude.
 *
 * So these are the assertions that would have caught it.
 */

describe('what counts as outstanding', () => {
  it('the two halves of the approvals queue are disjoint', () => {
    const overlap = APPROVAL_AWAITING.filter((status) =>
      (APPROVAL_DECIDED as readonly string[]).includes(status),
    );
    expect(overlap, 'A status cannot be both waiting and decided.').toEqual([]);
  });

  it('the two halves cover every status the approvals queue serves', () => {
    /*
     * The completeness rule, and the one that matters most. A seventh status
     * added to the queue and classified as neither would silently vanish from
     * the count on the home screen — which is exactly the shape of the defect
     * this file exists about, just with a different status.
     */
    expect([...APPROVAL_AWAITING, ...APPROVAL_DECIDED].sort()).toEqual([...APPROVAL_QUEUE].sort());
  });

  it('nothing decided is counted as waiting', () => {
    // Named individually, because these are the three that were being counted.
    for (const decided of [
      OrderStatus.APPROVED,
      OrderStatus.PARTIALLY_APPROVED,
      OrderStatus.REJECTED,
    ]) {
      expect(APPROVAL_AWAITING as readonly string[]).not.toContain(decided);
    }
  });

  it('the two halves of the picking queue are disjoint and complete', () => {
    const overlap = PICKING_OUTSTANDING.filter((status) =>
      (PICKING_DONE as readonly string[]).includes(status),
    );
    expect(overlap).toEqual([]);
    expect([...PICKING_OUTSTANDING, ...PICKING_DONE].sort()).toEqual([...PICKING_QUEUE].sort());
  });

  it('nothing already packed is counted as still to pick', () => {
    expect(PICKING_OUTSTANDING as readonly string[]).not.toContain('PACKED');
    // And the stuck ones *are* counted: a queue that hides them is how they
    // stay stuck.
    expect(PICKING_OUTSTANDING as readonly string[]).toContain('BLOCKED_DISCREPANCY');
  });
});

describe('a tile asks for exactly what its screen shows', () => {
  /*
   * `homeSignals` promises that a signal reuses the URL of the screen it links
   * to. That was true and useless while both were unfiltered: the screen showed
   * everything and the tile counted everything, and the tile's *label* was the
   * only thing claiming otherwise. What has to hold is that the tile's request
   * matches the request the destination makes **by default**, which is what
   * these assert.
   */
  const signals = signalsFor(UserRole.SUPER_ADMIN);
  const signal = (id: string) => signals.find((entry) => entry.id === id);

  it('the approvals tile asks for the orders still awaiting a decision', () => {
    expect(signal('approvals')?.url).toBe(approvalsQueue.url(approvalsQueue.outstanding));
    expect(signal('approvals')?.url).toContain('status=SUBMITTED,UNDER_REVIEW,ON_HOLD');
  });

  it('the picking tile asks for the lists not yet packed', () => {
    expect(signal('picking')?.url).toBe(pickingQueue.url(pickingQueue.outstanding));
    expect(signal('picking')?.url).not.toContain('PACKED');
  });

  it('every tile carries a filter or reaches an endpoint that filters itself', () => {
    /*
     * The other two were right by accident of where the filter lived —
     * `/fulfilment/ready` matches on `handoverStatus` and the deliveries tile
     * passes its own status. Naming them here means a fifth tile added against
     * an unfiltered endpoint has to justify itself rather than quietly ship.
     */
    const FILTERS_SERVER_SIDE = ['/fulfilment/ready'];
    for (const entry of signals) {
      const filtered = entry.url.includes('?') || FILTERS_SERVER_SIDE.includes(entry.url);
      expect(
        filtered,
        `${entry.id} counts every row ${entry.url} returns. If that endpoint's default is a ` +
          'history rather than a backlog, the number under it is wrong.',
      ).toBe(true);
    }
  });

  it('the filter offered on each screen includes the default it opens with', () => {
    // Otherwise the screen opens on a filter no tab is showing as selected.
    expect(approvalsQueue.filters).toContain(approvalsQueue.outstanding);
    expect(pickingQueue.filters).toContain(pickingQueue.outstanding);
    // "All" stays reachable — the decided ones are still worth looking at.
    expect(approvalsQueue.filters).toContain('');
    expect(pickingQueue.filters).toContain('');
  });

  it('the tiles under test actually exist, so a clean run is not an empty one', () => {
    expect(signal('approvals')).toBeDefined();
    expect(signal('picking')).toBeDefined();
    expect(signals.length).toBeGreaterThan(3);
  });
});
