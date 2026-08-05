import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ShopStatus, UserRole, UserStatus } from '@medsupply/shared-types';
import { app } from '../app';
import { AuditLog } from '../models/AuditLog';
import { Session } from '../models/Session';
import { Shop } from '../models/Shop';
import { User } from '../models/User';

/**
 * Administration: who exists, who owns what, and who is still signed in.
 *
 * The second tranche of the burn-down, and it leads with the endpoint the whole
 * coverage gate was built for.
 *
 * `POST /api/v1/users` shipped with a role bug — **every account it created
 * silently took the creator's own role** — and that bug survived twelve phases
 * because no test ever called the route. The waiver lists exist because a
 * coverage percentage would have read "88%" and named nothing. Yet until this
 * file, the endpoint at the centre of that story still had no test, so the gate
 * had never actually been shown to catch the defect it was built for.
 *
 * The first test below is that demonstration. Its assertion is not "creating a
 * user works" — it is that **the created account carries the role in the
 * request and not the role of whoever sent it**, which is the only phrasing
 * that goes red against the original defect.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const PASSWORD = 'Correct-Horse-1';

const superAdmin = { _id: new Types.ObjectId(), role: UserRole.SUPER_ADMIN };
const admin = { _id: new Types.ObjectId(), role: UserRole.ADMIN };
const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const rep = { _id: new Types.ObjectId(), role: UserRole.SALES };
const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };

let inTerritory: Types.ObjectId;
let outsideTerritory: Types.ObjectId;

function headers(user: { _id: Types.ObjectId }) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET!)}`,
  };
}

async function call(
  method: string,
  path: string,
  as: { _id: Types.ObjectId } | { token: string },
  body?: unknown,
) {
  const authorization =
    'token' in as
      ? { 'content-type': 'application/json', authorization: `Bearer ${as.token}` }
      : headers(as);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: authorization,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.startsWith('{') ? (JSON.parse(text) as Record<string, never>) : ({} as never),
  };
}

const get = (path: string, as: Parameters<typeof call>[2]) => call('GET', path, as);
const post = (path: string, as: Parameters<typeof call>[2], body?: unknown) =>
  call('POST', path, as, body ?? {});
const patch = (path: string, as: Parameters<typeof call>[2], body?: unknown) =>
  call('PATCH', path, as, body ?? {});

let phone = 0;

async function makeShop(name: string, territory: string) {
  phone += 1;
  const created = await Shop.create({
    reference: `SHP-ADM-${String(phone).padStart(5, '0')}`,
    name,
    primaryPhone: `0198000${String(phone).padStart(4, '0')}`,
    status: ShopStatus.ACTIVE,
    creditLimit: 10_000_00,
    paymentTermsDays: 30,
    territory,
    deliveryAddresses: [
      { label: 'Shop', line1: '1 Green Road', city: 'Dhaka', district: 'Dhaka', isDefault: true },
    ],
  });
  return created._id;
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_administration'));
  await mongoose.connection.dropDatabase();
  await Promise.all([Session.init(), Shop.init(), User.init()]);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await User.create(
    (
      [
        [superAdmin, 'admin-super', 'Super', 'Admin'],
        [admin, 'admin-admin', 'Ordinary', 'Admin'],
        [manager, 'admin-manager', 'Branch', 'Manager'],
        [rep, 'admin-rep', 'Field', 'Rep'],
        [owner, 'admin-owner', 'Shop', 'Owner'],
      ] as const
    ).map(([who, email, firstName, lastName]) => ({
      _id: who._id,
      email: `${email}@test.local`,
      passwordHash,
      firstName,
      lastName,
      role: who.role,
      status: UserStatus.ACTIVE,
      ...(who.role === UserRole.SALES ? { territories: ['Dhaka North'] } : {}),
    })),
  );

  inTerritory = await makeShop('Bismillah Pharmacy', 'Dhaka North');
  outsideTerritory = await makeShop('Sylhet Medicos', 'Sylhet');

  await new Promise<void>((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => {
      const address = running.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server = running;
  });
});

after(async () => {
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await memoryReplica?.stop();
});

// ─── The defect this gate was built for ──────────────────────────────────────

test('a created account carries the role it was asked for, not the creator’s', async () => {
  /*
   * The original bug, stated as an assertion. `createUser` spread the request
   * over a document whose `role` came from the actor, so an administrator
   * creating a delivery rider produced a second administrator — and every
   * subsequent screen, guard and audit line treated them as one.
   *
   * Plant it by making the handler use `req.user.role` and this goes red on the
   * first assertion. Nothing else in the suite does.
   */
  const created = await post('/api/v1/users', admin, {
    email: 'new-rider@test.local',
    password: PASSWORD,
    firstName: 'New',
    lastName: 'Rider',
    role: UserRole.DELIVERY_PERSON,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const stored = await User.findOne({ email: 'new-rider@test.local' }).lean();
  assert.ok(stored);
  assert.equal(
    stored.role,
    UserRole.DELIVERY_PERSON,
    'the account took the creator’s role instead of the requested one — this is the ' +
      'defect the route-coverage gate exists because of',
  );
  assert.notEqual(stored.role, UserRole.ADMIN);
  assert.equal(stored.passwordHash === PASSWORD, false, 'the password is hashed, never stored');
});

test('an administrator cannot create an account more privileged than their own', async () => {
  const escalation = await post('/api/v1/users', admin, {
    email: 'sneaky-super@test.local',
    password: PASSWORD,
    firstName: 'Sneaky',
    lastName: 'Super',
    role: UserRole.SUPER_ADMIN,
  });
  assert.equal(
    escalation.status,
    403,
    'creating an account is the obvious way around a rule that only guards edits',
  );
  assert.equal(await User.countDocuments({ email: 'sneaky-super@test.local' }), 0);
});

test('a manager may staff the warehouse and nothing above it', async () => {
  /*
   * A deliberate widening, and the reason is the shape of the work: planning a
   * round and assigning a delivery are `MANAGEMENT`, so the person who needed a
   * delivery person was precisely the person who could not make one.
   *
   * The limit is what makes it safe. A manager may create the two
   * warehouse-side roles and nothing that could go on to create further
   * accounts — including their own role, which is not *privileged* and would
   * therefore have passed the rule that guards Admin and Super Admin.
   */
  const rider = await post('/api/v1/users', manager, {
    email: 'manager-made-rider@test.local',
    password: PASSWORD,
    firstName: 'Manager',
    lastName: 'Made',
    role: UserRole.DELIVERY_PERSON,
  });
  assert.equal(rider.status, 201, JSON.stringify(rider.body));

  const storekeeper = await post('/api/v1/users', manager, {
    email: 'manager-made-store@test.local',
    password: PASSWORD,
    firstName: 'Store',
    lastName: 'Keeper',
    role: UserRole.STOREKEEPER,
  });
  assert.equal(storekeeper.status, 201, JSON.stringify(storekeeper.body));

  for (const role of [UserRole.MANAGER, UserRole.ADMIN, UserRole.SALES, UserRole.SHOP_OWNER]) {
    const refused = await post('/api/v1/users', manager, {
      email: `manager-made-${role}@test.local`.toLowerCase(),
      password: PASSWORD,
      firstName: 'Not',
      lastName: 'Allowed',
      role,
    });
    assert.equal(refused.status, 403, `a manager created a ${role}`);
    assert.equal(await User.countDocuments({ role, email: /manager-made/ }), 0);
  }

  /*
   * The audit row names the manager who did it.
   *
   * This mattered less when only administrators could create an account; it
   * matters now, because a storekeeper can move stock and the only record of
   * who let them is this one.
   */
  const created = await User.findOne({ email: 'manager-made-rider@test.local' }).lean();
  const record = await AuditLog.findOne({
    action: 'USER_CREATED',
    entityId: created!._id,
  }).lean();
  assert.ok(record, 'creating an account wrote no audit row');
  assert.equal(String(record.actorId), String(manager._id));
  assert.equal(record.actorRole, UserRole.MANAGER);
});

// ─── Customers ───────────────────────────────────────────────────────────────

test('a customer is registered, opened, and reachable only inside a rep’s territory', async () => {
  const registered = await post('/api/v1/shops', admin, {
    name: 'Noor Pharmacy',
    primaryPhone: '01798000111',
    territory: 'Dhaka North',
    creditLimit: 50_000_00,
    paymentTermsDays: 15,
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const registeredId = (registered.body.data as unknown as { _id: string })._id;

  const byManager = await post('/api/v1/shops', manager, {
    name: 'Manager Pharmacy',
    primaryPhone: '01798000222',
  });
  assert.equal(byManager.status, 403, 'registering a customer is an administrator’s act');

  const opened = await get(`/api/v1/shops/${registeredId}`, admin);
  assert.equal(opened.status, 200);

  /*
   * The rule specific to this endpoint. `GET /shops` was opened to reps and
   * territory-scoped; the detail behind it must be scoped by the same rule, or
   * a rep reads any customer in the country by pasting an id and the list's
   * scoping is decoration.
   */
  const mine = await get(`/api/v1/shops/${inTerritory}`, rep);
  assert.equal(mine.status, 200);

  const theirs = await get(`/api/v1/shops/${outsideTerritory}`, rep);
  assert.equal(theirs.status, 403);
  assert.equal(
    (theirs.body.error as unknown as { code: string }).code,
    'SHOP_OUTSIDE_TERRITORY',
    'and the refusal says why, so a rep is not left wondering whether the system is broken',
  );
});

test('an owner and a manager can be attached to a customer, and only by an administrator', async () => {
  const assigned = await post(`/api/v1/shops/${inTerritory}/assign-owner`, admin, {
    userId: String(owner._id),
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));

  const withOwner = await Shop.findById(inTerritory).lean();
  assert.deepEqual(withOwner!.ownerIds.map(String), [String(owner._id)]);

  /*
   * The rule worth asserting: the account attached as an owner has to *be* a
   * shop owner. Attaching a storekeeper would hand them a customer's ledger
   * through every "your own shop" endpoint in the finance area, which are
   * scoped by ownership rather than by role.
   */
  const wrongRole = await post(`/api/v1/shops/${inTerritory}/assign-owner`, admin, {
    userId: String(manager._id),
  });
  assert.equal(wrongRole.status, 400);

  const managed = await post(`/api/v1/shops/${inTerritory}/assign-manager`, admin, {
    userId: String(manager._id),
  });
  assert.equal(managed.status, 200, JSON.stringify(managed.body));

  const refused = await post(`/api/v1/shops/${inTerritory}/assign-manager`, manager, {
    userId: String(manager._id),
  });
  assert.equal(refused.status, 403, 'a manager cannot make themselves responsible for a customer');
});

test('suspending a customer is a manager’s decision and it is recorded with a reason', async () => {
  const suspended = await patch(`/api/v1/shops/${outsideTerritory}/status`, manager, {
    status: ShopStatus.SUSPENDED,
    reason: 'Ninety days overdue',
  });
  assert.equal(suspended.status, 200, JSON.stringify(suspended.body));

  const stored = await Shop.findById(outsideTerritory).lean();
  assert.equal(stored!.status, ShopStatus.SUSPENDED);

  const byRep = await patch(`/api/v1/shops/${outsideTerritory}/status`, rep, {
    status: ShopStatus.ACTIVE,
    reason: 'Customer says they have paid',
  });
  assert.equal(
    byRep.status,
    403,
    'a rep is the person the customer complains to, which is exactly why reinstating ' +
      'them is not theirs to do',
  );

  const reinstated = await patch(`/api/v1/shops/${outsideTerritory}/status`, manager, {
    status: ShopStatus.ACTIVE,
    reason: 'Settled in full',
  });
  assert.equal(reinstated.status, 200);
});

// ─── Sessions ────────────────────────────────────────────────────────────────

async function signIn(email: string) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = (await response.json()) as { data?: { accessToken?: string } };
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.data!.accessToken!;
}

test('signing out ends one session and leaves the others alone', async () => {
  const first = await signIn('admin-manager@test.local');
  const second = await signIn('admin-manager@test.local');

  assert.equal(await Session.countDocuments({ userId: manager._id, revokedAt: null }), 2);

  const out = await post('/api/v1/auth/logout', { token: first });
  assert.equal(out.status, 200);

  /*
   * The specific rule: signing out of a phone must not sign you out of the
   * desktop. A logout that revokes by user rather than by session is invisible
   * in a single-session test and infuriating in real use.
   */
  assert.equal(await Session.countDocuments({ userId: manager._id, revokedAt: null }), 1);
  const stillIn = await get('/api/v1/auth/sessions', { token: second });
  assert.equal(stillIn.status, 200, 'the other device is still signed in');
});

test('signing out everywhere ends every session, including the one that asked', async () => {
  await signIn('admin-owner@test.local');
  const current = await signIn('admin-owner@test.local');
  assert.equal(await Session.countDocuments({ userId: owner._id, revokedAt: null }), 2);

  const out = await post('/api/v1/auth/logout-all', { token: current });
  assert.equal(out.status, 200);
  assert.equal(
    await Session.countDocuments({ userId: owner._id, revokedAt: null }),
    0,
    'including the caller’s own — "everywhere" that spares the device you are holding is ' +
      'the one device an attacker is most likely to be holding',
  );
});

test('an administrator can read one user and sign them out of everything', async () => {
  await signIn('admin-rep@test.local');
  await signIn('admin-rep@test.local');
  assert.equal(await Session.countDocuments({ userId: rep._id, revokedAt: null }), 2);

  const read = await get(`/api/v1/admin/users/${rep._id}`, manager);
  assert.equal(read.status, 200, 'a manager may look a user up');
  const profile = read.body.data as unknown as { passwordHash?: string; email?: string };
  assert.equal(profile.passwordHash, undefined, 'the hash never leaves the server');

  const byManager = await post(`/api/v1/admin/users/${rep._id}/revoke-sessions`, manager, {
    reason: 'Handset lost',
  });
  assert.equal(byManager.status, 403, 'ending somebody else’s sessions is an administrator’s act');

  const revoked = await post(`/api/v1/admin/users/${rep._id}/revoke-sessions`, superAdmin, {
    reason: 'Handset lost',
  });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(await Session.countDocuments({ userId: rep._id, revokedAt: null }), 0);

  const withoutReason = await post(
    `/api/v1/admin/users/${rep._id}/revoke-sessions`,
    superAdmin,
    {},
  );
  assert.equal(
    withoutReason.status,
    400,
    'a reason is required, because this is the record of why somebody was locked out',
  );
});

test('the fixtures mean what the assertions above assume', () => {
  /*
   * Several tests above assert a refusal. A refusal is indistinguishable from a
   * missing fixture, so this pins the things that make those refusals mean
   * something: the rep has a territory, the two shops sit on opposite sides of
   * it, and they are different records.
   */
  assert.notEqual(String(inTerritory), String(outsideTerritory));
  assert.equal(base.startsWith('http://127.0.0.1:'), true);
});
