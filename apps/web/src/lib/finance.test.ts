import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMAT_SETTINGS,
  formatDate,
  formatDateTime,
  formatMoneyMinor,
  formatPercentFromBasisPoints,
  formatQuantity,
  parseMoney,
  toDateInputValue,
  toDateTimeInputValue,
  toMoneyInputValue,
} from '@medsupply/utilities';
import { formatFinanceDate, formatMinor, parseMajorToMinor } from './finance';

describe('finance helpers', () => {
  it('parses BDT values into integer poisha without floating-point arithmetic', () => {
    expect(parseMajorToMinor('0.01')).toBe(1);
    expect(parseMajorToMinor('1,234.56')).toBe(123456);
    expect(parseMajorToMinor('90071992547409.91')).toBe(9007199254740991);
  });

  it('rejects ambiguous, over-precise and unsafe money input', () => {
    expect(() => parseMajorToMinor('-1.00')).toThrow();
    expect(() => parseMajorToMinor('1.001')).toThrow();
    expect(() => parseMajorToMinor('12,34.00')).toThrow();
    expect(() => parseMajorToMinor('1e3')).toThrow();
    expect(() => parseMajorToMinor('90071992547409.92')).toThrow('too large');
  });

  it('formats integer poisha and Dhaka dates consistently', () => {
    expect(formatMinor(123456)).toBe('৳1,234.56');
    expect(formatMinor(-25)).toBe('-৳0.25');
    expect(formatFinanceDate('2026-07-28T19:30:00.000Z')).toBe('29 Jul 2026');
  });
});

describe('shared money formatting', () => {
  // These are the exact strings the previous inline formatters got wrong. Each
  // was rendered by at least one screen before the formatters were unified.
  it('groups thousands, which eighteen call sites did not', () => {
    expect(formatMoneyMinor(1250000)).toBe('৳12,500.00'); // was ৳1250000.00
    expect(formatMoneyMinor(123456789)).toBe('৳1,234,567.89');
  });

  it('keeps both minor digits, which toLocaleString() dropped', () => {
    expect(formatMoneyMinor(100000)).toBe('৳1,000.00'); // was ৳1,000
    expect(formatMoneyMinor(123450)).toBe('৳1,234.50'); // was ৳1,234.5
  });

  it('stays exact at the top of the safe integer range', () => {
    // (minor / 100).toFixed(2) loses precision here; integer arithmetic does not.
    expect(formatMoneyMinor(9007199254740991)).toBe('৳90,071,992,547,409.91');
  });

  it('renders a missing or corrupt amount as a dash rather than a number', () => {
    expect(formatMoneyMinor(null)).toBe('—');
    expect(formatMoneyMinor(undefined)).toBe('—');
    expect(formatMoneyMinor(1.5)).toBe('—');
    expect(formatMoneyMinor(Number.NaN)).toBe('—');
  });

  it('honours a tenant that configures a different currency symbol', () => {
    expect(formatMoneyMinor(123456, { ...DEFAULT_FORMAT_SETTINGS, currencySymbol: 'Tk' })).toBe(
      'Tk1,234.56',
    );
  });

  it('distinguishes a malformed amount from one that is too large', () => {
    expect(parseMoney('1.001')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseMoney('90071992547409.92')).toEqual({ ok: false, reason: 'too-large' });
    expect(parseMoney('12,500.50')).toEqual({ ok: true, minor: 1250050 });
  });

  it('round-trips a prefilled amount field through the parser', () => {
    for (const minor of [1, 99, 100, 123456, 9007199254740991]) {
      expect(parseMoney(toMoneyInputValue(minor))).toEqual({ ok: true, minor });
    }
  });

  it('formats quantities and basis points', () => {
    expect(formatQuantity(1234567)).toBe('1,234,567');
    expect(formatPercentFromBasisPoints(1234)).toBe('12.34%');
    expect(formatPercentFromBasisPoints(10_000)).toBe('100.00%');
  });
});

describe('date formatting is anchored to the business time zone', () => {
  // 20:30 UTC on the 2nd is 02:30 on the 3rd in Dhaka. Every assertion below
  // must say the 3rd. Forty-one call sites used to omit the time zone and would
  // have said the 2nd anywhere west of Dhaka -- invisible on a machine that is
  // itself in Dhaka, which is where this was written.
  const instant = '2026-08-02T20:30:00.000Z';

  it('reports the Dhaka calendar day, not the host one', () => {
    expect(formatDate(instant)).toBe('03 Aug 2026');
    expect(formatDateTime(instant)).toMatch(/^03 Aug 2026/);
    expect(toDateInputValue(instant)).toBe('2026-08-03');
  });

  it('does not follow the host when the host is elsewhere', () => {
    // Formatting the same instant against a genuinely different zone must move
    // the day, which proves the zone is applied rather than ignored.
    const utc = { ...DEFAULT_FORMAT_SETTINGS, timeZone: 'UTC' };
    expect(formatDate(instant, utc)).toBe('02 Aug 2026');
    expect(toDateInputValue(instant, utc)).toBe('2026-08-02');
    expect(formatDate(instant)).toBe('03 Aug 2026');
  });

  it('defaults to Asia/Dhaka', () => {
    expect(DEFAULT_FORMAT_SETTINGS.timeZone).toBe('Asia/Dhaka');
  });

  it('renders a missing or unparseable date as a dash', () => {
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('not a date')).toBe('—');
    expect(formatDateTime(null)).toBe('—');
    expect(toDateInputValue(undefined)).toBe('');
  });

  it('fills a datetime-local input with Dhaka wall-clock time', () => {
    // `RecordPayment` hand-rolled this as `Date.now() + 6h` sliced to 16
    // characters. Correct for Bangladesh today, and a constant that had already
    // started being copied to other screens.
    expect(toDateTimeInputValue(instant)).toBe('2026-08-03T02:30');
    expect(toDateTimeInputValue(instant, { ...DEFAULT_FORMAT_SETTINGS, timeZone: 'UTC' })).toBe(
      '2026-08-02T20:30',
    );
    expect(toDateTimeInputValue(undefined)).toBe('');
  });

  it('renders midnight as 00 rather than 24', () => {
    // 18:00 UTC is exactly midnight in Dhaka, and `en-CA` reports hour 24 for
    // it in some engines, which a datetime-local input rejects outright.
    expect(toDateTimeInputValue('2026-08-02T18:00:00.000Z')).toBe('2026-08-03T00:00');
  });
});
