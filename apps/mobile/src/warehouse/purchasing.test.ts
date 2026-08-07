import { describe, expect, it, vi } from 'vitest';
import { catalogueKeys, en } from '@medsupply/i18n';

// Reaches the API client, and through it `react-native`, whose Flow-typed
// source the runner cannot parse. Same mock as `orders/quote.test.ts`.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

const { outstandingOn, receiptProblem, stillArriving } = await import('./purchasing');

/**
 * Booking a delivery in at the goods-in door.
 *
 * Two of these rules are the reason the screen is worth having at all, and both
 * are about what happens **weeks later** if the moment is got wrong:
 *
 *   - a batch that has already expired, received into saleable stock, is picked
 *     for a pharmacy and reaches a patient;
 *   - a short delivery accepted without a reason stops being a conversation
 *     with a supplier and becomes what looks like a counting error.
 */
describe('what is wrong with a line at the goods-in door', () => {
  const line = { orderedQuantity: 100, receivedQuantity: 0 };
  const draft = (over: Record<string, string> = {}) => ({
    batchNumber: 'B-2026-01',
    warehouseLocation: 'Aisle C',
    receivedQuantity: '100',
    manufacturingDate: '2026-01-01',
    expiryDate: '2028-01-01',
    varianceReason: '',
    ...over,
  });
  const now = new Date('2026-08-07T00:00:00.000Z');

  it('accepts a full delivery of an unexpired batch', () => {
    expect(receiptProblem(line, draft(), now)).toBeNull();
  });

  it('refuses a batch that has already expired', () => {
    /*
     * The assertion the whole screen exists for. Nothing downstream asks again:
     * received stock is saleable stock, it is picked by expiry order, and an
     * expired batch received today is one a pharmacy is sent tomorrow.
     */
    expect(receiptProblem(line, draft({ expiryDate: '2026-01-01' }), now)?.key).toBe(
      'purchasing.expiredOnArrival',
    );
  });

  it('catches an expiry before the manufacturing date, which is a mistyped year', () => {
    expect(receiptProblem(line, draft({ manufacturingDate: '2029-01-01' }), now)?.key).toBe(
      'purchasing.expiryBeforeMade',
    );
  });

  it('will not book in more than was ordered, and says how much is left', () => {
    const problem = receiptProblem({ orderedQuantity: 100, receivedQuantity: 40 }, draft(), now);
    expect(problem?.key).toBe('purchasing.moreThanOrdered');
    expect(problem?.values).toEqual({ outstanding: 60 });
  });

  it('makes a short delivery say why, and then accepts it', () => {
    // Short without a reason is refused...
    expect(receiptProblem(line, draft({ receivedQuantity: '80' }), now)?.key).toBe(
      'purchasing.shortNeedsReason',
    );
    // ...and with one, it goes through. A short delivery is a real event; the
    // screen exists to record it, not to prevent it.
    expect(
      receiptProblem(
        line,
        draft({ receivedQuantity: '80', varianceReason: 'Two cartons short' }),
        now,
      ),
    ).toBeNull();
  });

  it('asks for the batch and the place before anything else', () => {
    /*
     * The order is the order the form is filled in, so the first thing somebody
     * is told about is the first thing they can fix. A quantity complaint above
     * an empty batch field sends them up and down the screen.
     */
    expect(receiptProblem(line, draft({ batchNumber: '  ' }), now)?.key).toBe(
      'purchasing.batchRequired',
    );
    expect(receiptProblem(line, draft({ warehouseLocation: '' }), now)?.key).toBe(
      'purchasing.placeRequired',
    );
  });

  it('refuses a quantity that is not a whole number of units', () => {
    expect(receiptProblem(line, draft({ receivedQuantity: '' }), now)?.key).toBe(
      'purchasing.quantityRequired',
    );
    expect(receiptProblem(line, draft({ receivedQuantity: '0' }), now)?.key).toBe(
      'purchasing.quantityRequired',
    );
    expect(receiptProblem(line, draft({ receivedQuantity: '2.5' }), now)?.key).toBe(
      'purchasing.quantityRequired',
    );
  });
});

describe('how much of an order is still to come', () => {
  it('never goes negative, however the figures got there', () => {
    expect(outstandingOn({ orderedQuantity: 100, receivedQuantity: 40 })).toBe(60);
    expect(outstandingOn({ orderedQuantity: 100, receivedQuantity: 100 })).toBe(0);
    // An over-receipt somewhere in the past must not show as "-20 to come".
    expect(outstandingOn({ orderedQuantity: 100, receivedQuantity: 120 })).toBe(0);
  });

  it('knows which orders are worth opening at the door', () => {
    const lines = [{ orderedQuantity: 10, receivedQuantity: 4 }];
    expect(stillArriving({ status: 'ISSUED', lines } as never)).toBe(true);
    expect(stillArriving({ status: 'PARTIALLY_RECEIVED', lines } as never)).toBe(true);
    // Nothing outstanding, and nothing to do — even though the status allows it.
    expect(
      stillArriving({
        status: 'PARTIALLY_RECEIVED',
        lines: [{ orderedQuantity: 10, receivedQuantity: 10 }],
      } as never),
    ).toBe(false);
    expect(stillArriving({ status: 'DRAFT', lines } as never)).toBe(false);
    expect(stillArriving({ status: 'CANCELLED', lines } as never)).toBe(false);
  });
});

/**
 * These reach the screen as `t(problem.key)`, a variable, which
 * `catalogueKeys.test.ts` is documented as unable to see.
 */
describe('every problem this module reports can be said out loud', () => {
  const KNOWN = new Set(catalogueKeys(en));

  it.each([
    'purchasing.batchRequired',
    'purchasing.placeRequired',
    'purchasing.quantityRequired',
    'purchasing.expiryRequired',
    'purchasing.expiredOnArrival',
    'purchasing.expiryBeforeMade',
    'purchasing.moreThanOrdered',
    'purchasing.shortNeedsReason',
  ])('%s is in the catalogue', (key) => {
    expect(KNOWN.has(key)).toBe(true);
  });
});
