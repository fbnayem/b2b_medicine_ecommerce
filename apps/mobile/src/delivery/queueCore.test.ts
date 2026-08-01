import { describe, expect, it } from 'vitest';
import { addUniqueAction, createQueuedAction, processDeliveryQueue } from './queueCore';

describe('delivery offline action queue', () => {
  it('uses one stable idempotency key and ignores an exact duplicate', () => {
    const action = createQueuedAction('delivery-1', 'pickup', 2, {}, 'fixed-seed');
    const queue = addUniqueAction(addUniqueAction([], action), action);
    expect(queue).toHaveLength(1);
    expect(action.body.idempotencyKey).toBe('mobile-pickup-fixed-seed');
  });

  it('removes server-confirmed actions and keeps failed actions for retry', async () => {
    const first = createQueuedAction('delivery-1', 'pickup', 2, {}, 'one');
    const second = createQueuedAction('delivery-2', 'arrived', 5, {}, 'two');
    const result = await processDeliveryQueue([first, second], async (action) => {
      if (action.deliveryId === 'delivery-2') throw new Error('offline');
    });
    expect(result.synced).toBe(1);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0]?.attempts).toBe(1);
    expect(result.remaining[0]?.lastError).toBe('offline');
  });
});
