import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';

/**
 * What this shop would actually be charged, asked of the server.
 *
 * ## The defect this exists to end
 *
 * The basket multiplied `medicine.defaultSellingPriceMinor` by the quantity and
 * called the result a subtotal. That is the **list** price — before the shop's
 * own discount, before whichever price list they are assigned, before any
 * free-goods offer running on the line, and before the delivery charge. The
 * server reprices from `resolvePriceFrom` on the way in, so a customer was
 * shown one total on the basket screen and charged another on the invoice.
 *
 * `POST /orders/quote` has existed since the order-entry phase and answers
 * exactly this question. It runs **the same `buildOrderSnapshot`** the draft and
 * the submission use, rather than a second implementation that would agree with
 * them only until one of them changed. Nothing is written and no reference is
 * consumed.
 *
 * The web basket was moved onto it in an earlier phase; mobile was not, and the
 * two clients have been showing different money for the same basket ever since.
 *
 * ## Why a hook rather than a fetch in the screen
 *
 * Three things have to be right every time and are easy to get wrong once:
 * the request is debounced so holding a key down does not send a request per
 * keystroke; the in-flight request is **aborted** when the basket changes
 * again, so a slow early reply cannot overwrite a fast later one; and a failed
 * quote leaves the previous figures on screen rather than blanking the basket
 * somebody is reading.
 */

export interface QuoteLine {
  medicineId: string;
  medicineSnapshot: { brandName: string; strength: string };
  requestedQuantity: number;
  /** Dispatched but not charged. Zero unless a scheme applies. */
  freeQuantity: number;
  schemeReference?: string;
  estimatedUnitPriceMinor: number;
  estimatedDiscountMinor: number;
  estimatedLineTotalMinor: number;
  availableStockSnapshot: number;
}

export interface Quote {
  items: QuoteLine[];
  estimatedSubtotalMinor: number;
  estimatedDiscountMinor: number;
  estimatedDeliveryChargeMinor: number;
  estimatedTotalMinor: number;
}

export interface QuoteRequestLine {
  medicineId: string;
  requestedQuantity: number;
}

export async function fetchQuote(
  lines: readonly QuoteRequestLine[],
  signal?: AbortSignal,
): Promise<Quote> {
  const response = await apiClient.post<{ data: Quote }>(
    '/orders/quote',
    {
      items: lines.map((line) => ({
        medicineId: line.medicineId,
        requestedQuantity: line.requestedQuantity,
      })),
    },
    { signal },
  );
  return response.data.data;
}

/**
 * The identity of a basket, for deciding whether to ask again.
 *
 * Quantity **and** medicine, sorted, so reordering the same basket does not
 * spend a request. Exported because the test asserts on it directly: a
 * signature that ignored the quantity would quote a basket once and then never
 * again, which is the same defect in a new place.
 */
export function basketSignature(lines: readonly QuoteRequestLine[]): string {
  return lines
    .map((line) => `${line.medicineId}:${line.requestedQuantity}`)
    .sort()
    .join('|');
}

export interface QuoteState {
  quote?: Quote;
  loading: boolean;
  /** Set when the last attempt failed. The previous quote stays on screen. */
  failed: boolean;
  retry: () => void;
}

const DEBOUNCE_MS = 400;

export function useQuote(lines: readonly QuoteRequestLine[]): QuoteState {
  const signature = basketSignature(lines);
  const [quote, setQuote] = useState<Quote>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /*
   * The lines are read through a ref inside the effect, so the effect depends
   * on the *signature* and not on the array identity. A new array of identical
   * lines is rendered on every keystroke and would otherwise re-fire this.
   */
  const latest = useRef(lines);
  latest.current = lines;

  useEffect(() => {
    if (latest.current.length === 0) {
      setQuote(undefined);
      setLoading(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetchQuote(latest.current, controller.signal)
        .then((value) => {
          setQuote(value);
          setFailed(false);
        })
        .catch(() => {
          // An abort is not a failure — a newer request is already on its way,
          // and reporting it would flash an error on every keystroke.
          if (controller.signal.aborted) return;
          setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [signature, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { quote, loading, failed, retry };
}
