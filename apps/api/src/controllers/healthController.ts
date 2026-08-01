import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { env } from '../env';
import { rateLimitStore } from '../middlewares/rateLimit';
import { realtimeDriver } from '../services/realtime';
import { notificationQueue } from '../services/notificationService';

/**
 * Liveness, readiness and build identity.
 *
 * These are split because an orchestrator asks two different questions. "Is the
 * process alive?" must not fail because the database is briefly unreachable, or
 * the container gets restarted for a fault it would have recovered from. "Is it
 * ready for traffic?" must fail in exactly that case, so the instance is taken
 * out of the load balancer instead of answering with errors.
 *
 * Neither is authenticated, because a probe cannot sign in, so neither returns
 * anything an attacker could use: no hostnames, no versions of dependencies, no
 * connection strings.
 */

const READY_STATES = new Set([1, 2]); // connected, connecting

export const live = (_req: Request, res: Response) => {
  res.json({ data: { status: 'ok', service: 'api' } });
};

export const ready = async (_req: Request, res: Response) => {
  const state = mongoose.connection.readyState;
  const database = state === 1 ? 'up' : READY_STATES.has(state) ? 'connecting' : 'down';

  let ping = false;
  if (state === 1) {
    try {
      await mongoose.connection.db?.admin().ping();
      ping = true;
    } catch {
      ping = false;
    }
  }

  const ok = database === 'up' && ping;
  res.status(ok ? 200 : 503).json({
    data: {
      status: ok ? 'ready' : 'not-ready',
      checks: { database: ok ? 'up' : database },
    },
  });
};

/**
 * Build identity, for confirming what is actually deployed. The version and
 * commit are supplied by the build; nothing here is derived from the runtime.
 */
export const version = (_req: Request, res: Response) => {
  res.json({
    data: {
      service: 'api',
      version: env.APP_VERSION,
      commit: env.GIT_COMMIT,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.floor(process.uptime()),
    },
  });
};

/**
 * The effective runtime posture, for an administrator confirming that a
 * deployment is configured the way they believe it is. Signed in and restricted
 * to the privileged roles by the route, and limited to whether a protection is
 * on and how it is tuned — never to a secret.
 */
export const runtimeStatus = (_req: Request, res: Response) => {
  res.json({
    data: {
      version: env.APP_VERSION,
      commit: env.GIT_COMMIT,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        state:
          ['disconnected', 'connected', 'connecting', 'disconnecting'][
            mongoose.connection.readyState
          ] ?? 'unknown',
        maxPoolSize: env.DB_MAX_POOL_SIZE,
        queryTimeoutMs: env.DB_QUERY_TIMEOUT_MS,
      },
      realtime: { driver: realtimeDriver() },
      notifications: { driver: notificationQueue().driver },
      rateLimit: {
        driver: rateLimitStore().driver,
        windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
        global: env.RATE_LIMIT_GLOBAL_MAX,
        auth: env.RATE_LIMIT_AUTH_MAX,
        write: env.RATE_LIMIT_WRITE_MAX,
        report: env.RATE_LIMIT_REPORT_MAX,
      },
      tokens: {
        accessTokenMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
        refreshTokenDays: env.REFRESH_TOKEN_TTL_DAYS,
        dedicatedRefreshSecret: Boolean(env.REFRESH_TOKEN_SECRET),
      },
      request: {
        trustProxyHops: env.TRUST_PROXY_HOPS,
        jsonBodyLimit: env.JSON_BODY_LIMIT,
        uploadBodyLimit: env.UPLOAD_BODY_LIMIT,
      },
    },
  });
};
