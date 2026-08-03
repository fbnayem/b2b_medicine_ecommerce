import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../env';

/**
 * Structured logging with redaction.
 *
 * Two things went wrong before this phase: the error handler printed whole
 * error objects, which for a validation failure includes the submitted request
 * body and therefore the submitted password, and log lines carried no
 * correlation identifier, so a report of "my order failed at about four" could
 * not be tied to the request that failed.
 *
 * This module fixes both. Every line is JSON with the current request's
 * correlation identifier attached automatically, and any field whose name
 * looks like a credential is replaced before it reaches the output.
 */

export interface RequestContext {
  correlationId: string;
  method: string;
  path: string;
  userId?: string;
  role?: string;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(context: RequestContext, callback: () => T): T =>
  storage.run(context, callback);

export const currentContext = (): RequestContext | undefined => storage.getStore();

export const correlationId = (): string | undefined => storage.getStore()?.correlationId;

const SENSITIVE_KEY =
  /pass(word|hash)?|secret|token|authorization|cookie|otp|signature|base64data|refreshtoken|apikey/i;

const REDACTED = '[redacted]';

/**
 * Depth and breadth are bounded because a log line is not a debugger: an
 * attacker who can post a deeply nested body should not be able to make the
 * logger recurse until the process dies.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[buffer ${value.length} bytes]`;
  if (value instanceof Error) return redactError(value, depth);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redact(entry, depth + 1));
  }
  if (typeof value === 'string') {
    return value.length > 512 ? `${value.slice(0, 512)}…` : value;
  }
  if (typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source).slice(0, 40)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(source[key], depth + 1);
  }
  return output;
}

/**
 * An error is not an ordinary object: `name`, `message`, `stack` and a `cause`
 * set through the constructor option are all non-enumerable, so `Object.keys`
 * returns `[]` and `JSON.stringify(error)` is `{}`. Without this branch, routing
 * a caught error through the logger would print `"detail":{}` and discard the
 * only part anyone reads. That is the trap that kept these call sites on
 * `console.error` — it prints errors correctly and redacts nothing.
 *
 * Enumerable own properties are kept and redacted by name, because that is
 * where a payload rides along: a failed notification job attaches its data to
 * the error, and that data can carry a delivery OTP.
 */
function redactError(error: Error, depth: number): Record<string, unknown> {
  const attached = error as Error & Record<string, unknown>;
  const output: Record<string, unknown> = { name: error.name, message: error.message };

  // Enough frames to locate the throw, not so many that one failure fills the
  // log. The generic string cap is 512 characters, which truncates mid-frame.
  if (error.stack) output.stack = error.stack.split('\n').slice(0, 12).join('\n');
  if (error.cause !== undefined) output.cause = redact(error.cause, depth + 1);

  for (const key of Object.keys(attached).slice(0, 40)) {
    if (key === 'cause') continue;
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(attached[key], depth + 1);
  }
  return output;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
export type LogLevel = keyof typeof LEVELS;

const threshold = LEVELS[env.LOG_LEVEL];

function write(level: Exclude<LogLevel, 'silent'>, message: string, detail?: unknown) {
  if (LEVELS[level] < threshold) return;
  const context = storage.getStore();
  const line = {
    level,
    time: new Date().toISOString(),
    service: 'api',
    version: env.APP_VERSION,
    message,
    ...(context
      ? {
          correlationId: context.correlationId,
          method: context.method,
          path: context.path,
          userId: context.userId,
          role: context.role,
        }
      : {}),
    ...(detail === undefined ? {} : { detail: redact(detail) }),
  };
  const serialised = JSON.stringify(line);
  if (level === 'error' || level === 'warn') console.error(serialised);
  else console.log(serialised);
}

export const logger = {
  debug: (message: string, detail?: unknown) => write('debug', message, detail),
  info: (message: string, detail?: unknown) => write('info', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', message, detail),
  error: (message: string, detail?: unknown) => write('error', message, detail),
};
