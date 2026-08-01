import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@medsupply/shared-types';

// The API client pulls in react-native, whose Flow sources the test bundler
// cannot parse. Only the pure policy and validation helpers are exercised here.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

import { availableActions, dispositionProblem, returnStatusLabel } from './api';

const future = { approvedQuantity: 5, expiryDate: '2030-01-01T00:00:00.000Z' };
const past = { approvedQuantity: 5, expiryDate: '2020-01-01T00:00:00.000Z' };
const empty = {
  restockQuantity: 0,
  damagedQuantity: 0,
  expiredQuantity: 0,
  quarantinedQuantity: 0,
};

describe('return action availability', () => {
  it('offers review and rejection to management on a new request', () => {
    const actions = availableActions(UserRole.MANAGER, 'REQUESTED');
    expect(actions).toContain('review');
    expect(actions).toContain('approve');
    expect(actions).toContain('reject');
    expect(actions).toContain('cancel');
  });

  it('never offers approval or credit to a storekeeper', () => {
    expect(availableActions(UserRole.STOREKEEPER, 'REQUESTED')).toEqual([]);
    expect(availableActions(UserRole.STOREKEEPER, 'RECEIVED')).toEqual([]);
    expect(availableActions(UserRole.STOREKEEPER, 'APPROVED')).toEqual(['receive']);
  });

  it('offers collection to a delivery person only once the return is approved', () => {
    expect(availableActions(UserRole.DELIVERY_PERSON, 'REQUESTED')).toEqual([]);
    expect(availableActions(UserRole.DELIVERY_PERSON, 'APPROVED')).toEqual(['collect']);
    expect(availableActions(UserRole.DELIVERY_PERSON, 'PARTIALLY_APPROVED')).toEqual(['collect']);
    expect(availableActions(UserRole.DELIVERY_PERSON, 'COLLECTED')).toEqual([]);
  });

  it('lets a shop owner withdraw a request but nothing else', () => {
    expect(availableActions(UserRole.SHOP_OWNER, 'REQUESTED')).toEqual(['cancel']);
    expect(availableActions(UserRole.SHOP_OWNER, 'RECEIVED')).toEqual([]);
    expect(availableActions(UserRole.SHOP_OWNER, 'COMPLETED')).toEqual([]);
  });

  it('offers the credit note only after the goods have been received', () => {
    expect(availableActions(UserRole.MANAGER, 'COLLECTED')).not.toContain('credit-note');
    expect(availableActions(UserRole.MANAGER, 'RECEIVED')).toContain('credit-note');
    expect(availableActions(UserRole.MANAGER, 'COMPLETED')).toEqual([]);
  });

  it('offers nothing when the session has no role', () => {
    expect(availableActions(undefined, 'REQUESTED')).toEqual([]);
  });
});

describe('receipt validation before the round trip', () => {
  it('accepts a split disposition that totals the approved quantity', () => {
    expect(
      dispositionProblem(future, { ...empty, restockQuantity: 3, damagedQuantity: 2 }),
    ).toBeNull();
  });

  it('accepts receiving fewer units than were approved', () => {
    expect(dispositionProblem(future, { ...empty, restockQuantity: 1 })).toBeNull();
  });

  it('refuses more units than were approved', () => {
    expect(
      dispositionProblem(future, { ...empty, restockQuantity: 4, quarantinedQuantity: 2 }),
    ).toContain('Only 5 unit(s) were approved');
  });

  it('refuses to restock an expired batch but allows writing it off', () => {
    expect(dispositionProblem(past, { ...empty, restockQuantity: 1 })).toContain(
      'expired and cannot be restocked',
    );
    expect(dispositionProblem(past, { ...empty, expiredQuantity: 5 })).toBeNull();
  });
});

describe('status labels', () => {
  it('reads a received return as awaiting credit rather than the raw status', () => {
    expect(returnStatusLabel('RECEIVED')).toBe('Awaiting credit');
    expect(returnStatusLabel('PARTIALLY_APPROVED')).toBe('Partly approved');
  });

  it('falls back to a readable form for an unknown status', () => {
    expect(returnStatusLabel('SOMETHING_NEW')).toBe('SOMETHING NEW');
  });
});
