import { describe, expect, it, vi } from 'vitest';
import { catalogueKeys, en } from '@medsupply/i18n';

// `stocktakes.ts` reaches the API client, and through it `react-native`, whose
// Flow-typed source the runner cannot parse. Same mock as `orders/quote.test.ts`.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

const { countProblem, progress, showsExpected, uncounted } = await import('./stocktakes');

/**
 * What somebody typed into a count field, on a phone, in an aisle.
 *
 * **Zero is a real answer.** "There are none on that shelf" is precisely the
 * finding a physical count exists to make, and it is why `countedQuantity` is
 * `null` until counted rather than starting at 0 — the two mean different
 * things and a field that conflates them makes an uncounted rack look counted.
 */
describe('what is wrong with a typed count', () => {
  it('accepts a nought, because none is a finding', () => {
    expect(countProblem('0')).toBeNull();
    expect(countProblem('14')).toBeNull();
    expect(countProblem('  7 ')).toBeNull();
  });

  it('asks for a number when the field is empty', () => {
    // Distinct from zero, and the distinction is the whole point.
    expect(countProblem('')).toBe('stocktake.countRequired');
    expect(countProblem('   ')).toBe('stocktake.countRequired');
    expect(countProblem('abc')).toBe('stocktake.countRequired');
    expect(countProblem('-3')).toBe('stocktake.countRequired');
  });

  it('refuses half a box', () => {
    expect(countProblem('3.5')).toBe('stocktake.wholeUnitsOnly');
  });

  it('stops a finger resting on a key before an hour of counting is refused', () => {
    expect(countProblem('999999')).toBeNull();
    expect(countProblem('1000001')).toBe('stocktake.countTooLarge');
  });
});

/**
 * The rule the whole mechanism rests on. The server strips `systemQuantity`
 * from every line while a sheet is open — a blind count that ships the answer
 * in the response is not blind — and this is the screen agreeing with it.
 */
describe('whether the sheet may show what was expected', () => {
  it('hides it while counting', () => {
    expect(showsExpected({ status: 'COUNTING' })).toBe(false);
  });

  it('shows it once counting has finished', () => {
    expect(showsExpected({ status: 'REVIEW' })).toBe(true);
    expect(showsExpected({ status: 'POSTED' })).toBe(true);
  });

  it('hides it on a sheet that was abandoned', () => {
    // Nothing was posted, so there is no variance to look at and no reason to
    // reveal a figure the count never earned.
    expect(showsExpected({ status: 'ABANDONED' })).toBe(false);
  });
});

describe('how far a count has got', () => {
  const line = (countedQuantity: number | null) =>
    ({ countedQuantity }) as { countedQuantity: number | null };

  it('counts a nought as counted', () => {
    /*
     * The arithmetic that would be wrong if zero and uncounted were conflated:
     * a rack counted as empty is done, and a progress bar saying otherwise
     * sends somebody back to count it again.
     */
    const lines = [line(0), line(4), line(null)] as never;
    expect(progress(lines)).toEqual({ counted: 2, total: 3 });
    expect(uncounted(lines)).toHaveLength(1);
  });

  it('reports nothing counted on a fresh sheet, and everything on a full one', () => {
    expect(progress([line(null), line(null)] as never)).toEqual({ counted: 0, total: 2 });
    expect(progress([line(1), line(2)] as never)).toEqual({ counted: 2, total: 2 });
    expect(progress([])).toEqual({ counted: 0, total: 0 });
  });
});

/**
 * `catalogueKeys.test.ts` reads literal `t('…')` call sites, and every problem
 * above reaches the screen through a variable. Without this a misspelt key
 * ships as its own dotted path, printed to a storekeeper in place of the
 * sentence telling them what to type.
 */
describe('every problem this module reports can be said out loud', () => {
  const KNOWN = new Set(catalogueKeys(en));

  it.each(['stocktake.countRequired', 'stocktake.wholeUnitsOnly', 'stocktake.countTooLarge'])(
    '%s is in the catalogue',
    (key) => {
      expect(KNOWN.has(key)).toBe(true);
    },
  );
});
