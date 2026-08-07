import { describe, expect, it } from 'vitest';
import { UserRole } from '@medsupply/shared-types';
import { getFinanceNavigation } from './navigation';

/**
 * This list carries **only what the shared manifest has no id for**, which is
 * "your own money" for the two roles whose money is their own. The overlap rule
 * itself is in `navigation/routes.test.ts`, where both menus are visible at
 * once; these are the specific answers, so the intent survives a refactor of
 * either side.
 */
describe('role-gated Phase 8 navigation', () => {
  it('gives a shop owner the one money screen the manifest cannot name', () => {
    // Their account, payment history and statement are `shop-account`,
    // `my-payments` and `my-statement` in the manifest, and were listed here as
    // well until the home menu stopped filtering itself down to tabs.
    expect(getFinanceNavigation(UserRole.SHOP_OWNER).map((item) => item.route)).toEqual([
      '/(protected)/invoices',
    ]);
  });

  it('gives management nothing, because the manifest already has all of it', () => {
    for (const role of [UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN]) {
      expect(getFinanceNavigation(role)).toEqual([]);
    }
  });

  it('isolates delivery and storekeeper finance routes', () => {
    // The rider's own collections, which has no id anywhere and is the reason
    // this file was kept rather than deleted.
    expect(getFinanceNavigation(UserRole.DELIVERY_PERSON).map((item) => item.route)).toEqual([
      '/(protected)/collections',
    ]);
    expect(getFinanceNavigation(UserRole.STOREKEEPER)).toEqual([]);
  });
});
