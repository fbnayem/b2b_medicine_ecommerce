import { Types } from 'mongoose';
/**
 * Protection against NoSQL injection and prototype pollution.
 *
 * Mongoose builds a query from whatever shape it is handed. A controller that
 * writes `filter.status = req.query.status` is safe when the value is a string
 * and is an injection when the value is `{ $ne: null }`, and with the default
 * Express query parser a client chooses which of those it sends by writing
 * `?status[$ne]=`. The controllers were audited and the direct assignments
 * fixed, but relying on every future controller getting that right is exactly
 * the assumption that produces the next vulnerability, so the shape is
 * constrained centrally as well.
 *
 * Two rules, applied to bodies, query strings and route parameters:
 *
 *   1. A key may not begin with `$`. Those are operators, and no legitimate
 *      client field is named after one.
 *   2. A key may not contain `.` or be `__proto__`, `constructor` or
 *      `prototype`. Dotted keys reach into sub-documents in an update and the
 *      other three reach into the JavaScript object model.
 *
 * Offending keys are removed rather than rejected. A request that carries one
 * is either an attack, which should not be given a diagnostic, or a client bug,
 * which then fails the ordinary Zod validation with a message about a missing
 * field rather than a confusing security error.
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isUnsafeKey(key: string): boolean {
  return key.startsWith('$') || key.includes('.') || FORBIDDEN_KEYS.has(key);
}

export interface SanitiseResult<T> {
  value: T;
  removed: string[];
}

/**
 * Returns a copy with unsafe keys removed, plus the paths that were removed so
 * the caller can log an attempt. Depth is bounded: a body nested more deeply
 * than any legitimate payload is truncated rather than walked.
 */
export function sanitiseValue(input: unknown, path = '', depth = 0): SanitiseResult<unknown> {
  const removed: string[] = [];

  if (depth > 12 || input === null || typeof input !== 'object') {
    return { value: input, removed };
  }

  if (Array.isArray(input)) {
    const value = input.map((entry, index) => {
      const result = sanitiseValue(entry, `${path}[${index}]`, depth + 1);
      removed.push(...result.removed);
      return result.value;
    });
    return { value, removed };
  }

  if (input instanceof Date || Buffer.isBuffer(input)) return { value: input, removed };

  // A null-prototype object keeps a sanitised body from carrying an inherited
  // `toString` or `valueOf` that a downstream serialiser would call.
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
    const child = path ? `${path}.${key}` : key;
    if (isUnsafeKey(key)) {
      removed.push(child);
      continue;
    }
    const result = sanitiseValue(entry, child, depth + 1);
    removed.push(...result.removed);
    output[key] = result.value;
  }
  return { value: output, removed };
}

/**
 * Query-string parser used in place of the Express default.
 *
 * `URLSearchParams` produces flat string values, so `?status[$ne]=` arrives as
 * the single harmless key `status[$ne]` instead of an operator object. Repeated
 * keys collapse to an array, which is what every list filter in this API
 * already expects, and nothing in the codebase relies on nested query objects.
 */
export function parseQuery(queryString: string): Record<string, string | string[]> {
  const parsed = Object.create(null) as Record<string, string | string[]>;
  if (!queryString) return parsed;

  const params = new URLSearchParams(queryString);
  for (const key of new Set(params.keys())) {
    if (isUnsafeKey(key)) continue;
    const values = params.getAll(key);
    parsed[key] = values.length > 1 ? values : values[0];
  }
  return parsed;
}

/**
 * Escapes a user-supplied string for use inside a `$regex` filter.
 *
 * Callers previously interpolated search terms straight into `$regex`, which
 * let a caller both change what the filter matched and submit a pattern that
 * costs the database far more than it costs them to send. Length is capped for
 * the same reason.
 */
export function escapeRegex(input: string, maxLength = 80): string {
  return input.slice(0, maxLength).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** A case-insensitive contains filter that cannot be turned into a pattern. */
export function containsFilter(input: string) {
  return { $regex: escapeRegex(input), $options: 'i' };
}

/**
 * A query value that is only usable as a Mongo id, or nothing.
 *
 * This lived in `inventoryController` and is now needed by pricing as well.
 * Copying it would have been the smaller diff and the worse one: the whole
 * point is that an id-shaped filter is validated identically everywhere, and
 * two copies is how one of them ends up missing the `isValid` check and
 * throwing a cast error on `?medicineId=nonsense` instead of answering with an
 * empty page.
 */
export const objectIdParam = (value: unknown): string | undefined =>
  typeof value === 'string' && Types.ObjectId.isValid(value) ? value : undefined;
