import { describe, expect, it } from 'vitest';
import { UserRole } from '@medsupply/shared-types';
import { blockedByDiscrepancy, blocksFor } from './waiting';

/**
 * The staff home screen's whole content is a judgement about **what is worth
 * interrupting somebody with**, and that judgement is here rather than in the
 * markup so it can be argued with.
 *
 * Two ways to get it wrong, opposite and both quiet. Showing a zero teaches
 * people to stop reading the screen, after which a real four is invisible.
 * Showing the wrong order puts a customer who has asked twice to be cancelled
 * underneath a figure nobody can act on today.
 */
describe('what is waiting on a member of staff', () => {
  const full = {
    approvals: 4,
    cancellations: 1,
    discrepancies: 2,
    overdueShops: 11,
    picking: 3,
    counting: 1,
    arriving: 2,
    customers: 18,
    openOrders: 6,
  };

  it('asks a manager about the people who are blocked before the money', () => {
    /*
     * A discrepancy has a storekeeper standing at a shelf; a cancellation has a
     * customer who has already asked. Overdue money is urgent and nobody is
     * waiting on this person for it, so it goes last of the four.
     */
    expect(blocksFor(UserRole.MANAGER, full).map((block) => block.kind)).toEqual([
      'approvals',
      'cancellations',
      'discrepancies',
      'overdue',
    ]);
  });

  it('gives a storekeeper the warehouse and a rep their customers', () => {
    expect(blocksFor(UserRole.STOREKEEPER, full).map((block) => block.kind)).toEqual([
      'picking',
      'counting',
      'arriving',
    ]);
    expect(blocksFor(UserRole.SALES, full).map((block) => block.kind)).toEqual([
      'openOrders',
      'customers',
      'overdue',
    ]);
  });

  it('never shows a nought', () => {
    // "0 orders to approve" is a line that teaches somebody to stop reading the
    // screen, and the next number they miss is a real one.
    expect(blocksFor(UserRole.MANAGER, { approvals: 0, cancellations: 2 })).toHaveLength(1);
    expect(blocksFor(UserRole.MANAGER, {})).toEqual([]);
    expect(blocksFor(UserRole.STOREKEEPER, {})).toEqual([]);
  });

  it('says which of them has somebody standing at the other end', () => {
    const manager = blocksFor(UserRole.MANAGER, full);
    expect(manager.filter((block) => block.blocking).map((block) => block.kind)).toEqual([
      'approvals',
      'cancellations',
      'discrepancies',
    ]);
    expect(manager.find((block) => block.kind === 'overdue')?.blocking).toBe(false);
  });

  it('sends each block somewhere, and somewhere different', () => {
    const routes = blocksFor(UserRole.MANAGER, full).map((block) => block.route);
    expect(routes.every((route) => route.startsWith('/(protected)/'))).toBe(true);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('offers a rider and a shop owner nothing, because they have their own home', () => {
    expect(blocksFor(UserRole.DELIVERY_PERSON, full)).toEqual([]);
    expect(blocksFor(UserRole.SHOP_OWNER, full)).toEqual([]);
    expect(blocksFor(undefined, full)).toEqual([]);
  });
});

/**
 * A picking list stopped by a discrepancy is the one number on this screen that
 * cannot be asked for directly — there is no "how many are blocked" endpoint,
 * and inventing a round trip for a figure already in the queue response is how
 * a home screen becomes slow on a warehouse connection.
 */
describe('picking lists stopped by a discrepancy', () => {
  it('counts a list once however many discrepancies it has', () => {
    expect(
      blockedByDiscrepancy([
        { discrepancies: [{ status: 'OPEN' }, { status: 'OPEN' }] },
        { discrepancies: [{ status: 'RESOLVED' }] },
        { discrepancies: [] },
        {},
      ]),
    ).toBe(1);
  });

  it('does not count one that has already been decided', () => {
    // The distinction the whole mechanism rests on: a resolved discrepancy is
    // history, and picking has continued.
    expect(blockedByDiscrepancy([{ discrepancies: [{ status: 'RESOLVED' }] }])).toBe(0);
    expect(blockedByDiscrepancy([])).toBe(0);
  });
});
