import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { OrderStatus, UserRole, UserStatus } from '@medsupply/shared-types';
import { app } from '../app';
import { AuditLog } from '../models/AuditLog';
import { Invoice } from '../models/Invoice';
import { Order } from '../models/Order';
import { Session } from '../models/Session';
import { Shop } from '../models/Shop';
import { User } from '../models/User';
import { rateLimit, setRateLimitStore } from '../middlewares/rateLimit';
import { MemoryRateLimitStore } from './rateLimitStore';
import { invalidateSettingsCache } from './settingsService';

/**
 * Phase 12 verification against a real replica set and a real HTTP server.
 *
 * These cover the protections that only exist once every layer is assembled:
 * what actually leaves the process in a response, what a hostile query string
 * does to a database filter, whether a revoked session really stops working,
 * and whether the report aggregations are served by an index or a scan.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const PASSWORD = 'IntegrationPassw0rd';

async function createUser(overrides: Record<string, unknown>) {
  return User.create({
    passwordHash: await bcrypt.hash(PASSWORD, 10),
    firstName: 'Test',
    lastName: 'User',
    status: UserStatus.ACTIVE,
    ...overrides,
  });
}

interface Call {
  status: number;
  headers: Headers;
  body: unknown;
  raw: string;
}

async function call(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Call> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  return { status: response.status, headers: response.headers, body, raw };
}

async function signIn(email: string) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = (await response.json()) as {
    data: { accessToken: string; refreshToken: string; user: Record<string, unknown> };
  };
  return {
    status: response.status,
    setCookie: response.headers.get('set-cookie') ?? '',
    ...body.data,
  };
}

let admin: Awaited<ReturnType<typeof createUser>>;
let owner: Awaited<ReturnType<typeof createUser>>;
let otherOwner: Awaited<ReturnType<typeof createUser>>;

before(async () => {
  const uri = process.env.MONGODB_TEST_URI
    ? process.env.MONGODB_TEST_URI
    : await (async () => {
        memoryReplica = await MongoMemoryReplSet.create({
          replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
        });
        return memoryReplica.getUri('medsupply_hardening');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([
    AuditLog.init(),
    Invoice.init(),
    Order.init(),
    Session.init(),
    Shop.init(),
    User.init(),
  ]);
  invalidateSettingsCache();

  admin = await createUser({ email: 'admin@hardening.local', role: UserRole.ADMIN });
  owner = await createUser({ email: 'owner@hardening.local', role: UserRole.SHOP_OWNER });
  otherOwner = await createUser({ email: 'rival@hardening.local', role: UserRole.SHOP_OWNER });

  await Shop.create({
    reference: 'SHP-HARD-1',
    name: 'Popular Pharmacy',
    ownerIds: [owner._id],
    primaryPhone: '01710000001',
    billingAddress: { label: 'Head office', line1: 'Street', city: 'Dhaka', district: 'Dhaka' },
    createdBy: admin._id,
  });
  await Shop.create({
    reference: 'SHP-HARD-2',
    // A name that is a regular expression if it is ever treated as one.
    name: 'Shop .* Ltd',
    ownerIds: [otherOwner._id],
    primaryPhone: '01710000002',
    billingAddress: { label: 'Head office', line1: 'Street', city: 'Dhaka', district: 'Dhaka' },
    createdBy: admin._id,
  });

  await new Promise<void>((resolve) => {
    const runningServer = app.listen(0, '127.0.0.1', () => {
      const address = runningServer.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server = runningServer;
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  await mongoose.disconnect();
  await memoryReplica?.stop();
});

// ─── Credential disclosure ───────────────────────────────────────────────────

test('signing in never returns the password hash or the lockout counters', async () => {
  const session = await signIn('admin@hardening.local');
  assert.equal(session.status, 200);
  assert.equal(session.user.passwordHash, undefined);
  assert.equal(session.user.loginAttempts, undefined);
  assert.equal(session.user.lockoutUntil, undefined);
  assert.equal(session.user.email, 'admin@hardening.local');

  // The whole payload is searched, not just the fields above, because the leak
  // this replaced was a field nobody thought to look at.
  const raw = JSON.stringify(session);
  assert.equal(raw.includes('passwordHash'), false);
  assert.equal(raw.includes('$2b$'), false);
});

test('the user directory does not carry password hashes either', async () => {
  const session = await signIn('admin@hardening.local');
  const response = await call('/api/v1/users', { token: session.accessToken });
  assert.equal(response.status, 200);
  assert.equal(response.raw.includes('passwordHash'), false);
  assert.equal(response.raw.includes('$2b$'), false);
});

// ─── Sessions and token rotation ─────────────────────────────────────────────

test('the refresh cookie is HTTP-only, SameSite=Strict and scoped to the auth routes', async () => {
  const session = await signIn('owner@hardening.local');
  const cookie = session.setCookie.toLowerCase();
  assert.ok(cookie.includes('refreshtoken='));
  assert.ok(cookie.includes('httponly'));
  assert.ok(cookie.includes('samesite=strict'));
  assert.ok(cookie.includes('path=/api/v1/auth'));
});

test('replaying a rotated refresh token revokes every session for that user', async () => {
  const account = await createUser({ email: 'reuse@hardening.local', role: UserRole.MANAGER });
  const first = await signIn('reuse@hardening.local');
  const second = await signIn('reuse@hardening.local');
  assert.equal(await Session.countDocuments({ userId: account._id, revokedAt: null }), 2);

  const rotated = await call('/api/v1/auth/refresh', {
    method: 'POST',
    body: { refreshToken: first.refreshToken },
  });
  assert.equal(rotated.status, 200);

  // The predecessor is now a token somebody should not be able to use.
  const replay = await call('/api/v1/auth/refresh', {
    method: 'POST',
    body: { refreshToken: first.refreshToken },
  });
  assert.equal(replay.status, 401);
  assert.equal((replay.body as { error: { code: string } }).error.code, 'TOKEN_REUSE_DETECTED');

  // Every session in the family is closed, including the unrelated second
  // sign-in, because the system cannot tell which one was stolen.
  assert.equal(await Session.countDocuments({ userId: account._id, revokedAt: null }), 0);
  const audited = await AuditLog.findOne({
    actorId: account._id,
    action: 'REFRESH_TOKEN_REUSE_DETECTED',
  });
  assert.ok(audited, 'reuse detection is audited');

  // The still-valid access token from the other sign-in stops working too.
  const afterRevocation = await call('/api/v1/auth/sessions', { token: second.accessToken });
  assert.equal(afterRevocation.status, 401);
});

test('revoking a session stops its access token immediately', async () => {
  await createUser({ email: 'revoke@hardening.local', role: UserRole.MANAGER });
  const session = await signIn('revoke@hardening.local');

  const before = await call('/api/v1/auth/sessions', { token: session.accessToken });
  assert.equal(before.status, 200);
  const sessions = (before.body as { data: Array<{ _id: string; current: boolean }> }).data;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].current, true);

  const revoked = await call(`/api/v1/auth/sessions/${sessions[0]._id}`, {
    method: 'DELETE',
    token: session.accessToken,
  });
  assert.equal(revoked.status, 200);

  const after = await call('/api/v1/auth/sessions', { token: session.accessToken });
  assert.equal(after.status, 401);
  assert.equal(
    (after.body as { error: { message: string } }).error.message,
    'This session has been signed out',
  );
});

test('a user cannot revoke somebody else’s session', async () => {
  await createUser({ email: 'victim@hardening.local', role: UserRole.MANAGER });
  const victim = await signIn('victim@hardening.local');
  const attacker = await signIn('owner@hardening.local');

  const victimSessions = (
    (await call('/api/v1/auth/sessions', { token: victim.accessToken })).body as {
      data: Array<{ _id: string }>;
    }
  ).data;

  const attempt = await call(`/api/v1/auth/sessions/${victimSessions[0]._id}`, {
    method: 'DELETE',
    token: attacker.accessToken,
  });
  // Not found rather than forbidden: the attacker learns nothing about whether
  // that identifier names a real session.
  assert.equal(attempt.status, 404);
  const stillLive = await call('/api/v1/auth/sessions', { token: victim.accessToken });
  assert.equal(stillLive.status, 200);
});

test('an unknown account and a wrong password are indistinguishable', async () => {
  const unknown = await call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'nobody@hardening.local', password: PASSWORD },
  });
  const wrong = await call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'owner@hardening.local', password: 'WrongPassword123' },
  });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(
    (unknown.body as { error: { code: string; message: string } }).error.message,
    (wrong.body as { error: { code: string; message: string } }).error.message,
  );
});

// ─── Injection ───────────────────────────────────────────────────────────────

test('an operator smuggled through the query string cannot widen a filter', async () => {
  const session = await signIn('owner@hardening.local');

  // A Shop Owner is narrowed to their own shop regardless, so the injection is
  // aimed at the order list, where `status` is a caller-supplied filter.
  await Order.create({
    reference: 'ORD-HARD-1',
    shopId: (await Shop.findOne({ reference: 'SHP-HARD-1' }))!._id,
    submittedBy: owner._id,
    items: [],
    status: OrderStatus.DRAFT,
    statusHistory: [],
  });

  const honest = await call('/api/v1/orders?status=SUBMITTED', { token: session.accessToken });
  assert.equal(honest.status, 200);
  assert.equal((honest.body as { data: unknown[] }).data.length, 0);

  const injected = await call('/api/v1/orders?status[$ne]=SUBMITTED', {
    token: session.accessToken,
  });
  // The operator never becomes a filter shape: the parameter is simply not a
  // recognised string filter, so the unfiltered list is returned rather than a
  // query the caller composed.
  assert.equal(injected.status, 200);
  assert.equal((injected.body as { data: unknown[] }).data.length, 1);
});

test('an operator in a request body is removed before validation sees it', async () => {
  const attempt = await call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'owner@hardening.local', password: { $ne: null } },
  });
  // Had the operator survived, bcrypt would have been handed an object; the
  // request is instead rejected as invalid input and no session is created.
  assert.equal(attempt.status, 400);
  assert.equal((attempt.body as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
});

test('a search term is matched literally rather than as a pattern', async () => {
  const session = await signIn('admin@hardening.local');

  const wildcard = await call('/api/v1/shops?search=.*', { token: session.accessToken });
  assert.equal(wildcard.status, 200);
  const names = (wildcard.body as { data: Array<{ name: string }> }).data.map((shop) => shop.name);
  // `.*` matches only the shop whose name literally contains it.
  assert.deepEqual(names, ['Shop .* Ltd']);

  const oversized = await call(`/api/v1/shops?search=${'a'.repeat(5000)}`, {
    token: session.accessToken,
  });
  assert.equal(oversized.status, 200);
  assert.equal((oversized.body as { data: unknown[] }).data.length, 0);
});

test('a list endpoint cannot be asked for an unbounded page', async () => {
  const session = await signIn('admin@hardening.local');
  const response = await call('/api/v1/shops?limit=100000', { token: session.accessToken });
  assert.equal(response.status, 200);
  assert.equal((response.body as { meta: { limit: number } }).meta.limit, 100);
});

// ─── Transport and error handling ────────────────────────────────────────────

test('every response carries the security headers and none advertises the server', async () => {
  const response = await call('/health');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  assert.ok(response.headers.get('permissions-policy')?.includes('camera=()'));
});

test('a correlation identifier is returned, honoured and recorded', async () => {
  const generated = await call('/health');
  assert.match(generated.headers.get('x-request-id') ?? '', /^[\w-]{8,64}$/);

  const supplied = await call('/api/v1/orders', { headers: { 'x-request-id': 'trace-abc-123' } });
  assert.equal(supplied.headers.get('x-request-id'), 'trace-abc-123');
  assert.equal(
    (supplied.body as { error: { correlationId: string } }).error.correlationId,
    'trace-abc-123',
  );

  // A caller cannot put arbitrary text into the log, or into the header this
  // server echoes, by way of the identifier it supplies.
  const hostile = await call('/health', { headers: { 'x-request-id': 'id <script> ;drop' } });
  assert.notEqual(hostile.headers.get('x-request-id'), 'id <script> ;drop');
  assert.match(hostile.headers.get('x-request-id') ?? '', /^[\w-]{8,64}$/);

  const oversized = await call('/health', { headers: { 'x-request-id': 'a'.repeat(500) } });
  assert.match(oversized.headers.get('x-request-id') ?? '', /^[\w-]{8,64}$/);
});

test('an unknown route says the address is unserved, not that a record is gone', async () => {
  const response = await call('/api/v1/does-not-exist');
  assert.equal(response.status, 404);
  const error = (response.body as { error: { code: string; correlationId?: string } }).error;
  /*
   * `NO_SUCH_ENDPOINT`, not `NOT_FOUND`. Both are 404s and they are not the
   * same fact: one means the record was removed, the other that this build of
   * the client is asking for an address this build of the server never served.
   * They shared a code once, and the client catalogue renders `NOT_FOUND` as
   * "It may have been removed" — so a browser running against a server too old
   * to have `/trips` told a distributor their delivery rounds had been deleted.
   */
  assert.equal(error.code, 'NO_SUCH_ENDPOINT');
  assert.ok(error.correlationId);
});

test('a body larger than the endpoint accepts is refused, not buffered', async () => {
  const response = await fetch(`${base}/api/v1/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(400_000) }),
  });
  assert.equal(response.status, 413);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('malformed JSON is a bad request rather than an internal failure', async () => {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"email":',
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'MALFORMED_JSON');
});

// ─── Rate limiting ───────────────────────────────────────────────────────────

test('a caller over its budget is refused with the headers needed to back off', async () => {
  const store = new MemoryRateLimitStore();
  setRateLimitStore(store);
  try {
    const limited = express();
    limited.get('/thing', rateLimit({ tier: 'test', max: 2, windowMs: 60_000 }), (_req, res) =>
      res.json({ data: 'ok' }),
    );

    const listener = await new Promise<Server>((resolve) => {
      const created = limited.listen(0, '127.0.0.1', () => resolve(created));
    });
    const address = listener.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/thing`;

    const first = await fetch(url);
    const second = await fetch(url);
    const third = await fetch(url);

    assert.equal(first.status, 200);
    assert.equal(first.headers.get('ratelimit-limit'), '2');
    assert.equal(first.headers.get('ratelimit-remaining'), '1');
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('ratelimit-remaining'), '0');

    assert.equal(third.status, 429);
    assert.equal(((await third.json()) as { error: { code: string } }).error.code, 'RATE_LIMITED');
    assert.ok(Number(third.headers.get('retry-after')) > 0);

    await new Promise<void>((resolve) => listener.close(() => resolve()));
  } finally {
    setRateLimitStore(null);
  }
});

// ─── API specification ───────────────────────────────────────────────────────

test('the OpenAPI document and its reference page are served', async () => {
  const specification = await call('/api/v1/docs/openapi.json');
  assert.equal(specification.status, 200);
  const document = specification.body as { openapi: string; paths: Record<string, unknown> };
  assert.equal(document.openapi, '3.1.0');
  assert.ok(Object.keys(document.paths).length > 20);

  const page = await fetch(`${base}/api/v1/docs`);
  assert.equal(page.status, 200);
  assert.ok((page.headers.get('content-type') ?? '').includes('text/html'));
  const html = await page.text();
  // Self-contained: the content security policy forbids a third-party origin,
  // so the page must not reference one.
  assert.equal(/src="https?:/.test(html), false);
  assert.equal(/href="https?:\/\/(?!json-schema)/.test(html), false);
});

// ─── Performance ─────────────────────────────────────────────────────────────

test('the report aggregations are served by an index rather than a collection scan', async () => {
  const shop = await Shop.findOne({ reference: 'SHP-HARD-1' });
  const order = await Order.findOne({ reference: 'ORD-HARD-1' });
  await Invoice.create({
    reference: 'INV-HARD-1',
    orderId: order!._id,
    shopId: shop!._id,
    supplierSnapshot: { name: 'MedSupply B2B' },
    shopSnapshot: { reference: shop!.reference, name: shop!.name },
    orderSnapshot: { reference: order!.reference },
    deliveryAddressSnapshot: { line1: 'Street', city: 'Dhaka', district: 'Dhaka' },
    items: [],
    subtotalMinor: 0,
    orderDiscountMinor: 0,
    deliveryChargeMinor: 0,
    taxMinor: 0,
    previousBalanceMinor: 0,
    grandTotalMinor: 0,
    amountDueMinor: 0,
    totalOutstandingMinor: 0,
    paymentTermsDays: 30,
    invoiceDate: new Date(),
    dueDate: new Date(),
    issuedBy: admin._id,
    issuedAt: new Date(),
  });

  const window = { $gte: new Date(Date.now() - 86_400_000), $lte: new Date() };

  const plans = await Promise.all([
    Invoice.find({ status: 'ISSUED', invoiceDate: window }).explain('queryPlanner'),
    Order.find({ createdAt: window }).explain('queryPlanner'),
    AuditLog.find({}).sort({ createdAt: -1 }).limit(20).explain('queryPlanner'),
  ]);

  for (const plan of plans as unknown as Array<{
    queryPlanner: { winningPlan: { stage?: string; inputStage?: { stage: string } } };
  }>) {
    const winning = plan.queryPlanner.winningPlan;
    const stages = JSON.stringify(winning);
    assert.equal(
      stages.includes('COLLSCAN'),
      false,
      `an index should serve this query, plan was ${stages}`,
    );
  }
});

test('shops created at the same moment get distinct references', async () => {
  /*
   * The reference used to be `SHP-${year}-${countDocuments() + 1}`, built in a
   * pre-save hook. Counting is not atomic, so concurrent creates computed the
   * same number and one save died on the unique index — surfacing to whoever
   * lost the race as a 500 rather than as a shop. It was the only reference in
   * the system not produced by `nextReference`, which does one atomic `$inc`.
   */
  const created = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      Shop.create({
        name: `Concurrent Pharmacy ${index}`,
        primaryPhone: `0179000${String(index).padStart(4, '0')}`,
        billingAddress: { label: 'Head office', line1: 'Street', city: 'Dhaka', district: 'Dhaka' },
        createdBy: admin._id,
      }),
    ),
  );

  const references = created.map((shop) => shop.reference);
  assert.equal(new Set(references).size, references.length, `collided: ${references.join(', ')}`);
  for (const reference of references) {
    // The same shape every other reference in the system uses.
    assert.match(String(reference), /^SHP-\d{4}-\d{6}$/);
  }
});

test('an aggregation carries a server-side time limit', async () => {
  // The guard is what stops one wide report from occupying a database thread
  // indefinitely, so it is asserted on the pipeline the server will send.
  const aggregation = Invoice.aggregate([{ $match: {} }]);
  await aggregation.exec();
  assert.equal(typeof aggregation.options.maxTimeMS, 'number');
  assert.ok((aggregation.options.maxTimeMS ?? 0) > 0);

  const explicit = Invoice.aggregate([{ $match: {} }]).option({ maxTimeMS: 1234 });
  await explicit.exec();
  assert.equal(explicit.options.maxTimeMS, 1234);
});

test('health and readiness report the database honestly', async () => {
  const live = await call('/health');
  assert.equal(live.status, 200);
  assert.equal((live.body as { data: { status: string } }).data.status, 'ok');

  const ready = await call('/health/ready');
  assert.equal(ready.status, 200);
  assert.equal(
    (ready.body as { data: { checks: { database: string } } }).data.checks.database,
    'up',
  );

  const version = await call('/health/version');
  assert.equal(version.status, 200);
  assert.ok((version.body as { data: { version: string } }).data.version);
});

test('metrics expose the ledger gauge without leaking an identifier into a label', async () => {
  // Cause one request with an ObjectId in the path, so the scrape below has
  // something to have got wrong.
  await call('/api/v1/orders/507f1f77bcf86cd799439011');

  const response = await fetch(`${base}/metrics`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/plain/);
  const body = await response.text();

  /*
   * The gauge an operator alerts on. It must be present on every scrape, and it
   * must be able to say "I could not check" (-1) rather than reporting zero
   * unbalanced transactions when nothing was examined.
   */
  assert.match(body, /^medsupply_ledger_unbalanced_transactions -?\d+$/m);
  assert.match(body, /^medsupply_database_connected 1$/m);

  // A label built from the URL rather than the route template would create one
  // time series per order and eventually take the scraper down.
  assert.ok(
    !body.includes('507f1f77bcf86cd799439011'),
    'an ObjectId reached a metric label, which makes cardinality unbounded',
  );
});

test('the runtime status is administrator-only and reveals no secret', async () => {
  const ownerSession = await signIn('owner@hardening.local');
  const refused = await call('/api/v1/admin/runtime', { token: ownerSession.accessToken });
  assert.equal(refused.status, 403);

  const adminSession = await signIn('admin@hardening.local');
  const allowed = await call('/api/v1/admin/runtime', { token: adminSession.accessToken });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.raw.includes(process.env.JWT_SECRET ?? 'unset'), false);
  assert.equal(allowed.raw.toLowerCase().includes('mongodb://'), false);
  const data = (allowed.body as { data: { rateLimit: { driver: string } } }).data;
  assert.ok(['memory', 'redis'].includes(data.rateLimit.driver));
});

test('an inactive account cannot keep renewing its way past the decision', async () => {
  const account = await createUser({ email: 'suspended@hardening.local', role: UserRole.MANAGER });
  const session = await signIn('suspended@hardening.local');

  await User.updateOne({ _id: account._id }, { status: UserStatus.SUSPENDED });

  const refreshed = await call('/api/v1/auth/refresh', {
    method: 'POST',
    body: { refreshToken: session.refreshToken },
  });
  assert.equal(refreshed.status, 403);
  const stored = await Session.findOne({ userId: account._id as Types.ObjectId });
  assert.ok(stored?.revokedAt, 'the session is closed rather than left open');
});
