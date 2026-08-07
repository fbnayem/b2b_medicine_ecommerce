import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Delivery, DeliveryProofType } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { canCompleteOffline } from '../offline/completion';
import { readProof, releaseProof, type HeldFile } from '../offline/proofFiles';
import {
  addUniqueAction,
  createQueuedAction,
  processQueue,
  type QueuedAction,
} from '../offline/queueCore';
import { isDeliveryStep, sendDeliveryStep } from './actions';

const CACHE_KEY = 'medsupply.delivery.assigned.v1';
const QUEUE_KEY = 'medsupply.delivery.actions.v1';
const SAFE_OFFLINE_PATHS = new Set([
  'handover',
  'acknowledge',
  'pickup',
  'start',
  'arrived',
  'fail',
  'returning',
  'returned',
]);

export function isSafeOfflineDeliveryAction(path: string) {
  return SAFE_OFFLINE_PATHS.has(path);
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const value = await AsyncStorage.getItem(key);
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function cacheAssignedDeliveries(deliveries: Delivery[]) {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(deliveries));
}

export function loadCachedDeliveries() {
  return readJson<Delivery[]>(CACHE_KEY, []);
}

export function loadDeliveryQueue() {
  return readJson<QueuedAction[]>(QUEUE_KEY, []);
}

export async function queueDeliveryAction(
  deliveryId: string,
  path: string,
  version: number,
  body: Record<string, unknown> = {},
) {
  if (!isSafeOfflineDeliveryAction(path)) {
    throw new Error('This action requires an immediate server confirmation');
  }
  const queue = await loadDeliveryQueue();
  const action = createQueuedAction('delivery', deliveryId, path, version, body);
  const next = addUniqueAction(queue, action);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  return action;
}

/**
 * A finished delivery, held until there is signal.
 *
 * The photograph, signature and payment slip are already on disk; what goes into
 * the queue is where they are. `deliveredAt` is stamped **here**, at the door,
 * because that is the fact the record needs — without it the server dates the
 * delivery, and the cash, to whenever the handset next found a bar of signal.
 */
export async function queueCompletion(
  delivery: { _id: string; version: number; proofRequirements: readonly DeliveryProofType[] },
  body: Record<string, unknown>,
  files: { photo?: HeldFile; signature?: HeldFile; payment?: HeldFile },
) {
  if (!canCompleteOffline(delivery.proofRequirements)) {
    throw new Error('This delivery needs a code the server has to send');
  }
  const queue = await loadDeliveryQueue();
  const action = createQueuedAction('completion', delivery._id, 'complete', delivery.version, {
    ...body,
    deliveredAt: new Date().toISOString(),
    files,
  });
  const next = addUniqueAction(queue, action);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  return action;
}

/** Put the held files back into the body the server expects. */
async function withProof(body: Record<string, unknown>) {
  const files = (body.files ?? {}) as {
    photo?: HeldFile;
    signature?: HeldFile;
    payment?: HeldFile;
  };
  const { files: _held, ...rest } = body;
  return {
    ...rest,
    photograph: files.photo ? await readProof(files.photo) : undefined,
    signature: files.signature ? await readProof(files.signature) : undefined,
    paymentProof: files.payment ? await readProof(files.payment) : undefined,
  };
}

export async function syncDeliveryQueue() {
  const queue = await loadDeliveryQueue();
  const result = await processQueue(queue, async (action) => {
    if (action.kind === 'completion') {
      /*
       * The one call in this file that is not a step: `complete` takes a body
       * this queue assembled hours ago, and it is the only queued action that
       * moves money.
       *
       * The idempotency key was minted when the rider tapped Confirm and is
       * stored with the action, so a flush that times out after the server
       * committed cannot post the collection twice. The files are released only
       * once the server has answered.
       */
      await apiClient.post(
        `/deliveries/${action.subjectId}/complete`,
        await withProof(action.body),
      );
      const files = (action.body.files ?? {}) as Record<string, HeldFile | undefined>;
      Object.values(files).forEach(releaseProof);
      return;
    }
    /*
     * Through the step table rather than assembling the path here, which is what
     * this used to do. A step written to disk by an older build and since
     * removed would otherwise be posted to an endpoint that no longer exists,
     * over and over, with no way for the rider to clear it.
     */
    if (!isDeliveryStep(action.path)) {
      throw new Error(`This version no longer knows the step "${action.path}"`);
    }
    await sendDeliveryStep(action.path, action.subjectId, action.body);
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(result.remaining));
  return result;
}
