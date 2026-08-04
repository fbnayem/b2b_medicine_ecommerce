import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoneyMinor } from '@medsupply/utilities';
import { documentFormatSettings } from './localisation';

/**
 * An issued document says what it said.
 *
 * `currencyCode` and `currencySymbol` are administrable settings. Rendering a
 * document through the live values means a PDF regenerated next year carries a
 * different symbol — or, if the exponent moves, a different *amount* — from the
 * paper the customer signed for and the auditor is holding.
 *
 * The same principle as `medicineSnapshot` and the business-identity snapshot,
 * applied to the one field that decides what the numbers mean.
 */

test('a document renders in the currency it recorded, not the one configured now', () => {
  // 1,250,000 minor units. Two exponents, two entirely different amounts.
  const taka = documentFormatSettings({ code: 'BDT', symbol: '৳', exponent: 2 });
  const yen = documentFormatSettings({ code: 'JPY', symbol: '¥', exponent: 0 });

  assert.equal(formatMoneyMinor(1_250_000, taka), '৳12,500.00');
  assert.equal(
    formatMoneyMinor(1_250_000, yen),
    '¥1,250,000',
    'JPY has no minor unit, so the same integer is a hundredfold different amount — ' +
      'which is why the exponent cannot be read from a later configuration',
  );
});

test('the business’s own symbol wins over the currency’s default', () => {
  // A deployment that writes `Tk` rather than `৳` means it, and the document
  // should say what the business says.
  const settings = documentFormatSettings({ code: 'BDT', symbol: 'Tk', exponent: 2 });
  assert.equal(formatMoneyMinor(1_250_000, settings), 'Tk12,500.00');
});

test('a document issued before the snapshot existed renders as it always did', () => {
  // Every invoice already in the database has no snapshot. Falling back to the
  // live settings is not a compromise: it is exactly what those documents were
  // rendered with, so nothing changes for them.
  const before = formatMoneyMinor(1_250_000);
  assert.equal(formatMoneyMinor(1_250_000, documentFormatSettings(undefined)), before);
  assert.equal(formatMoneyMinor(1_250_000, documentFormatSettings(null)), before);
  assert.equal(formatMoneyMinor(1_250_000, documentFormatSettings({})), before);
});

test('a snapshot with no symbol still renders, using the live one', () => {
  // Partial data is possible from an interrupted write or an older shape, and
  // a document that renders nothing is worse than one that renders the symbol
  // it would have had anyway.
  const settings = documentFormatSettings({ code: 'BDT' });
  assert.match(formatMoneyMinor(1_250_000, settings), /12,500\.00$/);
});
