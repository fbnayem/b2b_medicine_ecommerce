import { describe, expect, it } from 'vitest';
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
});
