import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Medicine } from '@medsupply/shared-types';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

const { useCart, lineFor } = await import('./useCart');

/**
 * The basket holds what was chosen and how many. **Never what it costs.**
 *
 * That is the whole point of this file: the basket used to store the entire
 * `Medicine`, and the screen multiplied its `defaultSellingPriceMinor` by the
 * quantity — the list price, not this shop's. `customerMoney.test.ts` gates the
 * screens; these are the assertions about the store underneath them.
 */

function medicine(overrides: Partial<Medicine> = {}): Medicine {
  return {
    _id: 'medicine-1',
    brandName: 'Napa',
    strength: '500 mg',
    minimumOrderQuantity: 2,
    maximumOrderQuantity: 10,
    defaultSellingPriceMinor: 9500,
    ...overrides,
  } as Medicine;
}

describe('the basket', () => {
  beforeEach(() => useCart.setState({ items: [], draftId: undefined }));

  it('carries no price into storage, whatever it was given', () => {
    /*
     * The assertion that matters most. A snapshot is five fields chosen by
     * hand; a spread of the medicine would put the price back and nothing else
     * here would notice.
     */
    const line = lineFor(medicine());
    expect(JSON.stringify(line)).not.toContain('9500');
    expect(Object.keys(line.snapshot).sort()).toEqual([
      'brandName',
      'maximum',
      'minimum',
      'strength',
    ]);
  });

  it('starts a line at the smallest quantity the shop is allowed to order', () => {
    useCart.getState().add(medicine());
    expect(useCart.getState().items[0]!.quantity).toBe(2);
  });

  it('adding the same medicine again adds another minimum rather than doing nothing', () => {
    // A second tap means "I want more of this", and used to mean nothing at all.
    const item = medicine();
    useCart.getState().add(item);
    useCart.getState().add(item);
    expect(useCart.getState().items).toHaveLength(1);
    expect(useCart.getState().items[0]!.quantity).toBe(4);
  });

  it('never pushes a line past a limit the server would refuse', () => {
    const item = medicine({ minimumOrderQuantity: 4, maximumOrderQuantity: 5 });
    useCart.getState().add(item);
    useCart.getState().add(item);
    expect(useCart.getState().items[0]!.quantity).toBe(5);
  });

  it('has no ceiling when the medicine has none', () => {
    const item = medicine({ minimumOrderQuantity: 100, maximumOrderQuantity: undefined });
    useCart.getState().add(item);
    useCart.getState().add(item);
    expect(useCart.getState().items[0]!.quantity).toBe(200);
  });

  it('keeps lines apart, and removes only the one asked for', () => {
    useCart.getState().add(medicine({ _id: 'a' }));
    useCart.getState().add(medicine({ _id: 'b' }));
    useCart.getState().remove('a');
    expect(useCart.getState().items.map((line) => line.medicineId)).toEqual(['b']);
  });

  it('forgets the draft when it is cleared, not only the lines', () => {
    // A kept draft id would make the next order a patch of the submitted one.
    useCart.getState().add(medicine());
    useCart.getState().setDraftId('draft-1');
    useCart.getState().clear();
    expect(useCart.getState().items).toEqual([]);
    expect(useCart.getState().draftId).toBeUndefined();
  });

  it('writes only the basket to storage, not the hydration flag', () => {
    /*
     * `restored` describes the storage, not the basket. Persisting it would
     * store `true` and then read it back before hydration had actually
     * finished, which is the one thing it exists to report.
     */
    const options = useCart.persist.getOptions();
    expect(Object.keys(options.partialize!({ ...useCart.getState() }) as object).sort()).toEqual([
      'draftId',
      'items',
    ]);
  });

  it('discards anything stored under an older shape rather than translating it', () => {
    // The only plausible older shape is the web store's, which holds whole
    // `Medicine` objects — reading one back would put a price in the basket.
    const options = useCart.persist.getOptions();
    const migrated = options.migrate!({ items: [{ medicine: medicine(), quantity: 3 }] }, 0);
    expect(JSON.stringify(migrated)).not.toContain('9500');
    expect((migrated as { items: unknown[] }).items).toEqual([]);
  });
});
