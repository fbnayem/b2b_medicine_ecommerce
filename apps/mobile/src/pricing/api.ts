import type { PriceListLine, PriceListRecord, SchemeRecord } from '@medsupply/shared-types';
import { apiClient } from '../api/client';

/**
 * What customers pay, and what they get free.
 *
 * A representative standing at a counter is asked two questions this answers —
 * "what price am I on" and "is there an offer on this" — and both were
 * desktop-only. That is the read half, and it is the half that matters most on
 * a phone.
 *
 * The write half is deliberately narrow. See `price-list-detail.tsx`: a
 * two-hundred-line grid on a six-inch screen is a list nobody can audit before
 * pressing save, so the editor finds one line and changes one price.
 */

type Envelope<T> = { data: T };

export async function getPriceLists() {
  const response = await apiClient.get<Envelope<PriceListRecord[]>>('/pricing/price-lists');
  return response.data.data;
}

export async function getPriceList(id: string) {
  const response = await apiClient.get<Envelope<PriceListRecord>>(`/pricing/price-lists/${id}`);
  return response.data.data;
}

export async function createPriceList(body: { name: string; description?: string }) {
  const response = await apiClient.post<Envelope<PriceListRecord>>('/pricing/price-lists', body);
  return response.data.data;
}

/**
 * Replace a price list, under its optimistic version.
 *
 * `PATCH` takes the **whole** set of lines, so the only safe way to change one
 * price is to send back everything that was read plus the change. The version
 * is what makes that safe: two people editing the same list from two phones,
 * and the second save is refused rather than silently discarding the first.
 */
export async function savePriceList(id: string, version: number, lines: PriceListLine[]) {
  const response = await apiClient.patch<Envelope<PriceListRecord>>(`/pricing/price-lists/${id}`, {
    version,
    lines,
  });
  return response.data.data;
}

export async function getSchemes() {
  const response = await apiClient.get<Envelope<SchemeRecord[]>>('/pricing/schemes');
  return response.data.data;
}

export async function getScheme(id: string) {
  const response = await apiClient.get<Envelope<SchemeRecord>>(`/pricing/schemes/${id}`);
  return response.data.data;
}

export async function createScheme(body: {
  name: string;
  medicineId: string;
  buyQuantity: number;
  freeQuantity: number;
}) {
  const response = await apiClient.post<Envelope<SchemeRecord>>('/pricing/schemes', body);
  return response.data.data;
}

export async function updateScheme(
  id: string,
  body: { version: number; buyQuantity?: number; freeQuantity?: number; isActive?: boolean },
) {
  const response = await apiClient.patch<Envelope<SchemeRecord>>(`/pricing/schemes/${id}`, body);
  return response.data.data;
}

/** What is wrong with a typed price, as a catalogue key rather than a sentence. */
export type PriceProblem = 'priceLists.priceRequired' | 'priceLists.priceTooLarge';

/**
 * Whether what somebody typed is a price, in taka.
 *
 * **Zero is allowed.** A line priced at nothing is a real arrangement — a
 * sample, a replacement — and refusing it would push somebody into deleting the
 * line instead, which means the customer falls back to the default list at full
 * price. That is the opposite of what they meant.
 */
export function priceProblem(typed: string): PriceProblem | null {
  const trimmed = typed.trim();
  if (trimmed === '') return 'priceLists.priceRequired';
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return 'priceLists.priceRequired';
  // A price is entered in taka and stored in poisha, so the ceiling is applied
  // to the stored figure — the one that has to stay a safe integer.
  if (Math.round(value * 100) > Number.MAX_SAFE_INTEGER / 1000) return 'priceLists.priceTooLarge';
  return null;
}

/** Taka typed by a person into the integer minor units everything else uses. */
export function toMinor(typed: string): number {
  // `Math.round` rather than truncation: 12.005 read off a supplier's sheet
  // should not silently lose a paisa, and floating point makes 12.005 * 100
  // 1200.4999999999998.
  return Math.round(Number(typed.trim()) * 100);
}

/** And back, for a field somebody is about to edit. */
export function toTaka(minor: number): string {
  return (minor / 100).toFixed(2);
}

/**
 * A price list's lines with one of them changed, or added if it was not there.
 *
 * Returned rather than mutated, and the whole array rather than a delta,
 * because that is the shape `PATCH` takes — sending only the changed line would
 * replace the list with one line.
 */
export function withLine(
  lines: readonly PriceListLine[],
  medicineId: string,
  changed: Partial<PriceListLine>,
): PriceListLine[] {
  const existing = lines.find((line) => line.medicineId === medicineId);
  if (!existing) {
    return [
      ...lines,
      { medicineId, unitPriceMinor: 0, discountPercent: 0, ...changed } as PriceListLine,
    ];
  }
  return lines.map((line) => (line.medicineId === medicineId ? { ...line, ...changed } : line));
}
