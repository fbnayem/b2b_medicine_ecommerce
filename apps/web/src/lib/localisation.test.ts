import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMAT_SETTINGS,
  formatDate,
  formatDateTime,
  formatMoneyMinor,
  formatQuantity,
  parseMoney,
  toMoneyInputValue,
  type FormatSettings,
} from '@medsupply/utilities';
import { CURRENCIES, currencyFor, packFor } from '@medsupply/jurisdictions';

/**
 * The localisation surface existed and was not connected.
 *
 * `currencyCode` and `dateFormat` were persisted, validated, returned by
 * `/settings/branding` and rendered in the settings screen — and read by no
 * formatter. Choosing `YYYY-MM-DD` changed nothing on any screen, and the minor
 * unit was hard-coded at two everywhere, which is a hundredfold error in yen
 * and a tenfold one in dinar.
 *
 * These assertions all fail against the previous implementation by
 * construction. The BDT ones are the opposite: they must keep passing, because
 * the seam is only worth trusting if lifting the existing behaviour into it
 * changed nothing.
 */

const settings = (overrides: Partial<FormatSettings>): FormatSettings => ({
  ...DEFAULT_FORMAT_SETTINGS,
  ...overrides,
});

/** An empty symbol means "use the currency's own", rather than rendering nothing. */
const inCurrency = (currencyCode: string) => settings({ currencyCode, currencySymbol: '' });

describe('the configured date pattern reaches the output', () => {
  // 20:30 UTC on the 2nd is 02:30 on the 3rd in Dhaka, so every assertion says
  // the 3rd. That also keeps these tests honest about the time zone.
  const instant = '2026-08-02T20:30:00.000Z';

  it('renders each of the three patterns differently', () => {
    expect(formatDate(instant, settings({ dateFormat: 'DD MMM YYYY' }))).toBe('03 Aug 2026');
    expect(formatDate(instant, settings({ dateFormat: 'DD/MM/YYYY' }))).toBe('03/08/2026');
    expect(formatDate(instant, settings({ dateFormat: 'YYYY-MM-DD' }))).toBe('2026-08-03');
  });

  it('keeps the pattern when a time is appended', () => {
    expect(formatDateTime(instant, settings({ dateFormat: 'YYYY-MM-DD' }))).toBe(
      '2026-08-03, 02:30 am',
    );
  });

  it('defaults to the pattern AGENTS.md requires', () => {
    expect(DEFAULT_FORMAT_SETTINGS.dateFormat).toBe('DD MMM YYYY');
    expect(formatDate(instant)).toBe('03 Aug 2026');
  });

  it('translates the month but never the digits', () => {
    /*
     * `Intl` under `bn` renders this as `০৩ আগ, ২০২৬`. Money and quantities are
     * reconciled against printed invoices and bank slips in Western digits, and
     * both money parsers accept only `[0-9]`, so a Bengali-digit date is a
     * figure nobody can type back in. This was dormant until the server began
     * applying tenant settings — nothing passed the locale through before.
     */
    const bangla = formatDate(instant, settings({ locale: 'bn' }));
    expect(bangla).toMatch(/^03 \S+ 2026$/);
    expect(bangla).not.toMatch(/[০-৯]/);
    // The month really is translated, so this is not just English in disguise.
    expect(bangla).not.toBe('03 Aug 2026');
  });
});

describe('money is rendered in the configured currency', () => {
  it('still renders BDT exactly as before', () => {
    expect(formatMoneyMinor(1250000)).toBe('৳12,500.00');
    expect(formatMoneyMinor(123456789)).toBe('৳1,234,567.89');
    expect(formatMoneyMinor(-25)).toBe('-৳0.25');
    expect(formatMoneyMinor(9007199254740991)).toBe('৳90,071,992,547,409.91');
  });

  it('honours a currency with no minor unit', () => {
    // 1000 yen is stored as 1000, not 100000. Dividing by 100 renders it as
    // ten yen -- the same integer, off by a factor of a hundred.
    expect(formatMoneyMinor(1000, inCurrency('JPY'))).toBe('¥1,000');
    expect(formatMoneyMinor(1000, inCurrency('BDT'))).toBe('৳10.00');
  });

  it('honours a currency with three minor digits', () => {
    // 1234567 fils is 1,234.567 dinar.
    expect(formatMoneyMinor(1234567, inCurrency('KWD'))).toBe('د.ك1,234.567');
  });

  it('groups the Indian way, which the old regex could not express at all', () => {
    // A lakh is written 1,00,000 -- three digits then twos.
    expect(formatMoneyMinor(123456789, inCurrency('INR'))).toBe('₹12,34,567.89');
    expect(formatMoneyMinor(10000000, inCurrency('INR'))).toBe('₹1,00,000.00');
  });

  it('puts the symbol after the amount and swaps the separators for the euro', () => {
    expect(formatMoneyMinor(123456789, inCurrency('EUR'))).toBe('1.234.567,89 €');
    expect(formatMoneyMinor(-25, inCurrency('EUR'))).toBe('-0,25 €');
  });

  it('lets a tenant override the symbol without changing the currency', () => {
    expect(formatMoneyMinor(123456, settings({ currencySymbol: 'Tk' }))).toBe('Tk1,234.56');
  });

  it('groups quantities the same way money is grouped', () => {
    expect(formatQuantity(1234567)).toBe('1,234,567');
    expect(formatQuantity(1234567, inCurrency('INR'))).toBe('12,34,567');
  });
});

describe('typed amounts are parsed in the configured currency', () => {
  it('still rejects the grouping typo it always rejected', () => {
    expect(parseMoney('1,234.56')).toEqual({ ok: true, minor: 123456 });
    expect(parseMoney('12,34.00')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseMoney('-1.00')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseMoney('1.001')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseMoney('1e3')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseMoney('90071992547409.92')).toEqual({ ok: false, reason: 'too-large' });
  });

  it('accepts Indian grouping under INR and rejects it under BDT', () => {
    // The same string is correct in one currency and a typo in the other, which
    // is exactly why the parser validates by re-rendering rather than by a
    // fixed pattern.
    expect(parseMoney('12,34,567.89', inCurrency('INR'))).toEqual({ ok: true, minor: 123456789 });
    expect(parseMoney('12,34,567.89', inCurrency('BDT'))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('reads the European form, where the separators are the other way round', () => {
    expect(parseMoney('1.234.567,89', inCurrency('EUR'))).toEqual({ ok: true, minor: 123456789 });
    // `.` is the group separator here, so this is 1234567 whole units, not a decimal.
    expect(parseMoney('1.234,5', inCurrency('EUR'))).toEqual({ ok: true, minor: 123450 });
  });

  it('refuses a decimal part in a currency that has no minor unit', () => {
    expect(parseMoney('1000', inCurrency('JPY'))).toEqual({ ok: true, minor: 1000 });
    expect(parseMoney('1000.50', inCurrency('JPY'))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('round-trips a prefilled field through the parser in every currency', () => {
    for (const code of Object.keys(CURRENCIES)) {
      const where = inCurrency(code);
      for (const minor of [1, 99, 100, 123456, 9007199254740991]) {
        expect(parseMoney(toMoneyInputValue(minor, where), where)).toEqual({ ok: true, minor });
      }
    }
  });
});

describe('an unknown currency fails loudly rather than guessing', () => {
  it('throws instead of assuming two minor digits', () => {
    // Silently defaulting to an exponent of two is how a deployment renders
    // every amount in the wrong scale without anyone noticing.
    expect(() => currencyFor('XYZ')).toThrow(/Unknown currency/);
    expect(() => formatMoneyMinor(100, inCurrency('XYZ'))).toThrow(/Unknown currency/);
  });
});

describe('the Bangladesh pack transcribes what the system already did', () => {
  it('carries the values the code had hard-coded', () => {
    const bd = packFor('BD');
    expect(bd.timeZone).toBe(DEFAULT_FORMAT_SETTINGS.timeZone);
    expect(bd.currencyCode).toBe(DEFAULT_FORMAT_SETTINGS.currencyCode);
    // `reportPeriod.ts` buckets weeks with `startOfWeek: 'saturday'`.
    expect(bd.weekStartsOn).toBe('saturday');
    expect(bd.weekend).toEqual(['friday', 'saturday']);
    expect(bd.fiscalYearStartMonth).toBe(7);
  });

  it('refuses a country it does not carry', () => {
    expect(() => packFor('ZZ')).toThrow(/No country pack/);
  });
});
