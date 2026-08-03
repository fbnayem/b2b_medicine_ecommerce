import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';

/**
 * What an operator can see at three in the morning.
 *
 * The audit found no metrics endpoint, no error reporting and no alerting: when
 * the ledger went wrong, nobody was told and there was nothing to look at. This
 * is the smallest thing that fixes that honestly — request rate, latency,
 * errors, queue depth, and the one gauge that is specific to this system:
 *
 * **`medsupply_ledger_unbalanced_transactions`.**
 *
 * Every `LedgerTransaction` must have equal debits and credits; the invariant is
 * enforced per document at write time. If this gauge is ever non-zero, something
 * has written to the collection outside the service — a migration, a manual
 * fix, a restore from a bad archive — and the books no longer add up. It is the
 * one alert this deployment should never ignore.
 *
 * Rendered in Prometheus text format. No dependency: the exposition format is a
 * dozen lines of string building, and adding a client library to emit it would
 * be more moving parts than the thing it emits.
 */

interface Bucket {
  count: number;
  totalMs: number;
}

const requests = new Map<string, Bucket>();
let errorCount = 0;

/**
 * The route template, never the URL.
 *
 * `/api/v1/orders/6512…/cancellation-decision` as a label value would create a
 * new time series per order and eventually take the scraper down with it. Only
 * the mount prefix and the shape are kept.
 */
export function routeLabel(req: Request): string {
  const base = req.baseUrl || '';
  const path = req.route?.path ?? '';
  const combined = `${base}${typeof path === 'string' ? path : ''}` || req.path || '/';
  // Anything that still looks like an identifier becomes a placeholder.
  return combined
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .slice(0, 120);
}

export function recordRequest(method: string, route: string, status: number, durationMs: number) {
  const key = `${method.toUpperCase()} ${route} ${status}`;
  const bucket = requests.get(key) ?? { count: 0, totalMs: 0 };
  bucket.count += 1;
  bucket.totalMs += durationMs;
  requests.set(key, bucket);
  if (status >= 500) errorCount += 1;
}

/** Times every request and records it once the response is finished. */
export function metricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      // Read on `finish`, when `req.route` is populated and `baseUrl` still holds
      // the mount — the same constraint the route-coverage recorder works under.
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      recordRequest(req.method, routeLabel(req), res.statusCode, durationMs);
    });
    next();
  };
}

/**
 * Counts ledger transactions whose entries do not balance.
 *
 * Cached briefly because a scrape every fifteen seconds should not run a
 * collection-wide aggregation every time, and because the answer only changes
 * when something has gone badly wrong.
 */
let ledgerCache: { at: number; value: number } | undefined;
const LEDGER_CACHE_MS = 60_000;

export async function unbalancedLedgerTransactions(now = Date.now()): Promise<number> {
  if (ledgerCache && now - ledgerCache.at < LEDGER_CACHE_MS) return ledgerCache.value;
  const database = mongoose.connection.db;
  if (!database) return -1;
  const rows = await database
    .collection('ledgertransactions')
    .aggregate([
      {
        $project: {
          debit: { $sum: '$entries.debitMinor' },
          credit: { $sum: '$entries.creditMinor' },
        },
      },
      { $match: { $expr: { $ne: ['$debit', '$credit'] } } },
      { $count: 'total' },
    ])
    .toArray();
  const value = (rows[0]?.total as number | undefined) ?? 0;
  ledgerCache = { at: now, value };
  return value;
}

function escapeLabel(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
}

export interface MetricsExtras {
  /** Depth and failure count of the notification queue, when Redis is in use. */
  queueDepth?: number;
  queueFailed?: number;
}

export async function renderPrometheus(extras: MetricsExtras = {}): Promise<string> {
  const lines: string[] = [];

  lines.push('# HELP medsupply_requests_total Completed HTTP requests.');
  lines.push('# TYPE medsupply_requests_total counter');
  lines.push('# HELP medsupply_request_duration_ms_sum Total request time in milliseconds.');
  lines.push('# TYPE medsupply_request_duration_ms_sum counter');
  for (const [key, bucket] of requests) {
    const [method, route, status] = key.split(' ');
    const labels =
      `method="${escapeLabel(method ?? '')}",route="${escapeLabel(route ?? '')}",` +
      `status="${escapeLabel(status ?? '')}"`;
    lines.push(`medsupply_requests_total{${labels}} ${bucket.count}`);
    lines.push(`medsupply_request_duration_ms_sum{${labels}} ${bucket.totalMs.toFixed(1)}`);
  }

  lines.push('# HELP medsupply_server_errors_total Responses with a 5xx status.');
  lines.push('# TYPE medsupply_server_errors_total counter');
  lines.push(`medsupply_server_errors_total ${errorCount}`);

  lines.push('# HELP medsupply_database_connected Whether Mongoose holds an open connection.');
  lines.push('# TYPE medsupply_database_connected gauge');
  lines.push(`medsupply_database_connected ${mongoose.connection.readyState === 1 ? 1 : 0}`);

  if (extras.queueDepth !== undefined) {
    lines.push('# HELP medsupply_queue_depth Jobs waiting in the notification queue.');
    lines.push('# TYPE medsupply_queue_depth gauge');
    lines.push(`medsupply_queue_depth ${extras.queueDepth}`);
  }
  if (extras.queueFailed !== undefined) {
    lines.push('# HELP medsupply_queue_failed Jobs that exhausted their retries.');
    lines.push('# TYPE medsupply_queue_failed gauge');
    lines.push(`medsupply_queue_failed ${extras.queueFailed}`);
  }

  /*
   * The gauge worth alerting on. `-1` means the database was unreachable and
   * the question could not be asked, which is deliberately distinct from `0`:
   * an alert must not read "the books balance" when nothing was checked.
   */
  const unbalanced = await unbalancedLedgerTransactions();
  lines.push(
    '# HELP medsupply_ledger_unbalanced_transactions Ledger transactions whose debits and credits differ. Always alert on this. -1 means the check could not run.',
  );
  lines.push('# TYPE medsupply_ledger_unbalanced_transactions gauge');
  lines.push(`medsupply_ledger_unbalanced_transactions ${unbalanced}`);

  lines.push('# HELP medsupply_process_uptime_seconds Seconds since the process started.');
  lines.push('# TYPE medsupply_process_uptime_seconds counter');
  lines.push(`medsupply_process_uptime_seconds ${Math.floor(process.uptime())}`);

  return `${lines.join('\n')}\n`;
}

/** Test seam: metric state is process-wide and must not leak between cases. */
export function resetMetrics() {
  requests.clear();
  errorCount = 0;
  ledgerCache = undefined;
}
