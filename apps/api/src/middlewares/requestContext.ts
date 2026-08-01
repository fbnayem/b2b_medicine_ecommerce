import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger, runWithContext, type RequestContext } from '../services/logger';
import { sanitiseValue } from '../services/requestSanitiser';
import type { AuthRequest } from './auth';

/** Header used to carry a correlation identifier in and back out again. */
export const CORRELATION_HEADER = 'x-request-id';

/** Bounded and character-checked: this value ends up in logs and audit records. */
const SAFE_CORRELATION = /^[\w-]{8,64}$/;

/**
 * Establishes the per-request context.
 *
 * Every log line, audit record and error response written while handling a
 * request carries the same correlation identifier, so a customer reporting a
 * failure can be traced from the response they saw to the exact database write
 * that did or did not happen. An identifier supplied by a caller is honoured
 * when it is well formed, which lets a load balancer or the web client join its
 * own traces to ours, and is replaced otherwise.
 */
export function requestContext() {
  return (req: Request, res: Response, next: NextFunction) => {
    const supplied = req.get(CORRELATION_HEADER);
    const correlationId = supplied && SAFE_CORRELATION.test(supplied) ? supplied : randomUUID();

    res.setHeader(CORRELATION_HEADER, correlationId);

    const context: RequestContext = {
      correlationId,
      method: req.method,
      path: req.path,
      ip: req.ip,
    };

    runWithContext(context, () => {
      const startedAt = process.hrtime.bigint();
      res.on('finish', () => {
        // The user is attached by `requireAuth`, which runs inside this scope,
        // so by the time the response finishes the context knows who acted.
        const user = (req as AuthRequest).user;
        if (user) {
          context.userId = String(user.id ?? '');
          context.role = String(user.role ?? '');
        }
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const line = { status: res.statusCode, durationMs: Math.round(durationMs) };
        if (res.statusCode >= 500) logger.error('Request failed', line);
        else if (res.statusCode >= 400) logger.warn('Request rejected', line);
        else logger.info('Request completed', line);
      });
      next();
    });
  };
}

/**
 * Strips operator and prototype keys from the request before any controller
 * builds a database query out of it. See `requestSanitiser` for the rules and
 * why removal beats rejection.
 *
 * `req.query` is replaced by the custom parser registered on the application,
 * so only the body and route parameters are rewritten here.
 */
export function sanitiseRequest() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const removed: string[] = [];

    if (req.body && typeof req.body === 'object') {
      const result = sanitiseValue(req.body);
      req.body = result.value;
      removed.push(...result.removed.map((path) => `body.${path}`));
    }

    for (const key of Object.keys(req.params)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete req.params[key];
        removed.push(`params.${key}`);
      }
    }

    if (removed.length) {
      logger.warn('Removed unsafe request keys', { keys: removed.slice(0, 10) });
    }

    next();
  };
}
