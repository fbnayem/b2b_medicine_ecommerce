import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { env } from '../env';
import { rateLimitStore } from '../middlewares/rateLimit';
import { realtimeDriver } from '../services/realtime';
import { notificationQueue } from '../services/notificationService';
import { renderPrometheus } from '../services/metrics';

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

  // `ping` is deliberately not the probe. MongoDB answers it without requiring
  // authentication, and the driver's handshake does not need credentials
  // either, so a deployment whose password is wrong or missing connects
  // cleanly, reports readyState 1, answers ping — and then fails every single
  // query with "requires authentication". This endpoint would return 200, the
  // orchestrator would route traffic to it, and every request would 500.
  //
  // `listCollections` needs the same authorisation the application needs to do
  // its job, so it fails exactly when the application is about to.
  let usable = false;
  if (state === 1) {
    try {
      await mongoose.connection.db?.listCollections().toArray();
      usable = true;
    } catch {
      usable = false;
    }
  }

  const ok = database === 'up' && usable;
  // Connected-but-unusable is its own state and needs its own word. Reporting
  // "up" next to "not-ready" sends whoever is paged looking at the network,
  // when the answer is almost always a credential.
  const check = ok ? 'up' : database === 'up' ? 'unauthorised' : database;
  res.status(ok ? 200 : 503).json({
    data: {
      status: ok ? 'ready' : 'not-ready',
      checks: { database: check },
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

/**
 * Prometheus exposition.
 *
 * Mounted alongside the probes rather than under `/api/v1/admin`, because a
 * scraper cannot sign in and giving one a service account with administrative
 * rights would be a far larger grant than reading counters. It is guarded by a
 * bearer token instead, and refused outright in production when no token is
 * configured — the series include the ledger-imbalance gauge, and that is not
 * something to serve to anyone who can reach the port.
 */
export const metrics = async (req: Request, res: Response) => {
  if (!env.METRICS_TOKEN && env.NODE_ENV === 'production') {
    return res.status(404).end();
  }
  if (env.METRICS_TOKEN) {
    const presented = req.header('authorization') ?? '';
    const expected = `Bearer ${env.METRICS_TOKEN}`;
    // Compared at constant length so a wrong token cannot be found byte by byte.
    const ok =
      presented.length === expected.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
    if (!ok) return res.status(401).end();
  }

  const queue = await notificationQueue().counts();
  res
    .type('text/plain; version=0.0.4; charset=utf-8')
    .send(await renderPrometheus({ queueDepth: queue.waiting, queueFailed: queue.failed }));
};
