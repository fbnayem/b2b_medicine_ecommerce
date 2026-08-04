import type { Medicine } from '@medsupply/shared-types';

/**
 * Taking an order for somebody else, decided here rather than in the screen.
 *
 * `AGENTS.md` keeps business logic out of components, and this screen has more
 * of it than most: which customer a remembered choice is still allowed to name,
 * what a typed quantity means, and — the one that costs real money — whether
 * the key that made a submission safe to retry has been spent. All three are
 * wrong in ways that are invisible on a phone, so all three are testable.
 *
 * The **prices are not here**. `POST /orders/quote` runs the same
 * `buildOrderSnapshot` the submission runs, so the figure a rep reads to a
 * customer standing in front of them is the figure on the invoice, including
 * their price list and any free-goods offer. A module that worked the price out
 * for itself would quote the medicine's default and be quietly wrong for every
 * customer who is on a list.
 */

export interface DraftLine {
  medicineId: string;
  brandName: string;
  /** Blank on a shelf line — a shampoo has no strength. Rendered beside the brand. */
  strength: string;
  quantity: number;
  /** The catalogue's own bounds, carried so a typed quantity can be checked against them. */
  minimum: number;
  maximum?: number;
}

/**
 * A whole number of units from a text field.
 *
 * The same defect the cart, the approval screen and the picking screen each
 * shipped: `Number(value)` sends `NaN` for a cleared field and for any stray
 * character, into the payload that decides what gets invoiced.
 */
export function unitsFrom(value: string, fallback = 0): number {
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : fallback;
}

export function addLine(
  lines: readonly DraftLine[],
  medicine: Medicine,
): { lines: DraftLine[]; duplicate: boolean } {
  if (lines.some((line) => line.medicineId === medicine._id)) {
    // The server refuses a repeated medicine outright, so the whole basket
    // would fail on submit — after the rep had typed the rest of it.
    return { lines: [...lines], duplicate: true };
  }
  return {
    duplicate: false,
    lines: [
      ...lines,
      {
        medicineId: medicine._id,
        brandName: medicine.brandName,
        strength: medicine.strength ?? '',
        quantity: medicine.minimumOrderQuantity || 1,
        minimum: medicine.minimumOrderQuantity || 1,
        maximum: medicine.maximumOrderQuantity,
      },
    ],
  };
}

/**
 * Sets a quantity, clamped to what the catalogue allows.
 *
 * `adjustedTo` is how the screen knows to say so. Clamping silently is the
 * quiet version of this: the rep types 2, the line shows 10, and nothing
 * explains which of the two the customer is being charged for.
 */
export function setQuantity(
  lines: readonly DraftLine[],
  medicineId: string,
  quantity: number,
): { lines: DraftLine[]; adjustedTo: number | null } {
  const line = lines.find((entry) => entry.medicineId === medicineId);
  if (!line) return { lines: [...lines], adjustedTo: null };

  const upper = line.maximum ?? Number.MAX_SAFE_INTEGER;
  const clamped = Math.min(Math.max(quantity, line.minimum), upper);
  return {
    adjustedTo: clamped === quantity ? null : clamped,
    lines: lines.map((entry) =>
      entry.medicineId === medicineId ? { ...entry, quantity: clamped } : entry,
    ),
  };
}

export function removeLine(lines: readonly DraftLine[], medicineId: string): DraftLine[] {
  return lines.filter((line) => line.medicineId !== medicineId);
}

/**
 * The remembered customer, but only while the rep may still order for them.
 *
 * A rep visits one shop at a time and often places several orders in a visit,
 * so re-picking the customer on every launch is the mobile version of the
 * queue-filter problem phase 23 just fixed. What makes remembering safe is this
 * check: territories are reassigned and shops are deactivated, and
 * `GET /shops` is scoped to what `POST /orders/submit` will accept — so a
 * remembered id that is no longer in the list is one the server would now
 * refuse. Restoring it anyway would open the screen with a customer selected
 * whom the rep cannot order for, and say nothing until the order was typed.
 */
export function resolveCustomer(
  remembered: string | null | undefined,
  shops: readonly { _id: string }[],
): string {
  return remembered && shops.some((shop) => shop._id === remembered) ? remembered : '';
}

/**
 * Whether the key that made the last attempt safe to retry has been spent.
 *
 * A 4xx is the server having read the order and refused it: the basket has to
 * change before it is worth sending again, so the next attempt is a different
 * order and needs its own key. Anything else — a timeout, a dropped connection,
 * a 5xx — leaves the question of whether the order was created *unanswered*,
 * and holding the same key is the only thing that makes pressing the button
 * again safe. A submission on a bad connection is the ordinary case here, and
 * a fresh key on every attempt is how a customer gets charged twice for goods
 * they asked for once.
 */
export function keyIsSpent(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500;
}

/** Why `Place this order` is not available — one reason, the first that applies. */
export type Blocker = 'NO_CUSTOMER' | 'NO_LINES' | 'NO_ADDRESS' | 'OFFLINE' | 'NO_PRICE';

/**
 * A disabled button that does not say why is a support call.
 *
 * The web screen can afford to grey one out beside three visible fields; a
 * phone shows one thing at a time, so the missing delivery address is three
 * scrolls away from the button that is refusing to work because of it.
 *
 * `OFFLINE` comes before `NO_PRICE` on purpose. Both mean there is no total,
 * but only one of them is worth telling somebody to walk outside for — and it
 * is also the one that must stop the submission, because an order needs a live
 * price and a live credit check, both of which are the server's answers.
 * `offlineQueue.ts` exists for deliveries, and an order is not a delivery: it
 * cannot be queued, so the screen refuses rather than pretending.
 */
export function whyNotReady(state: {
  shopId: string;
  lines: readonly DraftLine[];
  addressId: string;
  /** The last quote attempt failed because the request never reached the server. */
  offline: boolean;
  /** A total has been quoted for the basket as it currently stands. */
  priced: boolean;
}): Blocker | null {
  if (!state.shopId) return 'NO_CUSTOMER';
  if (state.lines.length === 0) return 'NO_LINES';
  if (!state.addressId) return 'NO_ADDRESS';
  if (state.offline) return 'OFFLINE';
  if (!state.priced) return 'NO_PRICE';
  return null;
}

export function quoteBody(shopId: string, lines: readonly DraftLine[]) {
  return {
    shopId,
    items: lines.map((line) => ({
      medicineId: line.medicineId,
      requestedQuantity: line.quantity,
    })),
  };
}

export function submitBody(input: {
  shopId: string;
  deliveryAddressId: string;
  requestedPaymentMethod: string;
  idempotencyKey: string;
  lines: readonly DraftLine[];
}) {
  return {
    shopId: input.shopId,
    deliveryAddressId: input.deliveryAddressId,
    requestedPaymentMethod: input.requestedPaymentMethod,
    idempotencyKey: input.idempotencyKey,
    items: input.lines.map((line) => ({
      medicineId: line.medicineId,
      requestedQuantity: line.quantity,
    })),
  };
}

/**
 * The lines the basket already knows, shown while a fresh total is on its way.
 *
 * On a cellular connection a total that blinks to zero between keystrokes is a
 * total nobody trusts, and a rep reading one aloud to a customer will read
 * whatever is on the screen. So the last quote the server actually gave is kept
 * until a new one replaces it, and the screen says it is refreshing rather than
 * emptying itself.
 */
export function linesAreQuoted(
  lines: readonly DraftLine[],
  quoted: readonly { medicineId: string; requestedQuantity: number }[],
): boolean {
  if (lines.length !== quoted.length) return false;
  return lines.every((line) =>
    quoted.some(
      (entry) => entry.medicineId === line.medicineId && entry.requestedQuantity === line.quantity,
    ),
  );
}
