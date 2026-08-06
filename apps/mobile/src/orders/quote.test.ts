import { describe, expect, it, vi } from 'vitest';

/*
 * `quote.ts` reaches the API client, which reaches `react-native` — whose
 * source is Flow-typed and which esbuild cannot parse. Mocked so the pure part
 * can be tested on a workstation, exactly as `notifications/push.test.ts` does.
 */
vi.mock('../api/client', () => ({ apiClient: { post: vi.fn() }, baseURL: '' }));

const { basketSignature } = await import('./quote');

/**
 * The basket's identity, which decides when the server is asked again.
 *
 * Two failure modes, opposite and both quiet. A signature that ignored the
 * **quantity** would price a basket once and never again, so changing 2 boxes
 * to 200 would leave the old total on screen — the original defect wearing a
 * different hat. A signature that included the **order** of the lines would ask
 * again every time a row moved, spending a request per keystroke on a
 * connection this audience often does not have.
 */
describe('when the basket is worth re-pricing', () => {
  const line = (medicineId: string, requestedQuantity: number) => ({
    medicineId,
    requestedQuantity,
  });

  it('changes when a quantity changes', () => {
    expect(basketSignature([line('a', 2)])).not.toBe(basketSignature([line('a', 3)]));
  });

  it('changes when a medicine is added or removed', () => {
    expect(basketSignature([line('a', 2)])).not.toBe(basketSignature([line('a', 2), line('b', 1)]));
    expect(basketSignature([line('a', 2), line('b', 1)])).not.toBe(basketSignature([line('a', 2)]));
  });

  it('does not change when the same basket is merely reordered', () => {
    expect(basketSignature([line('a', 2), line('b', 1)])).toBe(
      basketSignature([line('b', 1), line('a', 2)]),
    );
  });

  it('is empty for an empty basket, so nothing is asked', () => {
    expect(basketSignature([])).toBe('');
  });

  it('cannot confuse two baskets that differ only in where the digits fall', () => {
    // `a:1` + `b:11` and `a:11` + `b:1` must not collapse onto one string.
    expect(basketSignature([line('a', 1), line('b', 11)])).not.toBe(
      basketSignature([line('a', 11), line('b', 1)]),
    );
  });
});
