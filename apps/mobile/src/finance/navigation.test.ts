import { describe, expect, it } from 'vitest';
import { UserRole } from '@medsupply/shared-types';
import { getFinanceNavigation } from './navigation';

describe('role-gated Phase 8 navigation', () => {
  it('shows owner account, invoices, payments, and statement only', () => {
    expect(getFinanceNavigation(UserRole.SHOP_OWNER).map((item) => item.route)).toEqual([
      '/(protected)/account',
      '/(protected)/invoices',
      '/(protected)/payments',
      '/(protected)/statement',
    ]);
  });

  it('shows management finance operations to authorised internal roles', () => {
    const expected = [
      '/(protected)/finance-dashboard',
      '/(protected)/overdue-shops',
      '/(protected)/collection-review',
    ];
    expect(getFinanceNavigation(UserRole.MANAGER).map((item) => item.route)).toEqual(expected);
    expect(getFinanceNavigation(UserRole.ADMIN).map((item) => item.route)).toEqual(expected);
    expect(getFinanceNavigation(UserRole.SUPER_ADMIN).map((item) => item.route)).toEqual(expected);
  });

  it('isolates delivery and storekeeper finance routes', () => {
    expect(getFinanceNavigation(UserRole.DELIVERY_PERSON).map((item) => item.route)).toEqual([
      '/(protected)/collections',
    ]);
    expect(getFinanceNavigation(UserRole.STOREKEEPER)).toEqual([]);
  });
});
