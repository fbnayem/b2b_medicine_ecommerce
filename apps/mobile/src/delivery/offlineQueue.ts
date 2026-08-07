import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Delivery } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import {
  addUniqueAction,
  createQueuedAction,
  processQueue,
  type QueuedAction,
} from '../offline/queueCore';

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
    await apiClient.post(`/deliveries/${action.subjectId}/${action.path}`, action.body);
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(result.remaining));
  return result;
}
