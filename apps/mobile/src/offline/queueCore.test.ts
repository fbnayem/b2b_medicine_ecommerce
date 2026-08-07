import { describe, expect, it } from 'vitest';
import { actionsFor, addUniqueAction, createQueuedAction, processQueue } from './queueCore';

/**
 * The queue two applications share: a rider in a lane with no reception, and a
 * storekeeper counting stock between steel racking.
 *
 * **The idempotency key is the whole safety property.** A queue exists because
 * a request may not have arrived, and the only safe way to retry is for the
 * second attempt to be recognisable as the same one. Without it a flush that
 * timed out *after* the server committed confirms a delivery twice, or posts
 * fourteen counted units against a sheet as twenty-eight.
 */
describe('an action queued while there is no signal', () => {
  it('uses one stable key and ignores an exact duplicate', () => {
    const action = createQueuedAction('delivery', 'delivery-1', 'pickup', 2, {}, 'fixed-seed');
    const queue = addUniqueAction(addUniqueAction([], action), action);
    expect(queue).toHaveLength(1);
    expect(action.body.idempotencyKey).toBe('mobile-pickup-fixed-seed');
  });

  it('carries the version, so a stale handset loses rather than overwrites', () => {
    const action = createQueuedAction('stocktake', 'sheet-1', 'counts', 7, { lines: [] }, 'seed');
    expect(action.body.version).toBe(7);
  });

  it('keeps a caller-supplied field rather than being overwritten by the envelope', () => {
    // `version` and `idempotencyKey` are spread first deliberately: a caller
    // passing its own body must not be able to replace either by accident.
    const action = createQueuedAction('stocktake', 'sheet-1', 'counts', 3, { lines: [1, 2] }, 's');
    expect(action.body.lines).toEqual([1, 2]);
    expect(action.body.version).toBe(3);
  });
});

describe('flushing the queue', () => {
  it('removes what the server took and keeps what it did not', async () => {
    const first = createQueuedAction('delivery', 'delivery-1', 'pickup', 2, {}, 'one');
    const second = createQueuedAction('delivery', 'delivery-2', 'arrived', 5, {}, 'two');
    const result = await processQueue([first, second], async (action) => {
      if (action.subjectId === 'delivery-2') throw new Error('offline');
    });
    expect(result.synced).toBe(1);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0]?.attempts).toBe(1);
    expect(result.remaining[0]?.lastError).toBe('offline');
  });

  it('does not let one refusal hold up everything behind it', async () => {
    /*
     * An hour of counting is fourteen queued lines. If the third is refused —
     * a sheet somebody else has already posted — the other thirteen must still
     * go, and the one that is stuck must keep its own message so the screen can
     * say which line rather than "sync failed".
     */
    const lines = Array.from({ length: 5 }, (_, index) =>
      createQueuedAction('stocktake', 'sheet-1', 'counts', 1, { line: index }, `seed-${index}`),
    );
    const result = await processQueue(lines, async (action) => {
      if (action.body.line === 2) throw new Error('That count sheet has been posted');
    });

    expect(result.synced).toBe(4);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0]?.lastError).toBe('That count sheet has been posted');
  });

  it('sends each queued action exactly once', async () => {
    // The property the idempotency key is there to make safe, asserted at the
    // level below it: a flush must not offer the same action to the sender
    // twice, whatever the sender does with it.
    const sent: string[] = [];
    const lines = ['a', 'b', 'c'].map((seed) =>
      createQueuedAction('stocktake', 'sheet-1', 'counts', 1, {}, seed),
    );
    await processQueue(lines, async (action) => {
      sent.push(action.id);
    });
    expect(sent).toEqual(['mobile-counts-a', 'mobile-counts-b', 'mobile-counts-c']);
    expect(new Set(sent).size).toBe(3);
  });

  it('leaves an empty queue empty rather than reporting work it did not do', async () => {
    expect(await processQueue([], async () => undefined)).toEqual({ remaining: [], synced: 0 });
  });
});

describe('one subject’s share of a shared queue', () => {
  it('separates a rider’s deliveries from a storekeeper’s count sheets', () => {
    /*
     * One queue holds both kinds, because one build holds both applications'
     * screens. A count sheet showing "3 waiting to send" that included a
     * delivery would be counting somebody else's work.
     */
    const queue = [
      createQueuedAction('delivery', 'delivery-1', 'pickup', 1, {}, 'a'),
      createQueuedAction('stocktake', 'sheet-1', 'counts', 1, {}, 'b'),
      createQueuedAction('stocktake', 'sheet-2', 'counts', 1, {}, 'c'),
      createQueuedAction('stocktake', 'sheet-1', 'counts', 1, {}, 'd'),
    ];

    expect(actionsFor(queue, 'stocktake', 'sheet-1')).toHaveLength(2);
    expect(actionsFor(queue, 'delivery', 'delivery-1')).toHaveLength(1);
    expect(actionsFor(queue, 'delivery', 'sheet-1')).toHaveLength(0);
  });
});
