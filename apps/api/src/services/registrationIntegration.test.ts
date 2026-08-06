import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  MedicineClassification,
  PaymentMethod,
  ShopStatus,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import jwt from 'jsonwebtoken';
import { app } from '../app';
import { AuditLog } from '../models/AuditLog';
import { Counter } from '../models/Counter';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { Order } from '../models/Order';
import { OrderApproval } from '../models/OrderApproval';
import { Shop } from '../models/Shop';
import { User } from '../models/User';
import { receiveStock } from './inventoryService';

/**
 * A pharmacy registering itself, and the reason that is not reckless.
 *
 * This feature was raised as inappropriate for a wholesale product — credit
 * terms, licence checks and price lists are decisions a distributor makes — and
 * the answer was to build it. The argument that makes it defensible is not "it
 * is behind a rate limit"; it is that **the credit check happens at approval,
 * not at submission**. A self-registered shop is created `ACTIVE` with a credit
 * limit of zero, so it can trade prepaid from the first minute and every credit
 * order it places is refused in a manager's queue until somebody sets terms.
 *
 * That argument is only worth anything if it is true, so the test that matters
 * most in this file is the one that submits a credit order from a freshly
 * registered shop and asserts a manager cannot approve it. Everything else is
 * bookkeeping around it.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const admin = { _id: new Types.ObjectId(), role: UserRole.ADMIN };
const medicineId = new Types.ObjectId();

const PASSWORD = 'Correct-Horse-1';

function headers(user?: { _id: Types.ObjectId }) {
  return {
    'content-type': 'application/json',
    ...(user
      ? { authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET!)}` }
      : {}),
  };
}

async function call(
  method: string,
  path: string,
  as: { _id: Types.ObjectId } | undefined,
  body?: unknown,
) {
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

const get = (path: string, as?: { _id: Types.ObjectId }) => call('GET', path, as);
const post = (path: string, as: { _id: Types.ObjectId } | undefined, body?: unknown) =>
  call('POST', path, as, body ?? {});
const patch = (path: string, as: { _id: Types.ObjectId } | undefined, body?: unknown) =>
  call('PATCH', path, as, body ?? {});

let sequence = 0;
function registration(over: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    firstName: 'Rahim',
    lastName: 'Uddin',
    email: `self-${sequence}@pharmacy.test`,
    password: PASSWORD,
    shopName: `Rahim Pharmacy ${sequence}`,
    primaryPhone: `0171900${String(sequence).padStart(4, '0')}`,
    drugLicenceNumber: `DL-${1000 + sequence}`,
    address: {
      label: 'Shop front',
      line1: '12 Green Road, Block C',
      city: 'Dhaka',
      district: 'Dhaka',
    },
    ...over,
  };
}

/**
 * The lines an approval takes: **by order item, at a stated price**.
 *
 * Not by medicine id. An order can carry the same medicine twice, and the price
 * an approver confirms is part of the decision rather than something looked up
 * afterwards — which is why `ApprovalDecisionSchema` asks for both.
 */
async function approvalLines(orderId: string) {
  const order = await Order.findById(orderId).lean();
  return (order!.items as Array<{ _id: Types.ObjectId; requestedQuantity: number }>).map(
    (item) => ({
      orderItemId: String(item._id),
      approvedQuantity: item.requestedQuantity,
      unitPriceMinor: 1_080,
      lineDiscountMinor: 0,
    }),
  );
}

/** Registers a shop and hands back the pieces the rest of a test needs. */
async function registerShop(over: Record<string, unknown> = {}) {
  const body = registration(over);
  const created = await post('/api/v1/auth/register', undefined, body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const user = await User.findOne({ email: body.email }).lean();
  const shop = await Shop.findOne({ primaryPhone: body.primaryPhone }).lean();
  assert.ok(user && shop);
  return { body, owner: { _id: user._id, role: UserRole.SHOP_OWNER }, shop };
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_registration'));
  await mongoose.connection.dropDatabase();
  await Promise.all([
    Counter.init(),
    Medicine.init(),
    MedicineBatch.init(),
    Order.init(),
    OrderApproval.init(),
    Shop.init(),
    User.init(),
  ]);

  await User.create(
    (
      [
        [manager, 'registration-manager', 'Branch', 'Manager'],
        [admin, 'registration-admin', 'An', 'Admin'],
      ] as const
    ).map(([who, email, firstName, lastName]) => ({
      _id: who._id,
      email: `${email}@test.local`,
      passwordHash: 'x',
      firstName,
      lastName,
      role: who.role,
      status: UserStatus.ACTIVE,
    })),
  );

  await Medicine.create({
    _id: medicineId,
    reference: 'MED-REG-000001',
    sku: 'REG-NAPA-500',
    brandName: 'Napa',
    genericName: 'Paracetamol',
    strength: '500 mg',
    dosageForm: 'TABLET',
    packSize: '10s',
    unit: 'box',
    category: 'Analgesic',
    manufacturer: 'Beximco',
    classification: MedicineClassification.OTC,
    costPriceMinor: 800,
    defaultSellingPriceMinor: 1080,
    mrpMinor: 1200,
    createdBy: manager._id,
  });
  await receiveStock(
    {
      medicineId: String(medicineId),
      batchNumber: 'REG-B1',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2028-01-01'),
      costPriceMinor: 800,
      quantity: 1000,
      warehouseLocation: 'AISLE-A',
    },
    manager,
  );

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

// ─── The argument this feature rests on ──────────────────────────────────────

test('a self-registered shop cannot get credit without a manager deciding to give it', async () => {
  /*
   * **The assertion that makes self-registration defensible.** Plant a credit
   * limit on registration — say 50,000 taka to "get them started" — and this
   * goes red, which is exactly the change somebody would make in good faith.
   *
   * The shop is ACTIVE and can submit, because `orderController` refuses a
   * submission from a shop that is not; refusing here instead would mean a
   * customer who can browse and never buy. The refusal lands where a human is
   * already looking.
   */
  const { owner, shop } = await registerShop();

  const placed = await post('/api/v1/orders/submit', owner, {
    items: [{ medicineId: String(medicineId), requestedQuantity: 5 }],
    deliveryAddressId: String(shop.deliveryAddresses[0]!._id),
    requestedPaymentMethod: PaymentMethod.CREDIT,
    idempotencyKey: 'registration-credit-1',
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const orderId = String((placed.body.data as unknown as { _id: string })._id);

  const version = async () =>
    ((await Order.findById(orderId).lean()) as unknown as { version?: number }).version ?? 0;

  await post(`/api/v1/approvals/${orderId}/start`, manager, { version: await version() });
  const refused = await post(`/api/v1/approvals/${orderId}/approve`, manager, {
    version: await version(),
    lines: await approvalLines(orderId),
    idempotencyKey: 'registration-approve-1',
  });

  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal((refused.body.error as unknown as { code: string }).code, 'CREDIT_LIMIT');
});

test('an administrator can still let one through, and has to write down why', async () => {
  /*
   * The other half. A refusal with no way past it is not a control, it is a
   * wall — and the distributor may well want this shop's first order. What the
   * design buys is that somebody senior decides, in writing, on the record.
   */
  const { owner, shop } = await registerShop();
  const placed = await post('/api/v1/orders/submit', owner, {
    items: [{ medicineId: String(medicineId), requestedQuantity: 3 }],
    deliveryAddressId: String(shop.deliveryAddresses[0]!._id),
    requestedPaymentMethod: PaymentMethod.CREDIT,
    idempotencyKey: 'registration-credit-2',
  });
  const orderId = String((placed.body.data as unknown as { _id: string })._id);
  const version = async () =>
    ((await Order.findById(orderId).lean()) as unknown as { version?: number }).version ?? 0;

  await post(`/api/v1/approvals/${orderId}/start`, admin, { version: await version() });

  // Even an administrator has to say why: an override with no reason is a
  // decision nobody can review afterwards.
  const silent = await post(`/api/v1/approvals/${orderId}/approve`, admin, {
    version: await version(),
    lines: await approvalLines(orderId),
    creditOverride: true,
    idempotencyKey: 'registration-approve-silent',
  });
  assert.equal(silent.status, 400, JSON.stringify(silent.body));
  assert.equal(
    (silent.body.error as unknown as { code: string }).code,
    'CREDIT_OVERRIDE_REASON_REQUIRED',
  );

  const allowed = await post(`/api/v1/approvals/${orderId}/approve`, admin, {
    version: await version(),
    lines: await approvalLines(orderId),
    creditOverride: true,
    internalNotes: 'New customer, licence checked by telephone, first order only.',
    idempotencyKey: 'registration-approve-2',
  });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
});

test('the same shop can buy prepaid on the day it registers', async () => {
  /*
   * The reason the shop is created ACTIVE at all. A registration that produced
   * a customer who could browse and never buy would be worse than no
   * registration: it would look broken rather than pending.
   */
  const { owner, shop } = await registerShop();
  const placed = await post('/api/v1/orders/submit', owner, {
    items: [{ medicineId: String(medicineId), requestedQuantity: 2 }],
    deliveryAddressId: String(shop.deliveryAddresses[0]!._id),
    requestedPaymentMethod: PaymentMethod.CASH,
    idempotencyKey: 'registration-cash-1',
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));

  const orderId = String((placed.body.data as unknown as { _id: string })._id);
  const version = async () =>
    ((await Order.findById(orderId).lean()) as unknown as { version?: number }).version ?? 0;
  await post(`/api/v1/approvals/${orderId}/start`, manager, { version: await version() });
  const approved = await post(`/api/v1/approvals/${orderId}/approve`, manager, {
    version: await version(),
    lines: await approvalLines(orderId),
    idempotencyKey: 'registration-approve-cash',
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
});

// ─── What registration actually creates ──────────────────────────────────────

test('the shop is active, and its four commercial terms are all at nothing', async () => {
  const { shop } = await registerShop();

  assert.equal(shop.status, ShopStatus.ACTIVE, 'a PENDING shop cannot order at all');
  assert.equal(shop.creditLimit, 0);
  assert.equal(shop.paymentTermsDays, 0);
  assert.equal(shop.defaultDiscount, 0);
  assert.equal(shop.priceListId ?? null, null);
  assert.ok(shop.selfRegisteredAt, 'nothing marks this shop as one nobody agreed to');
  assert.ok(shop.reference?.startsWith('SHP-'), 'the customer has no human-readable reference');
});

test('a customer cannot set their own commercial terms by sending them', async () => {
  /*
   * The request body is not the source of any of these. `RegisterShopSchema`
   * does not name them, so they are stripped — and the handler writes constants
   * rather than spreading `data`, which is the change that would silently
   * reintroduce this if somebody tidied the code.
   */
  const { shop } = await registerShop({
    creditLimit: 5_000_000,
    paymentTermsDays: 90,
    defaultDiscount: 25,
    status: ShopStatus.ACTIVE,
    territory: 'Dhaka North',
  });

  assert.equal(shop.creditLimit, 0);
  assert.equal(shop.paymentTermsDays, 0);
  assert.equal(shop.defaultDiscount, 0);
  assert.equal(shop.territory ?? null, null, 'a customer chose their own sales territory');
});

test('the owner is a SHOP_OWNER and nothing else', async () => {
  const { owner } = await registerShop();
  const user = await User.findById(owner._id).lean();
  assert.equal(user!.role, UserRole.SHOP_OWNER);
  assert.equal(user!.status, UserStatus.ACTIVE);
  // Nobody else has ever seen this password, so demanding an immediate change
  // would be a ritual with no threat behind it.
  assert.equal(user!.forcePasswordChange ?? false, false);
});

test('registering does not sign anybody in', async () => {
  /*
   * No token in the response and no session created. Sign-in is where lockout,
   * `forcePasswordChange` and the wrong-application refusal live; a second way
   * in that skips all three is a second thing to keep correct.
   */
  const body = registration();
  const created = await post('/api/v1/auth/register', undefined, body);
  assert.equal(created.status, 201);
  const payload = created.body.data as unknown as Record<string, unknown>;
  assert.equal(payload.accessToken, undefined);
  assert.equal(payload.refreshToken, undefined);

  // And the account works on the ordinary sign-in path.
  const signedIn = await post('/api/v1/auth/login', undefined, {
    email: body.email,
    password: PASSWORD,
  });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
});

test('both records appear, or neither does', async () => {
  /*
   * The transaction, asserted from the outside. A user with no shop can sign in
   * and reach a screen saying no shop is linked, with no way to fix it; a shop
   * with no owner is invisible to everybody. The duplicate phone is refused
   * **after** the user would have been created, so this is the case that goes
   * wrong without a transaction.
   */
  const first = await registerShop();
  const email = 'orphan-check@pharmacy.test';

  const clash = await post('/api/v1/auth/register', undefined, {
    ...registration({ email }),
    primaryPhone: first.shop.primaryPhone,
  });
  assert.equal(clash.status, 400, JSON.stringify(clash.body));
  assert.equal((clash.body.error as unknown as { code: string }).code, 'PHONE_IN_USE');

  assert.equal(
    await User.countDocuments({ email }),
    0,
    'a user account survived a registration that failed, and it owns no shop',
  );
});

test('a duplicate email says so, and a duplicate phone says so', async () => {
  // "Those details are already in use" leaves somebody retyping an email
  // address that was never the problem.
  const first = await registerShop();

  const sameEmail = await post('/api/v1/auth/register', undefined, {
    ...registration(),
    email: first.body.email,
  });
  assert.equal((sameEmail.body.error as unknown as { code: string }).code, 'EMAIL_IN_USE');

  const samePhone = await post('/api/v1/auth/register', undefined, {
    ...registration(),
    primaryPhone: first.body.primaryPhone,
  });
  assert.equal((samePhone.body.error as unknown as { code: string }).code, 'PHONE_IN_USE');
});

test('a licence number is required, unlike a shop a member of staff creates', async () => {
  /*
   * `CreateShopSchema` leaves it optional because a member of staff has spoken
   * to the customer. A stranger filling in a form has not, and the licence
   * number is the one field that can be checked against a register afterwards.
   */
  const without = registration() as Record<string, unknown>;
  delete without.drugLicenceNumber;
  const refused = await post('/api/v1/auth/register', undefined, without);
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
});

test('a phone number that is not a Bangladesh number is refused', async () => {
  const refused = await post(
    '/api/v1/auth/register',
    undefined,
    registration({ primaryPhone: '+14155550100' }),
  );
  assert.equal(refused.status, 400);
});

test('the shop starts with an address, so it can order without another form first', async () => {
  const { shop } = await registerShop();
  assert.equal(shop.deliveryAddresses.length, 1);
  assert.equal(shop.deliveryAddresses[0]!.isDefault, true);
  assert.equal(shop.billingAddress?.line1, '12 Green Road, Block C');
});

// ─── The record, and the queue it creates ────────────────────────────────────

test('registration is audited as itself, naming no member of staff', async () => {
  const { owner, shop } = await registerShop();

  const shopRecord = await AuditLog.findOne({
    action: 'SHOP_SELF_REGISTERED',
    entityId: shop._id,
  }).lean();
  assert.ok(shopRecord, 'a shop appeared in the customer list with nothing recorded about it');
  assert.equal(shopRecord.actorId?.toString(), owner._id.toString());
  assert.equal((shopRecord.after as { creditLimit?: number }).creditLimit, 0);

  const userRecord = await AuditLog.findOne({
    action: 'USER_CREATED',
    entityId: owner._id,
  }).lean();
  assert.ok(userRecord);
  assert.equal((userRecord.after as { selfRegistered?: boolean }).selfRegistered, true);

  // `createdBy` names the member of staff who created a shop. There was not
  // one, and filling it in would make the record claim a decision nobody took.
  const stored = await Shop.findById(shop._id).lean();
  assert.equal(stored!.createdBy ?? null, null);
});

test('staff can find every shop still waiting for terms, and only those', async () => {
  /*
   * The half of this feature that makes it safe to operate rather than merely
   * safe to build. Without it a manager meets a self-registered customer for
   * the first time as a refused order in the approval queue.
   *
   * A burn-down, not a label: setting a credit limit takes the shop off this
   * list, which is what makes the list worth working.
   */
  const waiting = await registerShop();

  const queue = await get('/api/v1/shops?awaitingTerms=true', manager);
  assert.equal(queue.status, 200, JSON.stringify(queue.body));
  const references = (queue.body.data as unknown as Array<{ reference: string }>).map(
    (entry) => entry.reference,
  );
  assert.ok(references.includes(waiting.shop.reference!), 'the shop is not in the terms queue');

  // A shop a member of staff created is not in it, whatever its credit limit.
  const staffCreated = await Shop.create({
    name: 'Staff Created Pharmacy',
    primaryPhone: '01799000001',
    status: ShopStatus.ACTIVE,
    creditLimit: 0,
    paymentTermsDays: 0,
    createdBy: manager._id,
  });
  const again = await get('/api/v1/shops?awaitingTerms=true', manager);
  assert.equal(
    (again.body.data as unknown as Array<{ reference: string }>).some(
      (entry) => entry.reference === staffCreated.reference,
    ),
    false,
    'a shop somebody created deliberately is being offered as unfinished work',
  );

  // And setting terms takes it off.
  const setTerms = await patch(`/api/v1/shops/${waiting.shop._id}`, admin, {
    creditLimit: 100_000_00,
    paymentTermsDays: 15,
  });
  assert.equal(setTerms.status, 200, JSON.stringify(setTerms.body));

  const after = await get('/api/v1/shops?awaitingTerms=true', manager);
  assert.equal(
    (after.body.data as unknown as Array<{ reference: string }>).some(
      (entry) => entry.reference === waiting.shop.reference,
    ),
    false,
    'the queue does not shrink when the work is done, so nobody will trust it',
  );
});

test('the queue is staff-only, like the rest of the customer list', async () => {
  const { owner } = await registerShop();
  const refused = await get('/api/v1/shops?awaitingTerms=true', owner);
  assert.equal(refused.status, 403);
});
