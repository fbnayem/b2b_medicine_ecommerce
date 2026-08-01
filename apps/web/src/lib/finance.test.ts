import { describe, expect, it } from 'vitest';
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
