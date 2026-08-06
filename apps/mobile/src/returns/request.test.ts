import { describe, expect, it, vi } from 'vitest';
import { ReturnReason } from '@medsupply/shared-types';
import { catalogueKeys, en } from '@medsupply/i18n';

// `request.ts` reaches the API client, and through it `react-native`, whose
// Flow-typed source esbuild cannot parse. Same mock as `orders/quote.test.ts`.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

const { estimateMinor, lineKey, returnProblem, seedDraft, selectedLines } =
  await import('./request');
type InvoiceLine = import('./request').InvoiceLine;
type ReturnDraft = import('./request').ReturnDraft;

const KNOWN = new Set(catalogueKeys(en));

/**
 * The rules a pharmacy meets while standing over an opened carton.
 *
 * Every one of them is also enforced by `CreateReturnSchema`. They are checked
 * here as well because the alternative is a round trip on a shop's connection
 * that ends with the whole form rejected and one field to blame — and because
 * the per-batch ceiling is the rule most easily got wrong, by treating the
 * medicine rather than the batch as the thing being counted.
 */

const line = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  medicineId: 'med-1',
  batchId: 'batch-1',
  batchNumber: 'B-001',
  expiryDate: '2027-01-31',
  quantity: 10,
  lineTotalMinor: 100_00,
  medicineSnapshot: { brandName: 'Napa', strength: '500mg' },
  ...over,
});

const draft = (entries: Record<string, string>): ReturnDraft =>
  Object.fromEntries(
    Object.entries(entries).map(([key, quantity]) => [
      key,
      { quantity, reason: ReturnReason.DAMAGED_IN_TRANSIT, notes: '' },
    ]),
  );

describe('which invoice line is which', () => {
  it('is keyed by medicine and batch together', () => {
    /*
     * An invoice can carry the same product on two batches with different
     * expiry dates. Keying on the medicine alone would merge them into one row
     * — so the ceiling checked against would be one batch's quantity while the
     * return named a mixture of both.
     */
    const first = line();
    const second = line({ batchId: 'batch-2', batchNumber: 'B-002' });
    expect(lineKey(first)).not.toBe(lineKey(second));
  });

  it('seeds one empty row per line, carrying the main reason down', () => {
    const seeded = seedDraft([line(), line({ batchId: 'batch-2' })], ReturnReason.EXPIRED);
    expect(Object.keys(seeded)).toHaveLength(2);
    expect(Object.values(seeded).every((entry) => entry.quantity === '')).toBe(true);
    // Most returns have one reason for the whole box; per-line reasons are for
    // the case where they do not.
    expect(Object.values(seeded).every((entry) => entry.reason === ReturnReason.EXPIRED)).toBe(
      true,
    );
  });
});

describe('which lines are actually being returned', () => {
  const lines = [line(), line({ batchId: 'batch-2', batchNumber: 'B-002' })];

  it('counts only the ones with a quantity typed against them', () => {
    const selected = selectedLines(lines, draft({ 'med-1:batch-1': '3', 'med-1:batch-2': '' }));
    expect(selected).toHaveLength(1);
    expect(selected[0]!.quantity).toBe(3);
  });

  it('ignores a zero, which is how somebody unticks a row', () => {
    expect(selectedLines(lines, draft({ 'med-1:batch-1': '0' }))).toEqual([]);
  });

  it('ignores text that is not a number rather than sending NaN', () => {
    // A number pad on Android still admits a stray character on some handsets,
    // and `Number('3a')` is `NaN` — which would reach the server as `null` and
    // fail the whole request with a schema error naming an index.
    expect(selectedLines(lines, draft({ 'med-1:batch-1': 'three' }))).toEqual([]);
  });

  it('ignores a negative, which would credit the shop for goods they kept', () => {
    expect(selectedLines(lines, draft({ 'med-1:batch-1': '-2' }))).toEqual([]);
  });
});

describe('what is wrong with a return request', () => {
  const lines = [line(), line({ batchId: 'batch-2', batchNumber: 'B-002', quantity: 4 })];

  it('accepts a request within every ceiling', () => {
    expect(returnProblem(lines, draft({ 'med-1:batch-1': '10', 'med-1:batch-2': '4' }))).toBeNull();
  });

  it('says nothing is selected rather than reporting a failure', () => {
    /*
     * "Not filled in yet" and "the server refused this" are different facts,
     * and the web form used to show both with the same red "Something went
     * wrong" card. A shop reading that assumes the system is broken.
     */
    expect(returnProblem(lines, draft({ 'med-1:batch-1': '' }))?.key).toBe('returns.needQuantity');
  });

  it('holds each batch to its own invoiced quantity', () => {
    // The second batch was invoiced 4. Returning 5 of it is refused even though
    // the medicine as a whole was invoiced 14.
    const problem = returnProblem(lines, draft({ 'med-1:batch-2': '5' }));
    expect(problem?.key).toBe('returns.tooMany');
    expect(problem?.values).toEqual({ maximum: 4, brand: 'Napa' });
  });

  it('names the product in the message, because a phone shows one line at a time', () => {
    const problem = returnProblem(
      [line({ medicineSnapshot: { brandName: 'Seclo' } })],
      draft({ 'med-1:batch-1': '99' }),
    );
    expect(problem?.values?.brand).toBe('Seclo');
  });

  it('refuses half a box before the server does', () => {
    // `positiveQuantity` is an integer schema; without this the whole form
    // comes back rejected with a path like `lines.0.quantity` on it.
    expect(returnProblem(lines, draft({ 'med-1:batch-1': '2.5' }))?.key).toBe(
      'returns.wholeUnitsOnly',
    );
  });

  it('returns a catalogue key and its values, never a finished sentence', () => {
    const problem = returnProblem(lines, draft({ 'med-1:batch-2': '9' }));
    expect(problem?.key).toBe('returns.tooMany');
    // `{{maximum}}` and `{{brand}}` are interpolated by the catalogue, so the
    // rule hands over the numbers rather than a sentence built around them.
    expect(problem?.values).toEqual({ maximum: 4, brand: 'Napa' });
  });

  it('every key it can return is one the catalogue holds', () => {
    /*
     * These reach the screen as `t(problem.key, problem.values)`, which
     * `catalogueKeys.test.ts` cannot see — it reads literal call sites only.
     * A misspelling would render as `returns.wholeUnitsOnly` under the form.
     */
    const keys = [
      returnProblem(lines, draft({})),
      returnProblem(lines, draft({ 'med-1:batch-1': '2.5' })),
      returnProblem(lines, draft({ 'med-1:batch-2': '9' })),
    ].map((problem) => problem?.key);

    expect(keys.filter(Boolean)).toHaveLength(3);
    expect(keys.filter((key) => key && !KNOWN.has(key))).toEqual([]);
  });
});

describe('the estimate', () => {
  it('pro-rates the invoice line rather than repricing anything', () => {
    /*
     * ৳100 for ten units, three returned, so ৳30. The figure comes from
     * `lineTotalMinor` — what this shop was actually charged — and not from any
     * catalogue price, which is the whole point.
     */
    const selected = selectedLines([line()], draft({ 'med-1:batch-1': '3' }));
    expect(estimateMinor(selected)).toBe(30_00);
  });

  it('rounds to whole minor units, so no fraction of a paisa is ever shown', () => {
    // 100_00 / 3 is not a whole number of poisha. Money is integer minor units
    // everywhere in this product and an estimate is no exception.
    const selected = selectedLines([line({ quantity: 3 })], draft({ 'med-1:batch-1': '1' }));
    expect(Number.isInteger(estimateMinor(selected))).toBe(true);
    expect(estimateMinor(selected)).toBe(3333);
  });

  it('adds up across batches', () => {
    const lines = [line(), line({ batchId: 'batch-2', quantity: 4, lineTotalMinor: 40_00 })];
    const selected = selectedLines(lines, draft({ 'med-1:batch-1': '5', 'med-1:batch-2': '2' }));
    expect(estimateMinor(selected)).toBe(50_00 + 20_00);
  });

  it('is nothing when nothing is selected', () => {
    expect(estimateMinor([])).toBe(0);
  });
});
