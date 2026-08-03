import { describe, expect, it } from 'vitest';
import { formatFinanceDate, formatFinanceDateTime } from './date';
import { formatMoneyMinor, parseMoneyToMinor } from './money';

describe('ledger-safe mobile money helpers', () => {
  it('parses decimal text without floating-point arithmetic', () => {
    expect(parseMoneyToMinor('0.01')).toBe(1);
    expect(parseMoneyToMinor('0.10')).toBe(10);
    expect(parseMoneyToMinor('1,234.56')).toBe(123456);
    expect(parseMoneyToMinor('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects ambiguous, negative, over-precision, and unsafe values', () => {
    expect(parseMoneyToMinor('1.001')).toBeNull();
    expect(parseMoneyToMinor('1,2,3.00')).toBeNull();
    expect(parseMoneyToMinor('-1')).toBeNull();
    expect(parseMoneyToMinor('not money')).toBeNull();
    expect(parseMoneyToMinor('90071992547409.92')).toBeNull();
  });

  it('formats positive and signed ledger values in BDT', () => {
    expect(formatMoneyMinor(123456)).toBe('৳1,234.56');
    expect(formatMoneyMinor(-50)).toBe('-৳0.50');
  });

  // The same assertions run in apps/web/src/lib/finance.test.ts. Both suites
  // exist because the point is that the two apps agree: this app rendered a
  // ৳12,500 medicine price as `৳12500.00` while the web app rendered
  // `৳12,500.00`, from the same field of the same API response. They now share
  // one implementation, and these strings are what would change if a local
  // formatter were ever reintroduced here.
  it('renders the canonical strings the web app renders', () => {
    expect(formatMoneyMinor(1250000)).toBe('৳12,500.00');
    expect(formatMoneyMinor(100000)).toBe('৳1,000.00');
    expect(formatMoneyMinor(123450)).toBe('৳1,234.50');
    expect(formatMoneyMinor(9007199254740991)).toBe('৳90,071,992,547,409.91');
    expect(formatMoneyMinor(null)).toBe('—');
  });

  it('anchors dates to Dhaka rather than the device', () => {
    // 20:30 UTC on the 2nd is 02:30 on the 3rd in Dhaka. A phone set to any
    // zone west of Dhaka would have said the 2nd.
    expect(formatFinanceDate('2026-08-02T20:30:00.000Z')).toBe('03 Aug 2026');
    expect(formatFinanceDateTime('2026-08-02T20:30:00.000Z')).toMatch(/^03 Aug 2026/);
    expect(formatFinanceDate(undefined)).toBe('—');
  });
});
