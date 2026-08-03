import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { env } from './env';
import { errorHandler, notFoundHandler } from './middlewares/error';
import { securityHeaders } from './middlewares/securityHeaders';
import { requestContext, sanitiseRequest } from './middlewares/requestContext';
import { globalRateLimit, reportRateLimit, writeMethodRateLimit } from './middlewares/rateLimit';
import { parseQuery } from './services/requestSanitiser';
import { live, metrics, ready, version } from './controllers/healthController';
import { metricsMiddleware } from './services/metrics';
import { API_MOUNTS, type MountTier } from './routes';
import { routeCoverageRecorder } from './services/routeTable';

/** Shared with the Socket.IO handshake so both transports honour one allow-list. */
export const corsOrigins = (
  process.env.CORS_ORIGINS ?? 'http://localhost:5173,exp://localhost:8081'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const app = express();

/**
 * Middleware order is load-bearing, so it is spelled out rather than implied.
 *
 *  1. proxy trust — everything downstream that reads `req.ip` depends on it
 *  2. security headers — set before any handler can return early
 *  3. correlation context — so even a rejected request is traceable
 *  4. CORS — an origin that is not allowed should be refused cheaply
 *  5. compression, cookies, body parsing
 *  6. sanitisation — before any controller builds a query
 *  7. rate limiting — after identity is known where possible, so the budget
 *     can be keyed by user rather than by a shared address
 *  8. routes, then 404, then the error handler
 */

// Rate limiting and audit records are only as honest as `req.ip`. Express is
// told exactly how many proxies to skip rather than trusting the whole chain,
// because a trusted-by-default chain lets a caller forge their own address and
// with it their own rate-limit budget.
app.set('trust proxy', env.TRUST_PROXY_HOPS);
app.disable('x-powered-by');

// Replaces the default nested parser: see `requestSanitiser.parseQuery`.
app.set('query parser', parseQuery);

app.use(securityHeaders());
app.use(requestContext());
app.use(cors({ origin: corsOrigins, credentials: true, maxAge: 600 }));

// Reports and lists are large and repetitive; over a mobile connection this is
// the difference between a usable dashboard and a spinner. Responses already
// marked `no-transform`, and anything below a kilobyte, are left alone.
app.use(compression({ threshold: 1024 }));

app.use(cookieParser());

/**
 * Body size is tiered. Delivery proof and payment attachments are base64 inside
 * JSON and are capped at 2 MB decoded by their own validators, so those two
 * routers get a larger ceiling and everything else gets one that comfortably
 * fits the largest legitimate order. A single global limit either rejects a
 * signature photograph or lets any endpoint absorb megabytes.
 */
app.use('/api/v1/deliveries', express.json({ limit: env.UPLOAD_BODY_LIMIT }));
app.use('/api/v1/payments', express.json({ limit: env.UPLOAD_BODY_LIMIT }));
app.use(express.json({ limit: env.JSON_BODY_LIMIT }));

app.use(sanitiseRequest());

// Timing wraps everything below it, so a request is measured whether it is
// served, rejected by the rate limiter or refused by a role guard. Registered
// after the body parsers so it does not measure its own middleware.
app.use(metricsMiddleware());

// Probes must answer while the process is degraded, so they sit ahead of the
// rate limiter and are never counted against a caller's budget. `/metrics` is
// here for the same reason: a scraper needs an answer most when the process is
// unhappy, which is exactly when a rate limit would refuse it.
app.get('/health', live);
app.get('/health/ready', ready);
app.get('/health/version', version);
app.get('/metrics', metrics);

app.use(globalRateLimit());

// Under test only: records which route served each request so the coverage
// reconciliation can name the endpoints no test reaches. Registered only when
// there is something to register — Express 5 throws on `app.use([])`, so
// passing the empty production case straight through would stop the server
// booting anywhere except under test.
const coverageRecorder = routeCoverageRecorder();
if (coverageRecorder.length > 0) app.use(...coverageRecorder);

/** One limiter instance per tier, shared by every mount on that tier. */
const tierMiddleware: Record<MountTier, ReturnType<typeof writeMethodRateLimit>[]> = {
  none: [],
  write: [writeMethodRateLimit()],
  report: [reportRateLimit()],
};

/**
 * A user carrying `forcePasswordChange` may reach only the endpoints that let
 * them satisfy it. Applied once here rather than per router, because an
 * allow-list that has to be remembered on every new mount is a deny-list
 * wearing a disguise.
 */
for (const mount of API_MOUNTS) {
  app.use(mount.prefix, ...tierMiddleware[mount.tier], mount.router);
}

app.use(notFoundHandler);
app.use(errorHandler);
