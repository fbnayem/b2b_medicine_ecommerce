import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Delivery } from '@medsupply/shared-types';
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

export async function syncDeliveryQueue() {
  const queue = await loadDeliveryQueue();
  const result = await processQueue(queue, async (action) => {
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
