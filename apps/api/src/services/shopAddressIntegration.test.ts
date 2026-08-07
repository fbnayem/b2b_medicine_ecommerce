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
import { MAX_DELIVERY_ADDRESSES, hasSoleDefault } from './shopAddressRules';

/**
 * A pharmacy telling us where to deliver.
 *
 * Until this phase the only writer of `deliveryAddresses` was
 * `PATCH /shops/{id}`, which admits administrators and nobody else. That is not
 * a missing convenience: `POST /orders/submit` requires `deliveryAddressId`, so
 * **a shop with no address cannot place an order at all** — and a shop that
 * registers itself starts with none.
 *
 * The assertions worth reading twice are the two the whole design rests on:
 * exactly one address is the default after every write, and a customer cannot
 * reach anything else about their own record through these routes.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };
const otherOwner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };
const strandedOwner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };
const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const rep = { _id: new Types.ObjectId(), role: UserRole.SALES };
const farRep = { _id: new Types.ObjectId(), role: UserRole.SALES };

let shopId: Types.ObjectId;
let otherShopId: Types.ObjectId;

function headers(user: { _id: Types.ObjectId }) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET!)}`,
  };
}

async function call(method: string, path: string, as: { _id: Types.ObjectId }, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: headers(as),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.startsWith('{') ? (JSON.parse(text) as Record<string, never>) : ({} as never),
  };
}

const get = (path: string, as: { _id: Types.ObjectId }) => call('GET', path, as);
const post = (path: string, as: { _id: Types.ObjectId }, body?: unknown) =>
  call('POST', path, as, body ?? {});
const patch = (path: string, as: { _id: Types.ObjectId }, body?: unknown) =>
  call('PATCH', path, as, body ?? {});
const remove = (path: string, as: { _id: Types.ObjectId }) => call('DELETE', path, as);

const address = (label: string, extra: Record<string, unknown> = {}) => ({
  label,
  line1: `${label} Road 12, Block C`,
  city: 'Dhaka',
  district: 'Dhaka',
  ...extra,
});

/** The stored array, read straight from the document rather than the response. */
async function stored(id: Types.ObjectId = shopId) {
  const shop = await Shop.findById(id).lean();
  return (shop?.deliveryAddresses ?? []) as Array<{
    _id: Types.ObjectId;
    label: string;
    line1: string;
    isDefault: boolean;
  }>;
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_shop_addresses'));
  await mongoose.connection.dropDatabase();
  await Promise.all([Session.init(), Shop.init(), User.init()]);

  const passwordHash = await bcrypt.hash('Correct-Horse-1', 10);
  await User.create(
    (
      [
        [owner, 'address-owner', UserRole.SHOP_OWNER],
        [otherOwner, 'address-other-owner', UserRole.SHOP_OWNER],
        [strandedOwner, 'address-stranded', UserRole.SHOP_OWNER],
        [manager, 'address-manager', UserRole.MANAGER],
        [rep, 'address-rep', UserRole.SALES],
        [farRep, 'address-far-rep', UserRole.SALES],
      ] as const
    ).map(([who, email, role]) => ({
      _id: who._id,
      email: `${email}@test.local`,
      passwordHash,
      firstName: 'Test',
      lastName: 'Person',
      role,
      status: UserStatus.ACTIVE,
      // One rep covers Dhaka, the other covers somewhere else entirely. A rep
      // with no territories at all may act anywhere, which is why both are set.
      ...(role === UserRole.SALES ? { territories: [who === rep ? 'Dhaka' : 'Sylhet'] } : {}),
    })),
  );

  const shop = await Shop.create({
    name: 'Noor Pharmacy',
    primaryPhone: '01712000111',
    status: ShopStatus.ACTIVE,
    ownerIds: [owner._id],
    territory: 'Dhaka',
    creditLimit: 50_000,
    paymentTermsDays: 30,
    deliveryAddresses: [address('Shop front', { isDefault: true })],
  });
  shopId = shop._id;

  const other = await Shop.create({
    name: 'Rahat Medicos',
    primaryPhone: '01712000222',
    status: ShopStatus.ACTIVE,
    ownerIds: [otherOwner._id],
    deliveryAddresses: [address('Their shop', { isDefault: true })],
  });
  otherShopId = other._id;

  await new Promise<void>((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => {
      const found = running.address();
      if (typeof found === 'object' && found) base = `http://127.0.0.1:${found.port}`;
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

// ─── Adding ──────────────────────────────────────────────────────────────────

test('a shop owner adds an address to their own shop and it comes back with an id', async () => {
  /*
   * The id matters as much as the address. `POST /orders/submit` takes a
   * `deliveryAddressId`, and the only place that id exists is the server —
   * which is why all three routes answer with the whole list rather than a
   * bare acknowledgement.
   */
  const created = await post('/api/v1/shops/my/addresses', owner, address('Back godown'));
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const list = created.body.data as unknown as Array<{ _id: string; label: string }>;
  assert.equal(list.length, 2);
  const added = list.find((entry) => entry.label === 'Back godown');
  assert.ok(added?._id, 'the new address came back without an id, so no order can name it');
});

test('the first address a shop ever has is the default, whatever the form said', async () => {
  const empty = await Shop.create({
    name: 'Brand New Chemist',
    primaryPhone: '01712000333',
    status: ShopStatus.ACTIVE,
    ownerIds: [strandedOwner._id],
    deliveryAddresses: [],
  });

  const created = await post(
    '/api/v1/shops/my/addresses',
    strandedOwner,
    address('Only one', { isDefault: false }),
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const list = await stored(empty._id);
  assert.equal(list.length, 1);
  assert.equal(
    list[0]!.isDefault,
    true,
    'a shop with exactly one address has no other candidate; leaving it unmarked ' +
      'would give the checkout screen nothing to preselect',
  );
});

test('adding an address marked default demotes the one that held it', async () => {
  const before = await stored();
  assert.ok(
    before.some((entry) => entry.isDefault),
    'fixture assumption',
  );

  const created = await post(
    '/api/v1/shops/my/addresses',
    owner,
    address('New head office', { isDefault: true }),
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const list = await stored();
  assert.ok(hasSoleDefault(list), `two addresses claim to be the default: ${JSON.stringify(list)}`);
  assert.equal(list.find((entry) => entry.isDefault)?.label, 'New head office');
});

// ─── Changing ────────────────────────────────────────────────────────────────

test('a typo in the street can be corrected without touching anything else', async () => {
  const list = await stored();
  const target = list.find((entry) => entry.label === 'Back godown')!;

  const changed = await patch(`/api/v1/shops/my/addresses/${target._id}`, owner, {
    line1: 'Back godown, Road 14, Block D',
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));

  const after = await stored();
  const updated = after.find((entry) => String(entry._id) === String(target._id))!;
  assert.equal(updated.line1, 'Back godown, Road 14, Block D');
  assert.equal(updated.label, 'Back godown', 'a patch that mentions nothing must change nothing');
  assert.ok(hasSoleDefault(after));
});

test('an empty patch is refused rather than written', async () => {
  /*
   * `patchSchemaOf` makes every field optional, so `{}` parses. Without the
   * refinement it would reach the handler, save the document, write an audit
   * record and answer 200 — a change recorded against a request that asked for
   * none.
   */
  const list = await stored();
  const refused = await patch(`/api/v1/shops/my/addresses/${list[0]!._id}`, owner, {});
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
});

test('a shop cannot leave itself with no default by unticking the only one', async () => {
  /*
   * The request is honest — somebody unticked a box — and it is also
   * unanswerable: an order still has to go somewhere. The rule decides, and
   * the response carries the truth back so the screen redraws with the tick
   * still there rather than showing a state the server does not hold.
   */
  const list = await stored();
  const current = list.find((entry) => entry.isDefault)!;

  const answered = await patch(`/api/v1/shops/my/addresses/${current._id}`, owner, {
    isDefault: false,
  });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));

  const after = await stored();
  assert.ok(hasSoleDefault(after), 'the shop was left with no default address');
});

test('marking a different address the default moves it exactly once', async () => {
  const list = await stored();
  const target = list.find((entry) => !entry.isDefault)!;

  const changed = await patch(`/api/v1/shops/my/addresses/${target._id}`, owner, {
    isDefault: true,
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));

  const after = await stored();
  assert.ok(hasSoleDefault(after));
  assert.equal(after.find((entry) => entry.isDefault)?.label, target.label);
});

// ─── Removing ────────────────────────────────────────────────────────────────

test('removing the default promotes another, so the shop always has one', async () => {
  const list = await stored();
  assert.ok(list.length > 1, 'fixture assumption');
  const current = list.find((entry) => entry.isDefault)!;

  const removed = await remove(`/api/v1/shops/my/addresses/${current._id}`, owner);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const after = await stored();
  assert.equal(after.length, list.length - 1);
  assert.ok(
    after.every((entry) => String(entry._id) !== String(current._id)),
    'the address is still there',
  );
  assert.ok(hasSoleDefault(after), 'nothing took over as the default');
});

test('an address that does not exist is a 404 rather than a silent success', async () => {
  const missing = await remove(`/api/v1/shops/my/addresses/${new Types.ObjectId()}`, owner);
  assert.equal(missing.status, 404);
});

// ─── Whose addresses ─────────────────────────────────────────────────────────

test('one shop owner cannot touch another shop’s addresses', async () => {
  /*
   * There is no shop id in any of these paths, which is the point: the record
   * is chosen from the signed-in account, so there is no identifier to swap.
   * This asserts the consequence — that acting as the other owner reaches the
   * other shop and never this one.
   */
  const theirs = await stored(otherShopId);
  const attempt = await patch(`/api/v1/shops/my/addresses/${theirs[0]!._id}`, owner, {
    label: 'Taken over',
  });
  assert.equal(attempt.status, 404, 'an address id from another shop resolved against this one');

  const untouched = await stored(otherShopId);
  assert.equal(untouched[0]!.label, 'Their shop');
});

test('a manager has no route here at all', async () => {
  // Staff already have `PATCH /shops/{id}`, which carries the credit terms with
  // it. Admitting them to this one too would put the same fact behind two
  // doors with different audit actions on them.
  const refused = await post('/api/v1/shops/my/addresses', manager, address('From the office'));
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
});

test('an owner with no shop linked is told so, and not with a 500', async () => {
  const unlinked = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };
  await User.create({
    _id: unlinked._id,
    email: 'address-unlinked@test.local',
    passwordHash: await bcrypt.hash('Correct-Horse-1', 10),
    firstName: 'No',
    lastName: 'Shop',
    role: UserRole.SHOP_OWNER,
    status: UserStatus.ACTIVE,
  });

  const answered = await post('/api/v1/shops/my/addresses', unlinked, address('Nowhere'));
  assert.equal(answered.status, 404);
  assert.equal((answered.body.error as unknown as { code: string }).code, 'NO_SHOP');
});

// ─── The limits, and the record ──────────────────────────────────────────────

test('a shop cannot grow its own document without limit', async () => {
  const filler = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };
  await User.create({
    _id: filler._id,
    email: 'address-filler@test.local',
    passwordHash: await bcrypt.hash('Correct-Horse-1', 10),
    firstName: 'Many',
    lastName: 'Branches',
    role: UserRole.SHOP_OWNER,
    status: UserStatus.ACTIVE,
  });
  const chain = await Shop.create({
    name: 'Big Chain Pharmacy',
    primaryPhone: '01712000444',
    status: ShopStatus.ACTIVE,
    ownerIds: [filler._id],
    deliveryAddresses: Array.from({ length: MAX_DELIVERY_ADDRESSES }, (_, index) =>
      address(`Branch ${index + 1}`, { isDefault: index === 0 }),
    ),
  });

  const refused = await post('/api/v1/shops/my/addresses', filler, address('One too many'));
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.equal((refused.body.error as unknown as { code: string }).code, 'TOO_MANY_ADDRESSES');
  assert.equal((await stored(chain._id)).length, MAX_DELIVERY_ADDRESSES);
});

test('a rider’s destination changing is recorded, with what it was before', async () => {
  /*
   * Where medicines are delivered is a sensitive fact — it is the address a
   * controlled substance arrives at — so `AGENTS.md`'s audit rule applies. The
   * `before` is the half that matters: knowing an address changed is of no use
   * to anybody investigating unless the previous one is there too.
   */
  const list = await stored();
  const target = list[0]!;
  await patch(`/api/v1/shops/my/addresses/${target._id}`, owner, { city: 'Gazipur' });

  const record = await AuditLog.findOne({ action: 'SHOP_ADDRESS_UPDATED', entityId: shopId })
    .sort({ createdAt: -1 })
    .lean();
  assert.ok(record, 'the change was not recorded');
  assert.equal(record.actorId?.toString(), owner._id.toString());
  assert.equal((record.before as { city?: string })?.city, 'Dhaka');
  assert.equal((record.after as { city?: string })?.city, 'Gazipur');
});

test('adding and removing are recorded too, so the trail has no gaps', async () => {
  const actions = await AuditLog.find({ entityType: 'Shop', entityId: shopId }).distinct('action');
  assert.deepEqual(
    [...actions].sort(),
    ['SHOP_ADDRESS_ADDED', 'SHOP_ADDRESS_REMOVED', 'SHOP_ADDRESS_UPDATED'],
    'a delivery address can be created or destroyed with nothing written down',
  );
});

test('the addresses a customer maintains are the ones the order screen reads', async () => {
  /*
   * The reconciliation that makes the rest of this file worth running:
   * `GET /shops/my` is what checkout loads, and if these writes went anywhere
   * else — a separate collection, a different field — every assertion above
   * would pass while the address never appeared on the screen that needs it.
   */
  const mine = await get('/api/v1/shops/my', owner);
  assert.equal(mine.status, 200);
  const shops = mine.body.data as unknown as Array<{ deliveryAddresses: unknown[] }>;
  assert.equal(shops.length, 1);
  assert.deepEqual(
    (shops[0]!.deliveryAddresses as Array<{ label: string }>).map((entry) => entry.label).sort(),
    (await stored()).map((entry) => entry.label).sort(),
  );
});

// ─── The staff route ─────────────────────────────────────────────────────────

/**
 * `POST /shops/{id}/addresses`, which exists because the order-entry screen
 * has offered "add an address" since the order-entry phase and wrote it through
 * `PATCH /shops/{id}` — administrators only. Every manager and every sales
 * representative filling that form in got a 403, and the browser test covering
 * the button signs in as an administrator, so nothing caught it.
 */
test('a manager adds an address for a named customer, which used to be a 403', async () => {
  const before = (await stored()).length;
  const created = await post(`/api/v1/shops/${shopId}/addresses`, manager, address('Counter'));
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const list = await stored();
  assert.equal(list.length, before + 1, 'the address was not appended');
  assert.ok(
    list.some((entry) => entry.label === 'Counter'),
    'the manager’s address is not on the shop',
  );
});

test('a sales representative may too, for a customer in their own area', async () => {
  // The role that exists to take an order at a counter is the role most likely
  // to find that the address is not on file.
  const created = await post(`/api/v1/shops/${shopId}/addresses`, rep, address('Side entrance'));
  assert.equal(created.status, 201, JSON.stringify(created.body));
});

test('and may not, for a customer who is not theirs', async () => {
  /*
   * The list and the detail are both narrowed by territory. A write that was
   * not would let a rep put a delivery address on any customer in the country
   * by pasting an id — scoping that only looks like scoping.
   */
  const refused = await post(`/api/v1/shops/${shopId}/addresses`, farRep, address('Nowhere'));
  assert.equal(refused.status, 403);
  assert.equal(
    (refused.body as unknown as { error: { code: string } }).error.code,
    'SHOP_OUTSIDE_TERRITORY',
  );
  assert.ok(
    !(await stored()).some((entry) => entry.label === 'Nowhere'),
    'a refused request wrote an address anyway',
  );
});

test('a shop owner cannot reach the staff route at all', async () => {
  // Their own route is `/shops/my/addresses`. This one names a customer, and a
  // customer naming another customer is the whole reason the paths differ.
  const refused = await post(`/api/v1/shops/${otherShopId}/addresses`, owner, address('Theirs'));
  assert.equal(refused.status, 403);
});

test('adding an address changes nothing else about the customer', async () => {
  /*
   * **The assertion this route exists for.** The alternative fix was to open
   * `PATCH /shops/{id}` to managers and reps — and that endpoint also carries
   * the credit limit, the payment terms, the discount, the price list and the
   * status. A rep who may set a credit limit is a different product.
   */
  const before = await Shop.findById(shopId).lean();
  await post(`/api/v1/shops/${shopId}/addresses`, manager, {
    ...address('Trojan'),
    creditLimit: 999_999,
    paymentTermsDays: 365,
    status: ShopStatus.SUSPENDED,
    defaultDiscount: 50,
  });
  const after = await Shop.findById(shopId).lean();

  assert.equal(after?.creditLimit, before?.creditLimit);
  assert.equal(after?.paymentTermsDays, before?.paymentTermsDays);
  assert.equal(after?.status, before?.status);
  assert.equal(after?.defaultDiscount, before?.defaultDiscount);
});

test('the staff route keeps the one-default invariant, and records who did it', async () => {
  const created = await post(`/api/v1/shops/${shopId}/addresses`, manager, {
    ...address('New default'),
    isDefault: true,
  });
  assert.equal(created.status, 201);

  const list = await stored();
  assert.ok(hasSoleDefault(list), 'the shop is left with two defaults or none');
  assert.equal(list.find((entry) => entry.isDefault)?.label, 'New default');

  const record = await AuditLog.findOne({ action: 'SHOP_ADDRESS_ADDED', entityId: shopId })
    .sort({ createdAt: -1 })
    .lean();
  assert.equal(record?.actorId?.toString(), manager._id.toString());
  assert.equal(record?.actorRole, UserRole.MANAGER);
});

test('staff can take an address off again, which they could not', async () => {
  /*
   * Phase 38 gave staff an add and nothing else, so a manager who mistyped an
   * address could add another and never remove the first — a list that grew in
   * one direction only. The browser test that adds one on every run reached the
   * twenty-address ceiling having never undone what it did, which is how the
   * asymmetry surfaced.
   */
  const created = await post(`/api/v1/shops/${shopId}/addresses`, manager, address('Temporary'));
  assert.equal(created.status, 201);
  const added = (await stored()).find((entry) => entry.label === 'Temporary')!;
  assert.ok(added, 'the address to remove was not created');

  const removed = await remove(`/api/v1/shops/${shopId}/addresses/${added._id}`, manager);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.ok(
    !(await stored()).some((entry) => entry.label === 'Temporary'),
    'the address is still on the shop',
  );
});

test('removing the default promotes another, rather than leaving none', async () => {
  // The invariant the whole address design rests on, asserted through the staff
  // route as well as the customer's: exactly one default, always.
  const list = await stored();
  const current = list.find((entry) => entry.isDefault)!;
  assert.ok(current, 'the shop had no default to remove');

  const removed = await remove(`/api/v1/shops/${shopId}/addresses/${current._id}`, manager);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const after = await stored();
  assert.ok(after.length > 0);
  assert.ok(hasSoleDefault(after), 'the shop was left with two defaults or none');
});

test('a representative may not remove an address for a customer outside their area', async () => {
  const list = await stored();
  const refused = await remove(`/api/v1/shops/${shopId}/addresses/${list[0]!._id}`, farRep);
  assert.equal(refused.status, 403);
});
