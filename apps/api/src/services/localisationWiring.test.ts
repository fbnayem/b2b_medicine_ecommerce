import test from 'node:test';
import assert from 'node:assert/strict';
import type { LocalisationSettings } from '@medsupply/shared-types';
import { formatDate, formatMoneyMinor, resetFormatting } from '@medsupply/utilities';
import {
  applyFormatting,
  businessFiscalYear,
  businessTimeZone,
  countryPack,
  referenceYear,
  resetAppliedFormatting,
} from './localisation';

/**
 * The server renders what the tenant configured.
 *
 * `configureFormatting` was called from one place in the whole repository — the
 * web client's `useBranding` — so the API produced every invoice PDF, CSV
 * export and server-side date with the package defaults. A deployment could set
 * its currency symbol, watch the screens change, and still receive documents
 * printed in taka on the Dhaka calendar.
 *
 * These assertions are behavioural on purpose. A test that the wiring *exists*
 * passes the moment somebody imports the function; only formatting an amount
 * afterwards shows that it arrived.
 */

const localisation = (overrides: Partial<LocalisationSettings> = {}): LocalisationSettings => ({
  timezone: 'Asia/Dhaka',
  locale: 'en',
  dateFormat: 'DD MMM YYYY',
  currencyCode: 'BDT',
  currencySymbol: '৳',
  ...overrides,
});

/** Each case starts from the package defaults rather than the last one's state. */
function fresh() {
  resetFormatting();
  resetAppliedFormatting();
}

test('applying tenant settings changes what the server renders', () => {
  fresh();
  // 20:30 UTC on the 2nd is already the 3rd in Dhaka and still the 2nd in Berlin.
  const instant = '2026-08-02T20:30:00.000Z';
  assert.equal(formatMoneyMinor(123456789), '৳1,234,567.89');
  assert.equal(formatDate(instant), '03 Aug 2026');

  applyFormatting(
    localisation({
      timezone: 'Europe/Berlin',
      currencyCode: 'EUR',
      currencySymbol: '€',
      dateFormat: 'DD/MM/YYYY',
    }),
  );

  assert.equal(formatMoneyMinor(123456789), '1.234.567,89 €');
  assert.equal(formatDate(instant), '02/08/2026');
});

test('a currency this build cannot resolve fails loudly rather than at an assumed exponent', () => {
  fresh();
  /*
   * Defaulting to two minor digits would render every yen amount at a hundredth
   * of its value, and nothing on screen would look wrong. The code is validated
   * as three characters by the settings schema, which cannot know whether the
   * build carries it.
   */
  assert.throws(() => applyFormatting(localisation({ currencyCode: 'ZZZ' })), /Unknown currency/);
  // The formatter state is untouched, so a bad save cannot half-apply.
  assert.equal(formatMoneyMinor(123456789), '৳1,234,567.89');
});

test('the business calendar comes from the pack, not from the display setting', () => {
  fresh();
  /*
   * `docs/ASSUMPTIONS.md` pinned finance day boundaries to Asia/Dhaka on the
   * grounds that moving them "would change which period a posted transaction
   * belongs to, which is a finance-calendar decision rather than a display
   * setting". That reasoning is kept: changing the display zone must not move
   * the books. All that changed is where the answer comes from.
   */
  applyFormatting(localisation({ timezone: 'Europe/Berlin' }));
  assert.equal(businessTimeZone(), 'Asia/Dhaka');
  assert.equal(businessTimeZone(), countryPack().timeZone);
});

test('a reference is stamped with the year in the business zone, not the UTC one', () => {
  fresh();
  // 19:00 UTC on 31 December is already 01:00 on 1 January in Dhaka. A document
  // issued then must not carry the previous year.
  const justAfterMidnightInDhaka = '2025-12-31T19:00:00.000Z';
  assert.equal(new Date(justAfterMidnightInDhaka).getUTCFullYear(), 2025);
  assert.equal(referenceYear(justAfterMidnightInDhaka), 2026);
  // Bangladesh numbers on the calendar year, so August is 2026 and not the
  // financial year that opened in July.
  assert.equal(referenceYear('2026-08-02T20:30:00.000Z'), 2026);
  assert.equal(businessFiscalYear('2027-03-02T20:30:00.000Z'), 2026);
});

test('reapplying the same settings is a no-op, since this runs on a hot path', () => {
  fresh();
  const settings = localisation({ currencyCode: 'INR', currencySymbol: '₹' });
  applyFormatting(settings);
  applyFormatting(settings);
  // Indian grouping, which is also the proof the pack's currency data is in use.
  assert.equal(formatMoneyMinor(123456789), '₹12,34,567.89');
});
