import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '../api/client';
import {
  actionsFor,
  addUniqueAction,
  createQueuedAction,
  processQueue,
  type QueuedAction,
} from '../offline/queueCore';
import type { CountEntry } from './stocktakes';

/**
 * Counts recorded where there is no signal, held until there is.
 *
 * A warehouse aisle between steel racking is worse for reception than the lane
 * a rider is in, and the cost of losing the work is higher: a delivery
 * confirmation is one tap repeated, an hour of counting is an hour.
 *
 * **Where the queue is kept lives here**, not in `offline/queueCore.ts`, for
 * the same reason `delivery/offlineQueue.ts` keeps its own key: the arithmetic
 * is testable on a workstation only while storage stays out of it.
 */

const QUEUE_KEY = 'medsupply.stocktake.counts.v1';

async function readQueue(): Promise<QueuedAction[]> {
  const value = await AsyncStorage.getItem(QUEUE_KEY);
  if (!value) return [];
  try {
    return JSON.parse(value) as QueuedAction[];
  } catch {
    return [];
  }
}

export function loadCountQueue() {
  return readQueue();
}

/** How many counts for this sheet are still waiting to be sent. */
export async function pendingFor(stocktakeId: string) {
  return actionsFor(await readQueue(), 'stocktake', stocktakeId).length;
}

/**
 * Hold one line's count.
 *
 * One action per line rather than one per sheet: a storekeeper counts a rack in
 * order and each entry is a separate thing they did. Batching them into one
 * queued action would mean a single refusal losing every count behind it, which
 * is the failure this queue exists to prevent.
 */
export async function queueCount(stocktakeId: string, version: number, entry: CountEntry) {
  const queue = await readQueue();
  const action = createQueuedAction('stocktake', stocktakeId, 'counts', version, {
    counts: [entry],
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(addUniqueAction(queue, action)));
  return action;
}

/**
 * Send everything held, oldest first.
 *
 * Each action carries its own `version`, and the server refuses a stale one —
 * which is correct and is why a flush reports what is left rather than
 * pretending it all went. A count refused because somebody else posted the
 * sheet is a thing a person needs to be told, not a thing to retry forever.
 */
export async function syncCountQueue() {
  const queue = await readQueue();
  const result = await processQueue(queue, async (action) => {
    await apiClient.post(`/stocktakes/${action.subjectId}/${action.path}`, action.body);
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(result.remaining));
  return result;
}

/**
 * Forget the counts held for one sheet.
 *
 * Used when a sheet is abandoned: the counts are for a document that no longer
 * accepts them, and leaving them in the queue means a permanent row of failures
 * on every later flush.
 */
export async function dropCountsFor(stocktakeId: string) {
  const queue = await readQueue();
  const remaining = queue.filter(
    (action) => !(action.kind === 'stocktake' && action.subjectId === stocktakeId),
  );
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return queue.length - remaining.length;
}
