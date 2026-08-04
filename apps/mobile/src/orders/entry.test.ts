import { describe, expect, it } from 'vitest';
import type { Medicine } from '@medsupply/shared-types';
import {
  addLine,
  keyIsSpent,
  linesAreQuoted,
  removeLine,
  resolveCustomer,
  setQuantity,
  submitBody,
  unitsFrom,
  whyNotReady,
  type DraftLine,
} from './entry';

function medicine(overrides: Partial<Medicine> = {}): Medicine {
  return {
    _id: 'med-1',
    reference: 'MED-2026-000001',
    sku: 'NAPA-500',
    brandName: 'Napa',
    genericName: 'Paracetamol',
    manufacturer: 'Beximco',
    strength: '500mg',
    dosageForm: 'Tablet',
    packSize: '10x10',
    unit: 'strip',
    category: 'Analgesic',
    costPriceMinor: 8000,
    defaultSellingPriceMinor: 12000,
    minimumOrderQuantity: 1,
    classification: 'OTC' as Medicine['classification'],
    coldChain: false,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('a quantity typed on a phone', () => {
  it('is a whole number of units or the fallback, never NaN', () => {
    expect(unitsFrom('12')).toBe(12);
    // The two that reached the invoice from the cart, the approval screen and
    // the picking screen: a cleared field and a stray character.
    expect(unitsFrom('')).toBe(0);
    expect(unitsFrom('abc', 5)).toBe(5);
    expect(unitsFrom('1২')).toBe(1);
  });

  it('is clamped to what the catalogue allows, and says when it was', () => {
    const lines = addLine(
      [],
      medicine({ minimumOrderQuantity: 10, maximumOrderQuantity: 50 }),
    ).lines;

    const low = setQuantity(lines, 'med-1', 2);
    expect(low.lines[0].quantity).toBe(10);
    expect(low.adjustedTo).toBe(10);

    const high = setQuantity(lines, 'med-1', 400);
    expect(high.lines[0].quantity).toBe(50);
    expect(high.adjustedTo).toBe(50);

    // Inside the bounds nothing is announced, because nothing was changed.
    expect(setQuantity(lines, 'med-1', 20).adjustedTo).toBeNull();
  });

  it('starts a new line at the minimum order quantity rather than at one', () => {
    const { lines } = addLine([], medicine({ minimumOrderQuantity: 24 }));
    expect(lines[0].quantity).toBe(24);
  });
});

describe('the basket', () => {
  it('refuses the same medicine twice, because the server does', () => {
    const first = addLine([], medicine());
    const second = addLine(first.lines, medicine());
    expect(second.duplicate).toBe(true);
    expect(second.lines).toHaveLength(1);
  });

  it('drops a line without touching the others', () => {
    const one = addLine([], medicine()).lines;
    const two = addLine(one, medicine({ _id: 'med-2', brandName: 'Seclo' })).lines;
    expect(removeLine(two, 'med-1').map((line) => line.medicineId)).toEqual(['med-2']);
  });
});

describe('the customer a rep is remembered on', () => {
  const shops = [{ _id: 'shop-1' }, { _id: 'shop-2' }];

  it('comes back on the next launch', () => {
    expect(resolveCustomer('shop-2', shops)).toBe('shop-2');
  });

  it('is dropped once the rep may no longer order for them', () => {
    /*
     * `GET /shops` is territory-scoped to exactly what `POST /orders/submit`
     * will accept, so a remembered shop missing from the list is one the server
     * would now refuse — a reassigned territory, or a shop that has been
     * deactivated. Restoring it would open the screen with a customer selected
     * whom the whole order is going to be rejected for.
     */
    expect(resolveCustomer('shop-9', shops)).toBe('');
    expect(resolveCustomer(null, shops)).toBe('');
    expect(resolveCustomer('shop-1', [])).toBe('');
  });
});

describe('the key that makes a retry safe', () => {
  it('is spent by a refusal, because the next attempt is a different order', () => {
    expect(keyIsSpent(400)).toBe(true);
    expect(keyIsSpent(409)).toBe(true);
    expect(keyIsSpent(422)).toBe(true);
  });

  it('is held through everything that leaves the answer unknown', () => {
    /*
     * This is the rule that stops a customer being charged twice for goods they
     * asked for once. A timeout on a cellular connection is the ordinary case
     * here — the order may well have been created — so the retry has to carry
     * the same key. A fresh one would create a second order.
     */
    expect(keyIsSpent(undefined)).toBe(false);
    expect(keyIsSpent(500)).toBe(false);
    expect(keyIsSpent(502)).toBe(false);
    expect(keyIsSpent(504)).toBe(false);
  });

  it('travels with the order rather than being left off it', () => {
    const body = submitBody({
      shopId: 'shop-1',
      deliveryAddressId: 'addr-1',
      requestedPaymentMethod: 'CREDIT',
      idempotencyKey: 'mobile-order-submit-shop-1-abc',
      lines: [
        { medicineId: 'med-1', brandName: 'Napa', strength: '500mg', quantity: 3, minimum: 1 },
      ],
    });
    expect(body.idempotencyKey).toBe('mobile-order-submit-shop-1-abc');
    expect(body.items).toEqual([{ medicineId: 'med-1', requestedQuantity: 3 }]);
  });
});

describe('why the order cannot be placed yet', () => {
  const line: DraftLine = {
    medicineId: 'med-1',
    brandName: 'Napa',
    strength: '500mg',
    quantity: 1,
    minimum: 1,
  };
  const ready = {
    shopId: 'shop-1',
    lines: [line],
    addressId: 'addr-1',
    offline: false,
    priced: true,
  };

  it('is nothing, when it can be', () => {
    expect(whyNotReady(ready)).toBeNull();
  });

  it('names the missing thing, one at a time', () => {
    expect(whyNotReady({ ...ready, shopId: '' })).toBe('NO_CUSTOMER');
    expect(whyNotReady({ ...ready, lines: [] })).toBe('NO_LINES');
    expect(whyNotReady({ ...ready, addressId: '' })).toBe('NO_ADDRESS');
    expect(whyNotReady({ ...ready, priced: false })).toBe('NO_PRICE');
  });

  it('refuses outright when the server cannot be reached', () => {
    /*
     * An order needs a live price and a live credit check, both of which are
     * the server's answers, so it cannot be queued the way a delivery can. The
     * screen says so instead of accepting something it is unable to price.
     */
    expect(whyNotReady({ ...ready, offline: true })).toBe('OFFLINE');
    // And it is the reason given, not the missing total it also causes.
    expect(whyNotReady({ ...ready, offline: true, priced: false })).toBe('OFFLINE');
  });
});

describe('the total on the screen', () => {
  const line: DraftLine = {
    medicineId: 'med-1',
    brandName: 'Napa',
    strength: '500mg',
    quantity: 4,
    minimum: 1,
  };

  it('belongs to the basket as it currently stands', () => {
    expect(linesAreQuoted([line], [{ medicineId: 'med-1', requestedQuantity: 4 }])).toBe(true);
  });

  it('is stale the moment a quantity changes, so the screen can say so', () => {
    /*
     * The last good total is deliberately left on screen while a new one is
     * fetched — a figure that blinks to zero between taps is a figure nobody
     * reads aloud to a customer. What must not happen is submitting against it
     * as though it were current.
     */
    expect(linesAreQuoted([line], [{ medicineId: 'med-1', requestedQuantity: 3 }])).toBe(false);
    expect(linesAreQuoted([line], [])).toBe(false);
    expect(
      linesAreQuoted(
        [line],
        [
          { medicineId: 'med-1', requestedQuantity: 4 },
          { medicineId: 'med-2', requestedQuantity: 1 },
        ],
      ),
    ).toBe(false);
  });
});
