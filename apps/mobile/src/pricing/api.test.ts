import { describe, expect, it, vi } from 'vitest';
import { catalogueKeys, en } from '@medsupply/i18n';

// Reaches the API client, and through it `react-native`, whose Flow-typed
// source the runner cannot parse. Same mock as `orders/quote.test.ts`.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

const { priceProblem, toMinor, toTaka, withLine } = await import('./api');

/**
 * Money typed by a person, on a phone, into the integer minor units every
 * other figure in this product is stored as.
 *
 * `AGENTS.md`: never floating point for a financial calculation. The conversion
 * happens **once, here**, rather than at each of the places that would
 * otherwise each round differently.
 */
describe('a price typed in taka', () => {
  it('becomes whole poisha', () => {
    expect(toMinor('120')).toBe(12_000);
    expect(toMinor(' 12.50 ')).toBe(1_250);
    expect(toMinor('0')).toBe(0);
  });

  it('rounds rather than truncating, and survives binary floating point', () => {
    /*
     * `12.005 * 100` is 1200.4999999999998 in IEEE 754. Truncation loses the
     * paisa; rounding keeps it. Small, and it is the shape of error that turns
     * into a reconciliation nobody can close.
     */
    expect(toMinor('12.005')).toBe(1_201);
    expect(toMinor('0.1')).toBe(10);
    expect(toMinor('1.1')).toBe(110);
    expect(toMinor('8.29')).toBe(829);
  });

  it('goes back to taka for a field somebody is about to edit', () => {
    expect(toTaka(1_250)).toBe('12.50');
    expect(toTaka(0)).toBe('0.00');
    // A round trip changes nothing, which is what makes editing one line safe.
    expect(toMinor(toTaka(12_345))).toBe(12_345);
  });
});

describe('what is wrong with a typed price', () => {
  it('allows nothing to be charged, because that is a real arrangement', () => {
    /*
     * A sample or a replacement is priced at zero. Refusing it pushes somebody
     * into deleting the line instead — and a deleted line means the customer
     * falls back to the default list at full price, which is the opposite of
     * what they meant.
     */
    expect(priceProblem('0')).toBeNull();
    expect(priceProblem('12.50')).toBeNull();
  });

  it('refuses an empty field and a negative price', () => {
    expect(priceProblem('')).toBe('priceLists.priceRequired');
    expect(priceProblem('   ')).toBe('priceLists.priceRequired');
    expect(priceProblem('abc')).toBe('priceLists.priceRequired');
    expect(priceProblem('-5')).toBe('priceLists.priceRequired');
  });

  it('stops a figure that would stop being an exact integer', () => {
    expect(priceProblem('99999999')).toBeNull();
    expect(priceProblem('999999999999999')).toBe('priceLists.priceTooLarge');
  });
});

/**
 * `PATCH /pricing/price-lists/{id}` replaces the **whole** set of lines, so
 * changing one price means sending back everything that was read plus the
 * change. Getting this wrong replaces a two-hundred-line list with one line,
 * and every customer on it silently falls back to default pricing.
 */
describe('changing one line of a price list', () => {
  const lines = [
    { medicineId: 'a', unitPriceMinor: 100, discountPercent: 0 },
    { medicineId: 'b', unitPriceMinor: 200, discountPercent: 5 },
  ];

  it('keeps every other line exactly as it was', () => {
    const next = withLine(lines, 'a', { unitPriceMinor: 150 });
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({ medicineId: 'a', unitPriceMinor: 150, discountPercent: 0 });
    expect(next[1]).toEqual(lines[1]);
  });

  it('adds a medicine the list did not price before', () => {
    const next = withLine(lines, 'c', { unitPriceMinor: 300 });
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ medicineId: 'c', unitPriceMinor: 300, discountPercent: 0 });
  });

  it('changes nothing it was not asked to', () => {
    const next = withLine(lines, 'b', { discountPercent: 10 });
    // The price is untouched: a discount change is not a price change.
    expect(next[1]).toEqual({ medicineId: 'b', unitPriceMinor: 200, discountPercent: 10 });
  });

  it('does not mutate what it was given', () => {
    // The screen holds the loaded list in state, and a helper that mutated it
    // would make the "unsaved changes" comparison always say no.
    const original = structuredClone(lines);
    withLine(lines, 'a', { unitPriceMinor: 999 });
    expect(lines).toEqual(original);
  });
});

describe('every problem this module reports can be said out loud', () => {
  const KNOWN = new Set(catalogueKeys(en));

  it.each(['priceLists.priceRequired', 'priceLists.priceTooLarge'])(
    '%s is in the catalogue',
    (key) => {
      expect(KNOWN.has(key)).toBe(true);
    },
  );
});
