import { describe, expect, it, vi } from 'vitest';
import { DeliveryProofType } from '@medsupply/shared-types';
import { canCompleteOffline, completionRefusal } from './completion';

/**
 * **A delivery can be finished where there is no signal, and the one that cannot
 * says so at the door.**
 *
 * The queue held every cheap status tap — picked up, started, arrived, failed —
 * and refused `complete`, which is the one that ends the stop, carries the
 * photograph and the signature, and may carry cash. A rider standing at a
 * counter with somebody waiting was told to keep the screen open and try again.
 */
describe('finishing a delivery away from signal', () => {
  it('is allowed when the proof is things the handset can produce', () => {
    // A signature is drawn on the glass, a photograph is taken by the camera,
    // and **GPS is not network** — satellites do not need a cell tower, so
    // location proof is as honest offline as on.
    expect(
      canCompleteOffline([
        DeliveryProofType.SIGNATURE,
        DeliveryProofType.PHOTOGRAPH,
        DeliveryProofType.GPS,
      ]),
    ).toBe(true);
    expect(canCompleteOffline([])).toBe(true);
  });

  it('is refused when the proof is a code only the server knows', () => {
    /*
     * The six digits were sent to the customer's phone and are checked against
     * a hash the handset has never seen. A completion queued without them would
     * be rejected on flush, hours later, with the rider long gone from the shop
     * — so the refusal has to happen while somebody can still act on it.
     */
    expect(canCompleteOffline([DeliveryProofType.OTP])).toBe(false);
    expect(completionRefusal([DeliveryProofType.OTP, DeliveryProofType.GPS])).toBe(
      'delivery.otpNeedsSignal',
    );
  });

  it('names the reason as a catalogue key rather than a sentence', () => {
    // The message a rider reads is the one part of this that must not be
    // English-only, which is the defect `delivery.rejected` and the four
    // collection errors were corrected for.
    expect(completionRefusal([])).toBeNull();
    expect(completionRefusal([DeliveryProofType.OTP])).toMatch(/^delivery\./);
  });
});

/**
 * The queue itself, driven through `AsyncStorage` and the API client rather than
 * around them — the safety property being tested is that **a flush which times
 * out after the server committed does not post the cash twice**, and that only
 * shows up in what is actually sent.
 */
describe('a completion held until there is signal', () => {
  async function harness() {
    const store = new Map<string, string>();
    vi.doMock('@react-native-async-storage/async-storage', () => ({
      default: {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => void store.set(key, value),
      },
    }));

    const posted: Array<{ path: string; body: Record<string, unknown> }> = [];
    let failNext = false;
    vi.doMock('../api/client', () => ({
      apiClient: {
        post: async (path: string, body: Record<string, unknown>) => {
          if (failNext) throw new Error('no signal');
          posted.push({ path, body });
          return { data: { data: {} } };
        },
      },
    }));

    const held = new Map<string, string>();
    vi.doMock('./proofFiles', () => ({
      holdProof: (reference: string, kind: string, data: string) => {
        const uri = `file:///proof/${reference}-${kind}`;
        held.set(uri, data);
        return { uri, fileName: `${reference}-${kind}.jpg`, mimeType: 'image/jpeg' };
      },
      readProof: async (file: { uri: string; fileName: string; mimeType: string }) =>
        held.has(file.uri)
          ? { fileName: file.fileName, mimeType: file.mimeType, base64Data: held.get(file.uri) }
          : undefined,
      releaseProof: (file?: { uri: string }) => {
        if (file) held.delete(file.uri);
      },
    }));

    const queue = await import('../delivery/offlineQueue');
    return { queue, posted, held, offline: (value: boolean) => (failNext = value) };
  }

  const DELIVERY = { _id: 'delivery-1', version: 4, proofRequirements: [] as never[] };

  it('sends exactly once under the key minted at the door', async () => {
    vi.resetModules();
    const { queue, posted, offline } = await harness();

    await queue.queueCompletion(
      DELIVERY,
      { idempotencyKey: 'at-the-door', receiverName: 'Rahim', collectedAmountMinor: 250_000 },
      {},
    );

    // The first flush fails the way a cellular round actually fails.
    offline(true);
    const first = await queue.syncDeliveryQueue();
    expect(first.synced).toBe(0);
    expect(first.remaining).toHaveLength(1);

    offline(false);
    const second = await queue.syncDeliveryQueue();
    expect(second.synced).toBe(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.path).toBe('/deliveries/delivery-1/complete');
    expect(posted[0]?.body.idempotencyKey).toBe('at-the-door');
    expect(posted[0]?.body.collectedAmountMinor).toBe(250_000);

    // And the queue is empty, so a third flush cannot post the cash again.
    await queue.syncDeliveryQueue();
    expect(posted).toHaveLength(1);
  });

  it('records when the rider finished, not when the signal came back', async () => {
    vi.resetModules();
    const { queue, posted, offline } = await harness();

    const at = new Date('2026-08-07T08:22:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(at);
    await queue.queueCompletion(DELIVERY, { idempotencyKey: 'k1' }, {});
    // Two hours down a lane with no reception.
    vi.setSystemTime(new Date('2026-08-07T10:05:00.000Z'));
    vi.useRealTimers();

    offline(false);
    await queue.syncDeliveryQueue();
    expect(posted[0]?.body.deliveredAt).toBe(at.toISOString());
  });

  it('carries the photograph by where it is, not by putting it in the queue', async () => {
    vi.resetModules();
    const { queue, posted, held, offline } = await harness();
    const proofFiles = await import('./proofFiles');

    const photo = proofFiles.holdProof('DEL-2026-000001', 'photo', 'AAAAphoto', 'image/jpeg');
    await queue.queueCompletion(DELIVERY, { idempotencyKey: 'k2' }, { photo });

    /*
     * What `AsyncStorage` holds is the path. A delivery photograph is a few
     * hundred kilobytes of base64, and a rider with four unsent stops writing
     * all of it into one SQLite row is how a queue starts silently failing.
     */
    const queued = await queue.loadDeliveryQueue();
    expect(JSON.stringify(queued)).not.toContain('AAAAphoto');
    expect(JSON.stringify(queued)).toContain('file:///proof/');

    offline(false);
    await queue.syncDeliveryQueue();
    // ...and what reaches the server is the bytes.
    const sent = posted[0]!.body.photograph as { base64Data: string };
    expect(sent.base64Data).toBe('AAAAphoto');
    // Released only once the server has answered.
    expect(held.size).toBe(0);
  });

  it('keeps the files while the server has not answered', async () => {
    vi.resetModules();
    const { queue, held, offline } = await harness();
    const proofFiles = await import('./proofFiles');

    const photo = proofFiles.holdProof('DEL-2026-000002', 'photo', 'BBBBphoto', 'image/jpeg');
    await queue.queueCompletion(DELIVERY, { idempotencyKey: 'k3' }, { photo });

    offline(true);
    await queue.syncDeliveryQueue();
    // The evidence outlives the failed attempt, which is the entire point of
    // writing it to `Paths.document` rather than the cache.
    expect(held.size).toBe(1);
  });

  it('refuses to hold a delivery whose proof is a code from the server', async () => {
    vi.resetModules();
    const { queue } = await harness();

    await expect(
      queue.queueCompletion(
        { ...DELIVERY, proofRequirements: [DeliveryProofType.OTP] as never[] },
        { idempotencyKey: 'k4' },
        {},
      ),
    ).rejects.toThrow(/code/);
  });
});
