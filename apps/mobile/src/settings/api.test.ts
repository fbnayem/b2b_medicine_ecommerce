import { describe, expect, it, vi } from 'vitest';

// The API client pulls in react-native, whose Flow sources the test bundler
// cannot parse. Only the pure display helpers are exercised here.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

import { translatorFor } from '@medsupply/i18n';
import { formatValue, groupLabel, sourceLabel, toRows } from './api';

const t = translatorFor('en');

describe('settings display helpers', () => {
  it('renders every value type the way an operator reads it', () => {
    expect(formatValue(t, true)).toBe('On');
    expect(formatValue(t, false)).toBe('Off');
    expect(formatValue(t, 90)).toBe('90');
    expect(formatValue(t, 0)).toBe('0');
    expect(formatValue(t, 'Asia/Dhaka')).toBe('Asia/Dhaka');
    expect(formatValue(t, ['OTP', 'SIGNATURE'])).toBe('OTP, SIGNATURE');
    expect(formatValue(t, [])).toBe('None');
  });

  it('distinguishes an unset optional field from an empty collection', () => {
    expect(formatValue(t, '')).toBe('Not set');
    expect(formatValue(t, undefined)).toBe('Not set');
    expect(formatValue(t, null)).toBe('Not set');
  });

  it('renders quiet hours as a readable window rather than raw JSON', () => {
    expect(formatValue(t, { enabled: true, start: '22:00', end: '07:00' })).toBe('22:00 to 07:00');
    expect(formatValue(t, { enabled: false, start: '22:00', end: '07:00' })).toBe('Off');
  });

  it('labels known fields and falls back to the raw key for unknown ones', () => {
    const rows = toRows(t, {
      nearExpiryDays: 45,
      lowStockThreshold: 5,
      somethingAddedLater: 'value',
    });
    expect(rows).toEqual([
      { label: 'Days before expiry that counts as close', value: '45' },
      { label: 'Units left that counts as running low', value: '5' },
      // An unmapped field still renders instead of silently disappearing, and
      // it shows the key rather than the dotted catalogue path it missed.
      { label: 'somethingAddedLater', value: 'value' },
    ]);
  });

  it('says nothing an operator has to be technical to read', () => {
    // These two labels lived in this module in English and said things
    // `AGENTS.md` bans outright: "Overdue block threshold (poisha)" and
    // "Tax (basis points)".
    const rows = toRows(t, { taxBasisPoints: 750, creditBlockOverdueThresholdMinor: 500000 });
    expect(rows.map((row) => row.label)).toEqual([
      'Tax rate, in hundredths of a percent (750 = 7.50%)',
      'Refuse orders once this much is overdue',
    ]);
  });

  it('explains where each group of values comes from', () => {
    expect(sourceLabel(t, 'PERSISTED')).toBe('Saved here');
    expect(sourceLabel(t, 'ENVIRONMENT')).toBe('From the environment');
    expect(sourceLabel(t, 'DEFAULT')).toBe('Built-in default');
    // A source this build has no words for shows the raw value, not a path.
    expect(sourceLabel(t, 'SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('reads in Bangla, which is the whole point of moving these out of here', () => {
    const bn = translatorFor('bn');
    expect(formatValue(bn, true)).toBe('চালু');
    expect(formatValue(bn, null)).toBe('সেট করা নেই');
    expect(groupLabel(bn, 'finance')).toBe('টাকা ও ক্রেডিট');
  });
});
