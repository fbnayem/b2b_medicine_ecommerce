import type { NextFunction, Request, Response } from 'express';
import { env } from '../env';
import { correlationId, logger } from '../services/logger';
import { redisUrl } from '../services/jobQueue';
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
} from '../services/rateLimitStore';
import type { AuthRequest } from './auth';

/**
 * Tiered rate limiting.
 *
 * One global budget is not enough. A shop owner refreshing an order list and an
 * attacker guessing passwords look identical to a single counter, so the limit
 * that stops the attacker also stops the shop owner. Instead each tier gets a
 * budget matched to what it costs and what it protects:
 *
 *   auth    - small, because these are the endpoints worth guessing at
 *   write   - moderate, because a write costs a transaction
 *   report  - moderate, because an aggregation costs database time
 *   global  - generous, a backstop against a client stuck in a loop
 *
 * Authenticated callers are keyed by user, so one shop behind a shared office
 * address cannot exhaust the budget of another, and an attacker cannot spend
 * a victim's budget by spoofing nothing more than an address.
 */

let store: RateLimitStore | null = null;

export function rateLimitStore(): RateLimitStore {
  if (store) return store;
  const url = redisUrl();
  if (url) {
    try {
      // Required lazily so a deployment without Redis never loads the driver.
      const Redis = require('ioredis') as typeof import('ioredis');
      store = new RedisRateLimitStore(new Redis.default(url, { maxRetriesPerRequest: 2 }));
      logger.info('Rate limiting is using the shared Redis store');
      return store;
    } catch (error) {
      logger.warn('Redis rate-limit store unavailable; using the per-instance store', {
        reason: (error as Error).message,
      });
    }
  }
  store = new MemoryRateLimitStore();
  return store;
}

/** Replaces the store. Tests use this; production never calls it. */
export function setRateLimitStore(replacement: RateLimitStore | null) {
  store = replacement;
}

export interface RateLimitOptions {
  /** Appears in the key so tiers cannot spend each other's budget. */
  tier: string;
  max: number;
  windowMs?: number;
  /** Skips counting for responses that were not the caller's fault. */
  skipSuccessful?: boolean;
}

function callerKey(req: Request): string {
  const user = (req as AuthRequest).user;
  if (user?.id) return `user:${String(user.id)}`;
  // `req.ip` is only meaningful once TRUST_PROXY_HOPS matches the deployment;
  // with the default of zero it is the socket address, which cannot be forged.
  return `ip:${req.ip ?? 'unknown'}`;
}

export function rateLimit(options: RateLimitOptions) {
  const windowMs = (options.windowMs ?? env.RATE_LIMIT_WINDOW_SECONDS * 1000) | 0;
  const { max, tier } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    let hit;
    try {
      hit = await rateLimitStore().hit(`${tier}:${callerKey(req)}`, windowMs);
    } catch (error) {
      // A rate limiter that fails closed turns a Redis blip into an outage.
      // The event is logged loudly instead.
      logger.error('Rate limit store failed; allowing the request', {
        reason: (error as Error).message,
      });
      return next();
    }

    const remaining = Math.max(0, max - hit.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader(
      'RateLimit-Reset',
      String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)),
    );

    if (hit.count > max) {
      const retryAfter = Math.max(1, Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      logger.warn('Rate limit exceeded', { tier, count: hit.count, max });
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Try again in ${retryAfter} seconds.`,
          correlationId: correlationId(),
        },
      });
    }

    next();
  };
}

/** Sign-in, refresh and anything else worth guessing at. */
export const authRateLimit = () => rateLimit({ tier: 'auth', max: env.RATE_LIMIT_AUTH_MAX });

/** Business actions that open a transaction. */
export const writeRateLimit = () => rateLimit({ tier: 'write', max: env.RATE_LIMIT_WRITE_MAX });

/** Aggregations that recompute from source records. */
export const reportRateLimit = () => rateLimit({ tier: 'report', max: env.RATE_LIMIT_REPORT_MAX });

/**
 * Backstop applied to everything. Read endpoints are exempt from the narrower
 * tiers, so this is what keeps a runaway client from saturating the process.
 */
export const globalRateLimit = () => rateLimit({ tier: 'global', max: env.RATE_LIMIT_GLOBAL_MAX });

/** Applies the write tier only to state-changing verbs on a router. */
export function writeMethodRateLimit() {
  const limiter = writeRateLimit();
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    return limiter(req, res, next);
  };
}
