import type { Schema } from 'mongoose';
import { env } from '../env';

/**
 * A server-side ceiling on how long one aggregation may run.
 *
 * Phase 11 chose to recompute every report from source records rather than
 * maintain rollups, which keeps the figures incapable of drifting from the
 * ledger but means a wide enough date range does real work. Without a limit,
 * one such request occupies a database thread until it finishes, and a handful
 * of them are a denial of service that needs no attacker — an impatient user
 * retrying a slow dashboard will do.
 *
 * `maxTimeMS` makes the database itself abandon the operation, which is the
 * only limit that actually frees the resource; a timeout in the API would
 * merely stop waiting for it.
 *
 * A caller that genuinely needs longer — a migration reshaping a whole
 * collection — sets its own value and is left alone.
 */
export function applyQueryGuards(schema: Schema) {
  schema.pre('aggregate', function boundAggregationTime() {
    if (this.options.maxTimeMS === undefined) {
      this.options.maxTimeMS = env.DB_QUERY_TIMEOUT_MS;
    }
  });
}
