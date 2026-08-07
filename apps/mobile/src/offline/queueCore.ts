/**
 * Work done on a handset that has no signal, held until it does.
 *
 * This began as the rider's queue and was `delivery/queueCore.ts`. It is now
 * shared with stock counting, because the two are the same problem in different
 * buildings: a rider is in a lane and a storekeeper is between steel racking,
 * and both are recording something they can see in front of them against a
 * server they cannot reach.
 *
 * **No `AsyncStorage` in here.** Where a queue is kept is a decision for the
 * module that owns the queue — `delivery/offlineQueue.ts` and
 * `warehouse/countQueue.ts` each keep their own key — and keeping storage out
 * means the arithmetic can be tested with no device and no mocking.
 */

export type QueueKind = 'delivery' | 'stocktake';

export type QueuedAction = {
  /** The idempotency key, which is also what makes an action unique here. */
  id: string;
  kind: QueueKind;
  /** What the action is about: a delivery, or a count sheet. */
  subjectId: string;
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

/**
 * One queued action, carrying the key that makes sending it twice harmless.
 *
 * **The idempotency key is the whole safety property.** A queue exists because
 * a request may not have arrived; the only way to retry safely is for the
 * second attempt to be recognisable as the same one. Without it a flush that
 * timed out after the server committed would count a delivery twice, or post a
 * count line twice against a sheet.
 */
export function createQueuedAction(
  kind: QueueKind,
  subjectId: string,
  path: string,
  version: number,
  body: Record<string, unknown> = {},
  seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`,
): QueuedAction {
  const idempotencyKey = `mobile-${path}-${seed}`;
  return {
    id: idempotencyKey,
    kind,
    subjectId,
    path,
    body: { version, idempotencyKey, ...body },
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
}

export function addUniqueAction(queue: QueuedAction[], action: QueuedAction) {
  return queue.some((value) => value.id === action.id) ? queue : [...queue, action];
}

/**
 * Send what can be sent; keep what cannot, with the attempt counted.
 *
 * Failures do not stop the flush. One line that the server refuses — a count
 * against a sheet somebody else has already posted — must not hold up the
 * fourteen behind it, and it keeps its own error so the screen can say which
 * one is stuck rather than "sync failed".
 */
export async function processQueue(
  queue: QueuedAction[],
  sender: (action: QueuedAction) => Promise<void>,
) {
  const remaining: QueuedAction[] = [];
  let synced = 0;
  for (const action of queue) {
    try {
      await sender(action);
      synced += 1;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Sync failed';
      remaining.push({ ...action, attempts: action.attempts + 1, lastError: message });
    }
  }
  return { remaining, synced };
}

/** The actions belonging to one subject, for a screen that shows only its own. */
export function actionsFor(queue: readonly QueuedAction[], kind: QueueKind, subjectId: string) {
  return queue.filter((action) => action.kind === kind && action.subjectId === subjectId);
}
