import { describe, expect, it, vi } from 'vitest';

// The API client pulls in react-native, whose Flow sources the test bundler
// cannot parse. Only the pure display helpers are exercised here.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

import { formatValue, SOURCE_LABELS, toRows } from './api';

describe('settings display helpers', () => {
  it('renders every value type the way an operator reads it', () => {
    expect(formatValue(true)).toBe('Enabled');
    expect(formatValue(false)).toBe('Disabled');
    expect(formatValue(90)).toBe('90');
    expect(formatValue(0)).toBe('0');
    expect(formatValue('Asia/Dhaka')).toBe('Asia/Dhaka');
    expect(formatValue(['OTP', 'SIGNATURE'])).toBe('OTP, SIGNATURE');
    expect(formatValue([])).toBe('None');
  });

  it('distinguishes an unset optional field from an empty collection', () => {
    expect(formatValue('')).toBe('Not set');
    expect(formatValue(undefined)).toBe('Not set');
    expect(formatValue(null)).toBe('Not set');
  });

  it('renders quiet hours as a readable window rather than raw JSON', () => {
    expect(formatValue({ enabled: true, start: '22:00', end: '07:00' })).toBe('22:00 to 07:00');
    expect(formatValue({ enabled: false, start: '22:00', end: '07:00' })).toBe('Disabled');
  });

  it('labels known fields and falls back to the raw key for unknown ones', () => {
    const rows = toRows({
      nearExpiryDays: 45,
      lowStockThreshold: 5,
      somethingAddedLater: 'value',
    });
    expect(rows).toEqual([
      { label: 'Near-expiry window (days)', value: '45' },
      { label: 'Low-stock threshold', value: '5' },
      // An unmapped field still renders instead of silently disappearing.
      { label: 'somethingAddedLater', value: 'value' },
    ]);
  });

  it('explains where each group of values comes from', () => {
    expect(SOURCE_LABELS.PERSISTED).toBe('Saved in system settings');
    expect(SOURCE_LABELS.ENVIRONMENT).toBe('From the deployment environment');
    expect(SOURCE_LABELS.DEFAULT).toBe('Built-in default');
  });
});
