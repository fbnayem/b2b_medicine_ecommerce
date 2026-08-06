import { describe, expect, it } from 'vitest';
import { UserRole } from '@medsupply/shared-types';
import { NAV_ITEMS, navItemsFor } from '@medsupply/navigation';
import { OWN_ACCOUNT, showsOwnAccount, signalsFor } from './homeSignals';

/**
 * What each role is shown on the first screen of their day.
 *
 * The home screen is the one place where a card that answers 403 is worst: it
 * is not a screen somebody chose to open. So the assertions here are about the
 * two ways that can happen — a signal pointing at a navigation entry that does
 * not exist, and a signal offered to a role the manifest would refuse.
 */

const ALL = [...Object.values(UserRole)];

describe('the figures on the home screen', () => {
  it('only ever points at a navigation entry that exists', () => {
    const ids = new Set(NAV_ITEMS.map((item) => item.id));
    const dangling = [...ALL.flatMap(signalsFor), OWN_ACCOUNT]
      .filter((signal) => !ids.has(signal.navId))
      .map((signal) => `${signal.id} → ${signal.navId}`);

    expect(dangling).toEqual([]);
  });

  it('never offers a role a figure the manifest would refuse them', () => {
    const wrong: string[] = [];
    for (const role of ALL) {
      const reachable = new Set(navItemsFor(role).map((item) => item.id));
      for (const signal of signalsFor(role)) {
        if (!reachable.has(signal.navId)) wrong.push(`${role} → ${signal.id}`);
      }
      if (showsOwnAccount(role) && !reachable.has(OWN_ACCOUNT.navId)) {
        wrong.push(`${role} → ${OWN_ACCOUNT.id}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('links each figure at the screen whose request it borrowed', () => {
    /*
     * The number and the list it opens must come from the same request, or the
     * home screen says four and the queue shows three. This is what stops
     * somebody "optimising" a signal onto a cheaper count endpoint later.
     */
    for (const signal of signalsFor(UserRole.MANAGER)) {
      const entry = NAV_ITEMS.find((item) => item.id === signal.navId);
      expect(signal.path, `${signal.id} goes where its navigation entry goes`).toBe(entry?.path);
    }
  });

  it('gives a manager the approvals queue and a storekeeper the picking one', () => {
    const manager = signalsFor(UserRole.MANAGER).map((signal) => signal.id);
    const storekeeper = signalsFor(UserRole.STOREKEEPER).map((signal) => signal.id);

    expect(manager).toContain('approvals');
    // A storekeeper does not decide anything about price or credit.
    expect(storekeeper).not.toContain('approvals');
    expect(storekeeper).toContain('picking');
  });

  it('shows a shop owner what they owe and what is on its way to them', () => {
    /*
     * Written the other way round first — "a shop owner sees no queues at all"
     * — and the manifest said otherwise: they hold `deliveries`, scoped by the
     * server to their own shop. Which makes "out for delivery now" the one
     * queue on this list that is genuinely theirs, and worth more to a pharmacy
     * than anything else on the screen.
     */
    const owner = signalsFor(UserRole.SHOP_OWNER).map((signal) => signal.id);

    expect(owner).toEqual(['on-the-road']);
    expect(showsOwnAccount(UserRole.SHOP_OWNER)).toBe(true);
  });

  it('never shows a shop owner the warehouse’s own backlog', () => {
    const owner = signalsFor(UserRole.SHOP_OWNER).map((signal) => signal.id);

    for (const id of ['approvals', 'picking', 'ready']) {
      expect(owner, `a shop owner is shown "${id}"`).not.toContain(id);
    }
  });

  it('shows nobody else what a shop owner owes', () => {
    const others = ALL.filter((role) => role !== UserRole.SHOP_OWNER);
    expect(others.filter(showsOwnAccount)).toEqual([]);
  });
});
