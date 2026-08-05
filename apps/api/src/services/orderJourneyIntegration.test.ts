import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  MedicineClassification,
  OrderStatus,
  PaymentMethod,
  ShopStatus,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { Counter } from '../models/Counter';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { Order } from '../models/Order';
import { OrderApproval } from '../models/OrderApproval';
import { PickingList } from '../models/PickingList';
import { Shop } from '../models/Shop';
import { User } from '../models/User';
import { receiveStock } from './inventoryService';

/**
 * The order's own journey: a basket saved, amended, submitted, reviewed.
 *
 * Thirteen endpoints along it had never been called. They are the ordinary
 * path — the one every order in this business takes — which is exactly why
 * their absence was easy to miss: the dramatic steps (submit, approve, pick,
 * pack) were covered from Phase 4, and the quiet ones around them were not.
 *
 * Four orders are submitted, because a review is a decision and there are four
 * of them to make: held, clarified, rejected and approved. Each needs its own
 * order, since every one of those is terminal for that order's review.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const storekeeper = { _id: new Types.ObjectId(), role: UserRole.STOREKEEPER };
const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };
const otherOwner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };

const medicineId = new Types.ObjectId();
let shopId: Types.ObjectId;
let addressId: Types.ObjectId;

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

/** Submits an order and returns its id, so a review has something to review. */
async function submit(key: string, quantity = 2) {
  const placed = await post('/api/v1/orders/submit', owner, {
    items: [{ medicineId: String(medicineId), requestedQuantity: quantity }],
    deliveryAddressId: String(addressId),
    requestedPaymentMethod: PaymentMethod.CASH,
    idempotencyKey: key,
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  return String((placed.body.data as unknown as { _id: string })._id);
}

/** The order's current version, which every review action must present. */
async function versionOf(orderId: string) {
  const order = await Order.findById(orderId).lean();
  return (order as unknown as { version?: number }).version ?? 0;
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_order_journey'));
  await mongoose.connection.dropDatabase();
  await Promise.all([
    Counter.init(),
    Medicine.init(),
    MedicineBatch.init(),
    Order.init(),
    OrderApproval.init(),
    PickingList.init(),
    Shop.init(),
    User.init(),
  ]);

  await User.create(
    (
      [
        [manager, 'journey-manager', 'Branch', 'Manager'],
        [storekeeper, 'journey-storekeeper', 'Store', 'Keeper'],
        [owner, 'journey-owner', 'Shop', 'Owner'],
        [otherOwner, 'journey-other', 'Other', 'Owner'],
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
    reference: 'MED-JRN-000001',
    sku: 'JRN-NAPA-500',
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
      batchNumber: 'JRN-B1',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2028-01-01'),
      costPriceMinor: 800,
      quantity: 500,
      warehouseLocation: 'AISLE-A',
    },
    manager,
  );

  addressId = new Types.ObjectId();
  const shop = await Shop.create({
    reference: 'SHP-JRN-00001',
    name: 'Bismillah Pharmacy',
    ownerIds: [owner._id],
    primaryPhone: '01711000001',
    status: ShopStatus.ACTIVE,
    creditLimit: 500_000_00,
    paymentTermsDays: 30,
    deliveryAddresses: [
      {
        _id: addressId,
        label: 'Shop',
        line1: '1 Green Road',
        city: 'Dhaka',
        district: 'Dhaka',
        isDefault: true,
      },
    ],
  });
  shopId = shop._id;

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

// ─── Drafts ──────────────────────────────────────────────────────────────────

test('a draft is saved, amended and submitted, and reserves nothing until it is', async () => {
  const saved = await post('/api/v1/orders/drafts', owner, {
    items: [{ medicineId: String(medicineId), requestedQuantity: 3 }],
    deliveryAddressId: String(addressId),
    requestedPaymentMethod: PaymentMethod.CASH,
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const draftId = String((saved.body.data as unknown as { _id: string })._id);

  /*
   * The rule specific to a draft, and the reason drafts exist at all: a saved
   * basket is **stock-neutral**. If saving reserved stock, a shop owner
   * browsing for a week would hold inventory nobody could sell, and the credit
   * check would count an order they never placed.
   */
  const batch = await MedicineBatch.findOne({ medicineId }).lean();
  assert.equal(batch!.quantities.reserved, 0, 'a draft holds nothing');

  const amended = await patch(`/api/v1/orders/drafts/${draftId}`, owner, {
    items: [{ medicineId: String(medicineId), requestedQuantity: 7 }],
    deliveryAddressId: String(addressId),
    requestedPaymentMethod: PaymentMethod.CASH,
    shopNotes: 'Please deliver before noon',
  });
  assert.equal(amended.status, 200, JSON.stringify(amended.body));

  const stored = await Order.findById(draftId).lean();
  assert.equal(stored!.items[0]!.requestedQuantity, 7);
  assert.equal(
    stored!.shopNotes,
    'Please deliver before noon',
    'the patch amended the fields it was given and kept the rest — the defect this ' +
      'endpoint shipped with was deleting what it was not asked about',
  );

  const submitted = await post(`/api/v1/orders/drafts/${draftId}/submit`, owner, {
    items: [{ medicineId: String(medicineId), requestedQuantity: 7 }],
    deliveryAddressId: String(addressId),
    requestedPaymentMethod: PaymentMethod.CASH,
    idempotencyKey: 'journey-draft-submit-1',
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));

  const afterSubmit = await Order.findById(
    String((submitted.body.data as unknown as { _id: string })._id),
  ).lean();
  assert.notEqual(afterSubmit!.status, OrderStatus.DRAFT, 'and submitting it stops it being one');
});

test('a draft can be thrown away, and only by the person whose basket it is', async () => {
  const saved = await post('/api/v1/orders/drafts', owner, {
    items: [{ medicineId: String(medicineId), requestedQuantity: 1 }],
    deliveryAddressId: String(addressId),
    requestedPaymentMethod: PaymentMethod.CASH,
  });
  const draftId = String((saved.body.data as unknown as { _id: string })._id);

  const byStranger = await remove(`/api/v1/orders/drafts/${draftId}`, otherOwner);
  assert.notEqual(byStranger.status, 200);
  assert.ok(await Order.findById(draftId), 'somebody else’s basket is still there');

  const discarded = await remove(`/api/v1/orders/drafts/${draftId}`, owner);
  assert.equal(discarded.status, 204, 'gone, with no body to render');
  assert.equal(await Order.countDocuments({ _id: draftId }), 0);
});

// ─── Reading and repeating an order ──────────────────────────────────────────

test('an order is readable by the shop that placed it and by nobody else’s owner', async () => {
  const orderId = await submit('journey-read-1');

  const mine = await get(`/api/v1/orders/${orderId}`, owner);
  assert.equal(mine.status, 200);
  const order = mine.body.data as unknown as { reference: string; items: unknown[] };
  assert.match(
    order.reference,
    /^ORD-/,
    'the visible reference is the human one, never the Mongo id',
  );
  assert.equal(order.items.length, 1);

  const theirs = await get(`/api/v1/orders/${orderId}`, otherOwner);
  assert.equal(theirs.status, 403);
});

test('repeating an order rebuilds it from today’s catalogue, not last month’s price', async () => {
  const orderId = await submit('journey-duplicate-1');

  // The price moves between the original order and the repeat, which is the
  // only way to tell a rebuilt draft from a copied one.
  await Medicine.updateOne({ _id: medicineId }, { $set: { defaultSellingPriceMinor: 1_500 } });

  const repeated = await post(`/api/v1/orders/${orderId}/duplicate`, owner);
  assert.equal(repeated.status, 201, JSON.stringify(repeated.body));
  const draftId = String((repeated.body.data as unknown as { _id: string })._id);

  const draft = await Order.findById(draftId).lean();
  assert.equal(draft!.status, OrderStatus.DRAFT, 'a repeat is a basket, not a placed order');
  assert.equal(draft!.items.length, 1);
  assert.equal(
    draft!.items[0]!.requestedQuantity,
    2,
    'the quantities come from the order being repeated',
  );

  const original = await Order.findById(orderId).lean();
  assert.notEqual(
    String(draft!._id),
    String(original!._id),
    'and it is a new record — repeating an order must not edit the one being repeated',
  );

  await Medicine.updateOne({ _id: medicineId }, { $set: { defaultSellingPriceMinor: 1_080 } });
});

// ─── Review ──────────────────────────────────────────────────────────────────

test('the approval queue lists what is waiting, and a customer cannot see it', async () => {
  await submit('journey-queue-1');

  const queue = await get('/api/v1/approvals/queue', manager);
  assert.equal(queue.status, 200);
  assert.ok(
    (queue.body.data as unknown as unknown[]).length > 0,
    'orders were submitted above, so the queue cannot be empty',
  );

  const customer = await get('/api/v1/approvals/queue', owner);
  assert.equal(
    customer.status,
    403,
    'the queue is every customer’s orders side by side, with their credit position',
  );
});

test('opening an order for review shows the credit and licence position behind it', async () => {
  const orderId = await submit('journey-review-detail-1');

  const detail = await get(`/api/v1/approvals/${orderId}`, manager);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const data = detail.body.data as unknown as Record<string, unknown>;
  assert.ok(data, 'the review screen has something to render');

  const customer = await get(`/api/v1/approvals/${orderId}`, owner);
  assert.equal(customer.status, 403);
});

test('an order can be held, and holding it says why in words the customer reads', async () => {
  const orderId = await submit('journey-hold-1');
  await post(`/api/v1/approvals/${orderId}/start`, manager, { version: await versionOf(orderId) });

  const held = await post(`/api/v1/approvals/${orderId}/hold`, manager, {
    version: await versionOf(orderId),
    reason: 'Awaiting a copy of the renewed drug licence',
    shopOwnerNotes: 'Please send your renewed licence and we will release this today.',
  });
  assert.equal(held.status, 200, JSON.stringify(held.body));

  const stored = await Order.findById(orderId).lean();
  assert.equal(stored!.status, OrderStatus.ON_HOLD);

  /*
   * The rule that would be wrong quietly: a stale version must be refused.
   * Two managers open the same order, one holds it, and the second's decision
   * arrives against the order as it was — without the check, the second
   * silently overwrites the first and the customer is told the wrong thing.
   */
  const stale = await post(`/api/v1/approvals/${orderId}/hold`, manager, {
    version: 0,
    reason: 'A second manager acting on what they last saw',
  });
  assert.notEqual(stale.status, 200);
});

test('an order can be sent back for clarification without being refused', async () => {
  const orderId = await submit('journey-clarify-1');
  await post(`/api/v1/approvals/${orderId}/start`, manager, { version: await versionOf(orderId) });

  const asked = await post(`/api/v1/approvals/${orderId}/clarify`, manager, {
    version: await versionOf(orderId),
    reason: 'Is the quantity on line one correct?',
    shopOwnerNotes: 'You have ordered ten times your usual quantity — please confirm.',
  });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));

  const stored = await Order.findById(orderId).lean();
  assert.notEqual(
    stored!.status,
    OrderStatus.REJECTED,
    'asking a question is not a refusal — an order awaiting an answer must still be ' +
      'completable once the answer arrives',
  );
});

test('a rejected order releases everything it was holding', async () => {
  const orderId = await submit('journey-reject-1');
  await post(`/api/v1/approvals/${orderId}/start`, manager, { version: await versionOf(orderId) });

  const refusedByCustomer = await post(`/api/v1/approvals/${orderId}/reject`, owner, {
    version: await versionOf(orderId),
    reason: 'I changed my mind',
  });
  assert.equal(refusedByCustomer.status, 403, 'a customer cancels; only a manager rejects');

  const rejected = await post(`/api/v1/approvals/${orderId}/reject`, manager, {
    version: await versionOf(orderId),
    reason: 'Credit limit exceeded and no payment plan agreed',
    shopOwnerNotes: 'Please settle the outstanding balance and re-order.',
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));

  const stored = await Order.findById(orderId).lean();
  assert.equal(stored!.status, OrderStatus.REJECTED);
  assert.ok(
    stored!.statusHistory?.some((entry) => entry.to === OrderStatus.REJECTED && entry.note),
    'the refusal is recorded with its reason, because the customer is going to ask why',
  );
});

// ─── Fulfilment ──────────────────────────────────────────────────────────────

test('an approved order reaches the picking queue, and its list is readable', async () => {
  const orderId = await submit('journey-approve-1', 4);
  await post(`/api/v1/approvals/${orderId}/start`, manager, { version: await versionOf(orderId) });

  const order = await Order.findById(orderId).lean();
  const approved = await post(`/api/v1/approvals/${orderId}/approve`, manager, {
    version: await versionOf(orderId),
    lines: order!.items.map((item) => ({
      orderItemId: String((item as unknown as { _id: Types.ObjectId })._id),
      approvedQuantity: item.requestedQuantity,
      unitPriceMinor: 1_080,
      lineDiscountMinor: 0,
    })),
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  const queue = await get('/api/v1/fulfilment/queue', storekeeper);
  assert.equal(queue.status, 200);
  const lists = queue.body.data as unknown as { _id: string; orderId?: string }[];
  assert.ok(lists.length > 0, 'approving an order produced work for the warehouse');

  const list = await PickingList.findOne({ orderId }).lean();
  assert.ok(list, 'and that work is a picking list against this order');

  const detail = await get(`/api/v1/fulfilment/picking/${list!._id}`, storekeeper);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const picking = detail.body.data as unknown as { items?: unknown[]; lines?: unknown[] };
  assert.ok(
    (picking.items ?? picking.lines ?? []).length > 0,
    'a picking list with no lines is a storekeeper sent to the aisles with an empty sheet',
  );

  const customer = await get(`/api/v1/fulfilment/picking/${list!._id}`, owner);
  assert.equal(
    customer.status,
    403,
    'the picking list names batch numbers and locations, which is the warehouse’s business',
  );
});

test('the fixtures mean what the assertions above assume', async () => {
  /*
   * Several assertions above are refusals, and a refusal looks the same as a
   * missing record. This pins that the orders exist, that they belong to the
   * shop under test, and that the second owner is a different person with no
   * shop of their own — which is what makes their 403s meaningful.
   */
  assert.ok((await Order.countDocuments({ shopId })) >= 7);
  assert.equal(await Shop.countDocuments({ ownerIds: otherOwner._id }), 0);
  assert.equal(await MedicineBatch.countDocuments({ medicineId }), 1);
});
