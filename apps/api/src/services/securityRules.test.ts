import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import bcrypt from 'bcrypt';
import {
  containsFilter,
  escapeRegex,
  isUnsafeKey,
  parseQuery,
  sanitiseValue,
} from './requestSanitiser';
import { MemoryRateLimitStore } from './rateLimitStore';
import { redact } from './logger';
import {
  hashRefreshToken,
  issueTokens,
  refreshTokenMatches,
  verifyAccessToken,
  verifyRefreshToken,
} from './tokenService';
import { buildOpenApiDocument, documentedOperationCount } from './openapi';

// ─── Request sanitisation ────────────────────────────────────────────────────

test('operator, dotted and prototype keys are recognised as unsafe', () => {
  for (const key of ['$ne', '$where', 'a.b', '__proto__', 'constructor', 'prototype']) {
    assert.equal(isUnsafeKey(key), true, `${key} should be rejected`);
  }
  for (const key of ['status', 'shopId', 'idempotencyKey', 'from', 'a$b', 'name_1']) {
    assert.equal(isUnsafeKey(key), false, `${key} should be allowed`);
  }
});

test('a body carrying an operator loses it and keeps everything else', () => {
  const result = sanitiseValue({
    email: 'owner@example.com',
    password: { $ne: null },
    lines: [{ quantity: 2, reason: { $gt: '' } }],
  });

  const value = result.value as Record<string, unknown>;
  assert.equal(value.email, 'owner@example.com');
  // The key survives; the operator inside it does not, so the field then fails
  // ordinary validation as a missing string rather than reaching the database.
  assert.deepEqual(Object.keys(value.password as object), []);
  const lines = value.lines as Array<Record<string, unknown>>;
  assert.equal(lines[0].quantity, 2);
  assert.deepEqual(Object.keys(lines[0].reason as object), []);
  assert.deepEqual(result.removed, ['password.$ne', 'lines[0].reason.$gt']);
});

test('a prototype pollution attempt cannot reach Object.prototype', () => {
  const parsed = JSON.parse('{"a":1,"__proto__":{"polluted":true}}') as Record<string, unknown>;
  const result = sanitiseValue(parsed);
  assert.deepEqual(result.removed, ['__proto__']);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(result.value), null);
});

test('sanitising leaves dates, buffers and scalars intact', () => {
  const when = new Date('2026-08-01T00:00:00.000Z');
  const result = sanitiseValue({ when, blob: Buffer.from('x'), count: 3, flag: false, none: null });
  const value = result.value as Record<string, unknown>;
  assert.equal(value.when, when);
  assert.ok(Buffer.isBuffer(value.blob));
  assert.equal(value.count, 3);
  assert.equal(value.flag, false);
  assert.equal(value.none, null);
  assert.deepEqual(result.removed, []);
});

test('the query parser cannot produce an operator object', () => {
  const parsed = parseQuery('status[$ne]=DRAFT&limit=20&status=SUBMITTED');
  // `status[$ne]` stays a flat key, so nothing downstream sees an operator.
  assert.equal(parsed.status, 'SUBMITTED');
  assert.equal(parsed.limit, '20');
  assert.equal(typeof parsed['status[$ne]'], 'string');
  assert.equal(Object.getPrototypeOf(parsed), null);
});

test('the query parser collapses repeated keys to an array', () => {
  const parsed = parseQuery('role=ADMIN&role=MANAGER');
  assert.deepEqual(parsed.role, ['ADMIN', 'MANAGER']);
});

test('a search term cannot become a pattern or an expensive one', () => {
  assert.equal(escapeRegex('(a+)+$'), String.raw`\(a\+\)\+\$`);
  assert.equal(escapeRegex('x'.repeat(500)).length, 80);
  const filter = containsFilter('.*');
  assert.deepEqual(filter, { $regex: String.raw`\.\*`, $options: 'i' });
  // Proof the escaped form matches literally rather than matching everything.
  assert.equal(new RegExp(String(filter.$regex), 'i').test('Popular Pharmacy'), false);
  assert.equal(new RegExp(String(filter.$regex), 'i').test('Shop .* Ltd'), true);
});

// ─── Rate limiting ───────────────────────────────────────────────────────────

test('a window counts up and reports when it resets', async () => {
  const store = new MemoryRateLimitStore();
  const first = await store.hit('auth:ip:1.2.3.4', 60_000);
  const second = await store.hit('auth:ip:1.2.3.4', 60_000);
  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  assert.equal(first.resetAt.getTime(), second.resetAt.getTime());
  assert.ok(first.resetAt.getTime() > Date.now());
});

test('one caller cannot spend another caller’s budget', async () => {
  const store = new MemoryRateLimitStore();
  await store.hit('auth:ip:1.1.1.1', 60_000);
  await store.hit('auth:ip:1.1.1.1', 60_000);
  const other = await store.hit('auth:ip:2.2.2.2', 60_000);
  const tier = await store.hit('write:ip:1.1.1.1', 60_000);
  assert.equal(other.count, 1);
  // Tiers are separate budgets, so a burst of writes cannot lock out sign-in.
  assert.equal(tier.count, 1);
});

test('an expired window starts again rather than staying blocked', async () => {
  const store = new MemoryRateLimitStore();
  const first = await store.hit('auth:ip:9.9.9.9', 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await store.hit('auth:ip:9.9.9.9', 1);
  assert.equal(first.count, 1);
  assert.equal(second.count, 1);
});

// ─── Log redaction ───────────────────────────────────────────────────────────

test('credentials never reach a log line', () => {
  const line = redact({
    email: 'owner@example.com',
    password: 'CorrectHorse1',
    passwordHash: '$2b$10$abc',
    refreshToken: 'eyJhbGciOi',
    authorization: 'Bearer eyJ',
    otp: '123456',
    nested: { secret: 'x', base64Data: 'AAAA', quantity: 4 },
  }) as Record<string, unknown>;

  assert.equal(line.email, 'owner@example.com');
  for (const key of ['password', 'passwordHash', 'refreshToken', 'authorization', 'otp']) {
    assert.equal(line[key], '[redacted]', `${key} must be redacted`);
  }
  const nested = line.nested as Record<string, unknown>;
  assert.equal(nested.secret, '[redacted]');
  assert.equal(nested.base64Data, '[redacted]');
  assert.equal(nested.quantity, 4);
});

test('redaction bounds depth, breadth and string length', () => {
  let deep: Record<string, unknown> = { value: 'bottom' };
  for (let index = 0; index < 10; index += 1) deep = { child: deep };
  assert.equal(JSON.stringify(redact(deep)).includes('[truncated]'), true);

  const long = redact({ note: 'a'.repeat(1000) }) as Record<string, string>;
  assert.equal(long.note.length, 513);

  const wide = redact(Array.from({ length: 100 }, (_, index) => index)) as unknown[];
  assert.equal(wide.length, 20);
});

// ─── Tokens and sessions ─────────────────────────────────────────────────────

test('an access token names the session that issued it', () => {
  const { accessToken } = issueTokens('64b7f9c2a1b2c3d4e5f60718', '64b7f9c2a1b2c3d4e5f60719');
  const claims = verifyAccessToken(accessToken);
  assert.equal(claims.userId, '64b7f9c2a1b2c3d4e5f60718');
  assert.equal(claims.sid, '64b7f9c2a1b2c3d4e5f60719');
});

test('an access token cannot be presented as a refresh token or the reverse', () => {
  const { accessToken, refreshToken } = issueTokens('u', 's');
  assert.throws(() => verifyRefreshToken(accessToken));
  assert.throws(() => verifyAccessToken(refreshToken));
});

test('two rotations of the same session produce different tokens', () => {
  const first = issueTokens('u', 's').refreshToken;
  const second = issueTokens('u', 's').refreshToken;
  assert.notEqual(first, second);
  assert.notEqual(hashRefreshToken(first), hashRefreshToken(second));
});

test('a stored refresh hash matches only its own token', async () => {
  const { refreshToken } = issueTokens('u', 's');
  const stored = hashRefreshToken(refreshToken);
  assert.equal(stored.startsWith('hmac:'), true);
  // The raw token is never recoverable from what is stored.
  assert.equal(stored.includes(refreshToken), false);
  assert.equal(await refreshTokenMatches(refreshToken, stored), true);
  assert.equal(await refreshTokenMatches(`${refreshToken}x`, stored), false);
  assert.equal(await refreshTokenMatches(refreshToken, ''), false);
});

test('sessions written before this phase still verify against their bcrypt hash', async () => {
  const { refreshToken } = issueTokens('u', 's');
  const legacy = await bcrypt.hash(refreshToken, 10);
  assert.equal(await refreshTokenMatches(refreshToken, legacy), true);
  assert.equal(await refreshTokenMatches('another-token', legacy), false);
});

// ─── API specification ───────────────────────────────────────────────────────

test('the OpenAPI document describes every declared operation and its permissions', () => {
  const document = buildOpenApiDocument();
  assert.equal(document.openapi, '3.1.0');

  const operations = Object.values(document.paths).flatMap((methods) => Object.values(methods));
  assert.equal(operations.length, documentedOperationCount);

  for (const operation of operations as Array<Record<string, unknown>>) {
    assert.ok(operation.summary, 'every operation is summarised');
    assert.ok(operation.description, 'every operation states who may call it');
    const responses = operation.responses as Record<string, unknown>;
    // A client should be able to handle every documented failure.
    for (const status of ['200', '401', '403', '429', '500']) {
      assert.ok(responses[status], `status ${status} is documented`);
    }
  }
});

/**
 * The workspace root, found by walking up for the pnpm workspace file. This
 * test runs from `dist/`, so a path relative to the file points at build output.
 */
function workspaceRoot(from: string): string {
  let directory = from;
  while (!existsSync(resolve(directory, 'pnpm-workspace.yaml'))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Could not find the workspace root from ${from}`);
    directory = parent;
  }
  return directory;
}

test('the specification is reproducible, so a diff of it means something', () => {
  /*
   * Two builds of the same source must be byte-identical. They were not:
   * `z.toJSONSchema` evaluates a Zod default to produce a JSON Schema one, and
   * two request bodies default a timestamp to `new Date()` — so the document
   * carried the moment it was generated, every regeneration produced a diff
   * that meant nothing, and the gate below could never have been green.
   *
   * Asserted separately from the file comparison because the two fail for
   * different reasons and the difference is the whole diagnosis: this one red
   * means the generator is non-deterministic, that one means somebody forgot to
   * run it.
   */
  assert.equal(JSON.stringify(buildOpenApiDocument()), JSON.stringify(buildOpenApiDocument()));
});

test('the committed specification is the one this build would produce', () => {
  /*
   * `docs/openapi.json` is a generated artefact that is committed on purpose —
   * a specification change is a contract change, and reviewing it as a diff is
   * the point. Which only works if the file in the repository is the file the
   * code produces.
   *
   * It was not. The committed document described **72** operations while the
   * source declared **109**: thirty-seven endpoints, including every one added
   * across the last four phases, existed in the API and not in the document
   * anybody integrating against it would read. Nothing noticed, because until
   * now every assertion about the specification was made against
   * `buildOpenApiDocument()` — the live object, which is never stale by
   * construction — and none against the file.
   *
   * `ROAD_TO_PRODUCTION.md` records this same file going stale once before,
   * which is the argument for a gate rather than another regeneration.
   */
  const path = resolve(workspaceRoot(__dirname), 'docs/openapi.json');
  const expected = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

  assert.ok(existsSync(path), `${path} is missing; run \`pnpm --filter @medsupply/api openapi\``);
  assert.equal(
    readFileSync(path, 'utf8'),
    expected,
    'docs/openapi.json is out of date — run `pnpm --filter @medsupply/api openapi` and commit the result',
  );
});

test('the specification carries the request schemas the server actually enforces', () => {
  const document = buildOpenApiDocument();
  const login = document.paths['/api/v1/auth/login'].post as Record<string, unknown>;
  const body = login.requestBody as {
    content: { 'application/json': { schema: { required?: string[] } } };
  };
  assert.deepEqual(body.content['application/json'].schema.required, ['email', 'password']);

  // Health probes must be reachable without a token; everything else must not.
  const health = document.paths['/health'].get as { security: unknown[] };
  assert.deepEqual(health.security, []);
  const returns = document.paths['/api/v1/returns'].post as { security: unknown[] };
  assert.deepEqual(returns.security, [{ bearerAuth: [] }]);
});
