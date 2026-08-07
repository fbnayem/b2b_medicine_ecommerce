import type { Stocktake, StocktakeLine, StocktakeListRow } from '@medsupply/shared-types';
import { apiClient } from '../api/client';

/**
 * Counting stock, from a phone in the aisle.
 *
 * The whole of this existed on the server and on web and had **no screen on
 * this client**, which is the wrong way round: counting is the most
 * phone-shaped job in the building. Nobody counts a rack from a desk, and a
 * count sheet printed, walked, pencilled and typed up afterwards is two
 * transcriptions and a chance to lose an hour of work.
 */

type Envelope<T> = { data: T; meta?: { page?: number; pages?: number; total?: number } };

export async function getStocktakes(params: Record<string, string> = {}) {
  const response = await apiClient.get<Envelope<StocktakeListRow[]>>('/stocktakes', { params });
  return response.data.data;
}

export async function getStocktake(id: string) {
  const response = await apiClient.get<Envelope<Stocktake>>(`/stocktakes/${id}`);
  return response.data.data;
}

export async function openStocktake(body: {
  warehouseLocation?: string;
  medicineIds?: string[];
  notes?: string;
}) {
  const response = await apiClient.post<Envelope<Stocktake>>('/stocktakes', body);
  return response.data.data;
}

export async function submitStocktake(id: string, version: number) {
  const response = await apiClient.post<Envelope<Stocktake>>(`/stocktakes/${id}/submit`, {
    version,
  });
  return response.data.data;
}

export async function postStocktake(id: string, version: number, idempotencyKey: string) {
  const response = await apiClient.post<Envelope<Stocktake>>(`/stocktakes/${id}/post`, {
    version,
    idempotencyKey,
  });
  return response.data.data;
}

export async function abandonStocktake(id: string, version: number, reason: string) {
  const response = await apiClient.post<Envelope<Stocktake>>(`/stocktakes/${id}/abandon`, {
    version,
    reason,
  });
  return response.data.data;
}

/** One line's count, as the endpoint takes it. */
export interface CountEntry {
  lineId: string;
  countedQuantity: number;
  varianceReason?: string;
}

export async function recordCounts(id: string, version: number, counts: CountEntry[]) {
  const response = await apiClient.post<Envelope<Stocktake>>(`/stocktakes/${id}/counts`, {
    version,
    counts,
  });
  return response.data.data;
}

/** What is wrong with a typed count, as a catalogue key rather than a sentence. */
export type CountProblem =
  'stocktake.countRequired' | 'stocktake.wholeUnitsOnly' | 'stocktake.countTooLarge';

/**
 * Whether what somebody typed is a count.
 *
 * **Zero is a real answer** — "there are none on that shelf" is exactly the
 * finding a count exists to make — so an empty field and a nought are different
 * things, and only the first is a problem. That distinction is why
 * `countedQuantity` is `null` until counted rather than defaulting to 0.
 */
export function countProblem(typed: string): CountProblem | null {
  const trimmed = typed.trim();
  if (trimmed === '') return 'stocktake.countRequired';
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return 'stocktake.countRequired';
  if (!Number.isInteger(value)) return 'stocktake.wholeUnitsOnly';
  // The server's ceiling. A finger resting on a key is the realistic cause, and
  // finding out at the end of an hour is the expensive way to learn.
  if (value > 1_000_000) return 'stocktake.countTooLarge';
  return null;
}

/**
 * Whether the count sheet may show what the system expected.
 *
 * **A blind count that shows the answer is not a count.** The server strips
 * `systemQuantity` from every line while the sheet is open, so this is not the
 * enforcement — it is the screen agreeing with it, and the reason the screen
 * must not keep an expected figure it saw earlier in state.
 */
export function showsExpected(stocktake: Pick<Stocktake, 'status'>): boolean {
  return stocktake.status === 'REVIEW' || stocktake.status === 'POSTED';
}

/** Lines still to count, which is what a storekeeper walking a rack wants next. */
export function uncounted(lines: readonly StocktakeLine[]): StocktakeLine[] {
  return lines.filter((line) => line.countedQuantity === null);
}

/**
 * How far a sheet has got, in the two numbers a person actually asks for.
 *
 * Taken from the lines rather than from `summary`, which is withheld with the
 * expected quantities while a count is open — so a progress bar built on it
 * would read zero for the whole of the job it is measuring.
 */
export function progress(lines: readonly StocktakeLine[]) {
  const counted = lines.length - uncounted(lines).length;
  return { counted, total: lines.length };
}
