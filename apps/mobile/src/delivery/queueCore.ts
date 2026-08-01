export type DeliveryQueuedAction = {
  id: string;
  deliveryId: string;
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

export function createQueuedAction(
  deliveryId: string,
  path: string,
  version: number,
  body: Record<string, unknown> = {},
  seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`,
): DeliveryQueuedAction {
  const idempotencyKey = `mobile-${path}-${seed}`;
  return {
    id: idempotencyKey,
    deliveryId,
    path,
    body: { version, idempotencyKey, ...body },
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
}

export function addUniqueAction(queue: DeliveryQueuedAction[], action: DeliveryQueuedAction) {
  return queue.some((value) => value.id === action.id) ? queue : [...queue, action];
}

export async function processDeliveryQueue(
  queue: DeliveryQueuedAction[],
  sender: (action: DeliveryQueuedAction) => Promise<void>,
) {
  const remaining: DeliveryQueuedAction[] = [];
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
