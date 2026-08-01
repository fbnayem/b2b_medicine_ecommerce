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
import { live, ready, version } from './controllers/healthController';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import shopRoutes from './routes/shopRoutes';
import inventoryRoutes from './routes/inventoryRoutes';
import orderRoutes from './routes/orderRoutes';
import approvalRoutes from './routes/approvalRoutes';
import fulfilmentRoutes from './routes/fulfilmentRoutes';
import deliveryRoutes from './routes/deliveryRoutes';
import paymentRoutes from './routes/paymentRoutes';
import financeRoutes from './routes/financeRoutes';
import notificationRoutes from './routes/notificationRoutes';
import activityRoutes from './routes/activityRoutes';
import settingsRoutes from './routes/settingsRoutes';
import adminRoutes from './routes/adminRoutes';
import returnRoutes from './routes/returnRoutes';
import reportRoutes from './routes/reportRoutes';
import docsRoutes from './routes/docsRoutes';

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

// Probes must answer while the process is degraded, so they sit ahead of the
// rate limiter and are never counted against a caller's budget.
app.get('/health', live);
app.get('/health/ready', ready);
app.get('/health/version', version);

app.use(globalRateLimit());

app.use('/api/v1/docs', docsRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', writeMethodRateLimit(), userRoutes);
app.use('/api/v1/shops', writeMethodRateLimit(), shopRoutes);
app.use('/api/v1/inventory', writeMethodRateLimit(), inventoryRoutes);
app.use('/api/v1/orders', writeMethodRateLimit(), orderRoutes);
app.use('/api/v1/approvals', writeMethodRateLimit(), approvalRoutes);
app.use('/api/v1/fulfilment', writeMethodRateLimit(), fulfilmentRoutes);
app.use('/api/v1/deliveries', writeMethodRateLimit(), deliveryRoutes);
app.use('/api/v1/payments', writeMethodRateLimit(), paymentRoutes);
app.use('/api/v1/finance', financeRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/activity', activityRoutes);
app.use('/api/v1/settings', writeMethodRateLimit(), settingsRoutes);
app.use('/api/v1/admin', writeMethodRateLimit(), adminRoutes);
app.use('/api/v1/returns', writeMethodRateLimit(), returnRoutes);
// Every report recomputes from source records, so these are the most expensive
// reads in the system and carry their own budget.
app.use('/api/v1/reports', reportRateLimit(), reportRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
