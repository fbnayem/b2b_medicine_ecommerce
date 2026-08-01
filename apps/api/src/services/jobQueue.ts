import type { Queue, Worker } from 'bullmq';

export type JobHandler<T> = (payload: T) => Promise<void>;

export interface EnqueueOptions {
  /** Stable identifier; a repeat enqueue with the same id is dropped. */
  jobId?: string;
  delayMs?: number;
}

export interface JobQueue<T> {
  readonly name: string;
  readonly driver: 'bullmq' | 'in-process';
  enqueue(payload: T, options?: EnqueueOptions): Promise<void>;
  /** Registers the processor. Calling it twice replaces the previous handler. */
  process(handler: JobHandler<T>): void;
  /** Schedules a recurring job. No-op until a handler is registered. */
  repeatEvery(schedulerId: string, everyMs: number, payload: T): Promise<void>;
  /** Resolves once every enqueued job has settled. Used by tests and shutdown. */
  drain(): Promise<void>;
  close(): Promise<void>;
}

export const JOB_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;

/** Exponential backoff shared by both drivers so retry behaviour is identical. */
export function backoffDelayMs(attempt: number, baseMs = BASE_BACKOFF_MS): number {
  return baseMs * 2 ** Math.max(0, attempt - 1);
}

/**
 * Resolves the Redis connection. `REDIS_URL` wins; otherwise the Phase 0
 * `REDIS_HOST`/`REDIS_PORT` pair is assembled, so an existing deployment gets
 * the distributed queue and Socket.IO adapter without new configuration.
 */
export function redisUrl(): string | undefined {
  const explicit = process.env.REDIS_URL?.trim();
  if (explicit) return explicit;

  const host = process.env.REDIS_HOST?.trim();
  if (!host) return undefined;
  const port = process.env.REDIS_PORT?.trim() || '6379';
  const password = process.env.REDIS_PASSWORD?.trim();
  return password
    ? `redis://:${encodeURIComponent(password)}@${host}:${port}`
    : `redis://${host}:${port}`;
}

/**
 * Runs jobs in the current process. This is not a toy fallback: it applies the
 * same attempt limit and backoff as BullMQ, and every job's terminal outcome is
 * still recorded on its NotificationDelivery row, so a single-instance
 * deployment without Redis loses nothing except cross-process distribution.
 */
class InProcessQueue<T> implements JobQueue<T> {
  readonly driver = 'in-process' as const;
  private handler: JobHandler<T> | null = null;
  private pending = new Set<Promise<void>>();
  private timers = new Set<NodeJS.Timeout>();
  private seenJobIds = new Set<string>();
  private closed = false;

  constructor(
    readonly name: string,
    /** Overridden by tests so retry coverage does not wait out real backoff. */
    private readonly baseBackoffMs = BASE_BACKOFF_MS,
  ) {}

  process(handler: JobHandler<T>) {
    this.handler = handler;
  }

  async enqueue(payload: T, options: EnqueueOptions = {}) {
    if (this.closed) return;
    if (options.jobId) {
      if (this.seenJobIds.has(options.jobId)) return;
      this.seenJobIds.add(options.jobId);
    }
    this.schedule(payload, options.delayMs ?? 0, 1);
  }

  private schedule(payload: T, delayMs: number, attempt: number) {
    const run = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.execute(payload, attempt).finally(resolve);
      }, delayMs);
      // Never hold the event loop open for a queued notification.
      timer.unref?.();
      this.timers.add(timer);
    });
    this.pending.add(run);
    void run.finally(() => this.pending.delete(run));
  }

  private async execute(payload: T, attempt: number) {
    if (!this.handler) return;
    try {
      await this.handler(payload);
    } catch (error) {
      if (attempt >= JOB_ATTEMPTS) {
        console.error(`[queue:${this.name}] job failed after ${attempt} attempts`, error);
        return;
      }
      this.schedule(payload, backoffDelayMs(attempt, this.baseBackoffMs), attempt + 1);
    }
  }

  async repeatEvery(schedulerId: string, everyMs: number, payload: T) {
    if (this.closed) return;
    const timer = setInterval(() => {
      this.schedule(payload, 0, 1);
    }, everyMs);
    timer.unref?.();
    this.timers.add(timer as unknown as NodeJS.Timeout);
  }

  async drain() {
    // Jobs can enqueue retries, so settle repeatedly until nothing is pending.
    while (this.pending.size) {
      // Snapshot first: a retry may add to the set while these are settling.
      const inFlight = Array.from(this.pending);
      await Promise.allSettled(inFlight);
    }
  }

  async close() {
    this.closed = true;
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer as unknown as NodeJS.Timeout);
    }
    this.timers.clear();
    await this.drain();
  }
}

class BullQueue<T> implements JobQueue<T> {
  readonly driver = 'bullmq' as const;
  private queue: Queue;
  private worker: Worker | null = null;
  private connectionUrl: string;

  constructor(
    readonly name: string,
    connectionUrl: string,
    // Injected so this module does not import bullmq at load time in tests.
    private readonly runtime: typeof import('bullmq'),
  ) {
    this.connectionUrl = connectionUrl;
    this.queue = new this.runtime.Queue(name, {
      connection: { url: connectionUrl },
      defaultJobOptions: {
        attempts: JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: BASE_BACKOFF_MS },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400 },
      },
    });
    this.queue.on('error', (error) => {
      console.error(`[queue:${name}] connection error`, error);
    });
  }

  process(handler: JobHandler<T>) {
    void this.worker?.close();
    this.worker = new this.runtime.Worker(
      this.name,
      async (job) => {
        await handler(job.data as T);
      },
      { connection: { url: this.connectionUrl } },
    );
    this.worker.on('failed', (job, error) => {
      console.error(`[queue:${this.name}] job ${job?.id ?? 'unknown'} failed`, error);
    });
  }

  async enqueue(payload: T, options: EnqueueOptions = {}) {
    await this.queue.add(this.name, payload, {
      jobId: options.jobId,
      delay: options.delayMs,
    });
  }

  async repeatEvery(schedulerId: string, everyMs: number, payload: T) {
    await this.queue.upsertJobScheduler(
      schedulerId,
      { every: everyMs },
      { name: this.name, data: payload },
    );
  }

  async drain() {
    // BullMQ owns job state in Redis; waiting is a worker concern, not ours.
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
  }
}

/**
 * Returns a BullMQ-backed queue when `REDIS_URL` is configured and the runtime
 * loads, otherwise the in-process queue. Failing to load Redis degrades the
 * deployment to single-instance delivery rather than dropping notifications.
 */
export function createJobQueue<T>(name: string): JobQueue<T> {
  // Tests always use the in-process driver so a broker in the developer's
  // environment cannot change what the suite exercises.
  if (process.env.NODE_ENV === 'test') return new InProcessQueue<T>(name);

  const url = redisUrl();
  if (!url) return new InProcessQueue<T>(name);

  try {
    // Required lazily so a deployment without Redis never loads the driver.
    const runtime = require('bullmq') as typeof import('bullmq');
    return new BullQueue<T>(name, url, runtime);
  } catch (error) {
    console.error(`[queue:${name}] BullMQ unavailable, using the in-process queue`, error);
    return new InProcessQueue<T>(name);
  }
}

export { InProcessQueue };
