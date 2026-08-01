import type Redis from 'ioredis';

/**
 * Fixed-window counters for rate limiting.
 *
 * The queue module established the pattern this follows: use Redis when it is
 * configured so that several API instances share one budget, and fall back to
 * an in-process counter that behaves identically otherwise. The fallback is not
 * a stub — a single instance is a supported deployment — but its budget is per
 * instance, which is documented rather than hidden.
 *
 * A fixed window is chosen over a sliding log because the failure mode is
 * understood and cheap: a caller can send up to twice the limit across a window
 * boundary. For protecting a login endpoint and a report aggregation from
 * abuse, that is an acceptable trade for one integer per key.
 */

export interface RateLimitHit {
  /** Requests counted in the current window, including this one. */
  count: number;
  /** When the current window ends. */
  resetAt: Date;
}

export interface RateLimitStore {
  readonly driver: 'redis' | 'memory';
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
  /** Used by tests and by the shutdown path; never during a request. */
  reset(): Promise<void>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  readonly driver = 'memory' as const;
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    this.sweep(now);

    const existing = this.windows.get(key);
    if (existing && existing.resetAt > now) {
      existing.count += 1;
      return { count: existing.count, resetAt: new Date(existing.resetAt) };
    }

    const resetAt = now + windowMs;
    this.windows.set(key, { count: 1, resetAt });
    return { count: 1, resetAt: new Date(resetAt) };
  }

  /**
   * Expired windows are dropped opportunistically. Without this a burst of
   * unique addresses would leave one map entry each until the process
   * restarted, which is a slow memory leak an attacker controls.
   */
  private sweep(now: number) {
    if (now - this.lastSweep < 30_000) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  async reset() {
    this.windows.clear();
    this.lastSweep = 0;
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  readonly driver = 'redis' as const;

  constructor(
    private readonly client: Redis,
    private readonly prefix = 'ratelimit:',
  ) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const seconds = Math.ceil(windowMs / 1000);
    const namespaced = `${this.prefix}${key}`;
    // INCR then a conditional EXPIRE: the first request in a window is the one
    // that sets the lifetime, so a long-running attack cannot keep pushing the
    // expiry forward and turn the window into a permanent block.
    const count = await this.client.incr(namespaced);
    if (count === 1) await this.client.expire(namespaced, seconds);
    const ttl = await this.client.ttl(namespaced);
    const remainingMs = ttl > 0 ? ttl * 1000 : windowMs;
    return { count, resetAt: new Date(Date.now() + remainingMs) };
  }

  async reset() {
    const keys = await this.client.keys(`${this.prefix}*`);
    if (keys.length) await this.client.del(...keys);
  }
}
