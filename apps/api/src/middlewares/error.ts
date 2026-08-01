import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { isProduction } from '../env';
import { correlationId, logger } from '../services/logger';

/** Shape every failure is reported in, so clients only parse one thing. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    correlationId?: string;
    details?: unknown;
  };
}

interface AppError {
  statusCode?: number;
  status?: number;
  code?: string | number;
  message?: string;
  type?: string;
  keyPattern?: Record<string, unknown>;
  stack?: string;
}

/** Unknown routes get the same JSON envelope as everything else. */
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route matches ${req.method} ${req.path}`,
      correlationId: correlationId(),
    },
  } satisfies ErrorBody);
};

/**
 * Terminal error handler.
 *
 * Two rules govern what reaches the caller. Anything the caller can act on —
 * a validation problem, a duplicate, a refused transition — keeps its message,
 * because hiding it just produces a support ticket. Anything else is reported
 * as an internal failure with a correlation identifier and nothing more: an
 * unexpected exception's message routinely contains a database hostname, a
 * file path or a fragment of the query that failed, and none of that is the
 * caller's business.
 *
 * The full detail is logged, redacted, against the same correlation identifier.
 */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (res.headersSent) {
    // A failure after streaming has begun cannot be turned into a JSON body;
    // handing it back to Express lets the connection be closed cleanly.
    next(err);
    return;
  }

  const reference = correlationId();
  const error = (err ?? {}) as AppError;

  if (err instanceof z.ZodError) {
    logger.warn('Request failed validation', { issues: err.issues.length });
    res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid input data',
        correlationId: reference,
        // Paths and reasons only. Zod echoes the received value in some issue
        // types, and a rejected body can hold a password or a token.
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      },
    } satisfies ErrorBody);
    return;
  }

  if (error.code === 11000) {
    logger.warn('Duplicate key rejected', { keys: Object.keys(error.keyPattern ?? {}) });
    res.status(409).json({
      error: {
        code: 'DUPLICATE',
        message: 'A record with this unique value already exists',
        correlationId: reference,
      },
    } satisfies ErrorBody);
    return;
  }

  // body-parser rejects an oversized or malformed body with its own status.
  if (error.type === 'entity.too.large') {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is larger than this endpoint accepts',
        correlationId: reference,
      },
    } satisfies ErrorBody);
    return;
  }
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({
      error: {
        code: 'MALFORMED_JSON',
        message: 'The request body is not valid JSON',
        correlationId: reference,
      },
    } satisfies ErrorBody);
    return;
  }

  const statusCode = error.statusCode ?? error.status;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    // Deliberate, domain-level refusals. These messages are written for the
    // person reading them and are safe to return verbatim.
    logger.warn('Request refused', { statusCode, code: error.code });
    res.status(statusCode).json({
      error: {
        code: typeof error.code === 'string' ? error.code : 'REQUEST_FAILED',
        message: error.message ?? 'The request could not be completed',
        correlationId: reference,
      },
    } satisfies ErrorBody);
    return;
  }

  logger.error('Unhandled error', {
    message: error.message,
    code: error.code,
    statusCode,
    stack: isProduction ? undefined : error.stack,
  });

  res.status(typeof statusCode === 'number' && statusCode >= 500 ? statusCode : 500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProduction
        ? 'Something went wrong. Quote the correlation identifier when reporting this.'
        : (error.message ?? 'Something went wrong'),
      correlationId: reference,
    },
  } satisfies ErrorBody);
};
