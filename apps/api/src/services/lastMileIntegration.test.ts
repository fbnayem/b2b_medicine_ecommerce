import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  DeliveryStatus,
  MedicineClassification,
  OrderStatus,
  ReturnStatus,
  ShopStatus,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { Counter } from '../models/Counter';
import { CreditNote } from '../models/CreditNote';
import { Delivery } from '../models/Delivery';
import { Invoice } from '../models/Invoice';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { Order } from '../models/Order';
import { Package } from '../models/Package';
import { ProofFile } from '../models/ProofFile';
import { Return } from '../models/Return';
import { Shop } from '../models/Shop';
import { User } from '../models/User';
import { receiveStock } from './inventoryService';

/**
 * The last mile, and what comes back along it.
 *
 * The final tranche of the burn-down: the delivery board a rider and an office
 * both read, the return workflow from request to credit note, and the four
 * management reports that summarise all of it.
 *
 * The scoping here is the sharpest in the product and the least obvious. A
 * delivery is visible to **the rider it is assigned to** and to **the shop it
 * is going to**, and to nobody else in either of those roles — one filter keyed
 * on `assignedTo`, one on shop ownership, and both applied to the same record.
 * Getting one of those right and the other wrong looks identical in any test
 * that only signs in as a manager.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const storekeeper = { _id: new Types.ObjectId(), role: UserRole.STOREKEEPER };
const rider = { _id: new Types.ObjectId(), role: UserRole.DELIVERY_PERSON };
const otherRider = { _id: new Types.ObjectId(), role: UserRole.DELIVERY_PERSON };
const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };
const otherOwner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };

const medicineId = new Types.ObjectId();
let batchId: Types.ObjectId;
let shopId: Types.ObjectId;
let invoiceId: Types.ObjectId;
let deliveryId: Types.ObjectId;
let cancellableId: Types.ObjectId;
let proofId: Types.ObjectId;

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
    contentType: response.headers.get('content-type') ?? '',
    body: text.startsWith('{') ? (JSON.parse(text) as Record<string, never>) : ({} as never),
    text,
  };
}

const get = (path: string, as: { _id: Types.ObjectId }) => call('GET', path, as);
const post = (path: string, as: { _id: Types.ObjectId }, body?: unknown) =>
  call('POST', path, as, body ?? {});

/** The version a return action must present, so a stale decision is refused. */
async function returnVersion(id: Types.ObjectId | string) {
  const record = await Return.findById(id).lean();
  return (record as unknown as { version?: number }).version ?? 0;
}

async function makeDelivery(suffix: string, status: DeliveryStatus, assignedTo?: Types.ObjectId) {
  const orderId = new Types.ObjectId();
  const packageId = new Types.ObjectId();
  const perDeliveryInvoice = new Types.ObjectId();
  await Package.create({
    _id: packageId,
    reference: `PKG-LM-${suffix}`,
    orderId,
    invoiceId: perDeliveryInvoice,
    packageCount: 1,
    barcode: `PKG-LM-${suffix}-BARCODE`,
    packedBy: storekeeper._id,
    packedAt: new Date(),
  });
  return Delivery.create({
    reference: `DLV-LM-${suffix}`,
    orderId,
    packageId,
    invoiceId: perDeliveryInvoice,
    shopId,
    addressSnapshot: { line1: '1 Green Road', city: 'Dhaka', district: 'Dhaka' },
    contactSnapshot: { name: 'Bismillah Pharmacy', phone: '01711000001' },
    status,
    assignedTo,
    assignedBy: assignedTo ? manager._id : undefined,
    assignedAt: assignedTo ? new Date() : undefined,
    expectedDeliveryDate: new Date(Date.now() + 86_400_000),
    history: [
      {
        to: DeliveryStatus.READY_FOR_ASSIGNMENT,
        actorId: manager._id,
        actorRole: UserRole.MANAGER,
        at: new Date(),
      },
    ],
  });
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_last_mile'));
  await mongoose.connection.dropDatabase();
  await Promise.all([
    Counter.init(),
    CreditNote.init(),
    Delivery.init(),
    Invoice.init(),
    Medicine.init(),
    MedicineBatch.init(),
    Order.init(),
    Package.init(),
    ProofFile.init(),
    Return.init(),
    Shop.init(),
    User.init(),
  ]);

  await User.create(
    (
      [
        [manager, 'lm-manager', 'Branch', 'Manager'],
        [storekeeper, 'lm-storekeeper', 'Store', 'Keeper'],
        [rider, 'lm-rider', 'Assigned', 'Rider'],
        [otherRider, 'lm-other-rider', 'Another', 'Rider'],
        [owner, 'lm-owner', 'Shop', 'Owner'],
        [otherOwner, 'lm-other-owner', 'Other', 'Owner'],
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

  const shop = await Shop.create({
    reference: 'SHP-LM-00001',
    name: 'Bismillah Pharmacy',
    ownerIds: [owner._id],
    primaryPhone: '01711000001',
    status: ShopStatus.ACTIVE,
    creditLimit: 500_000_00,
    paymentTermsDays: 30,
    deliveryAddresses: [
      { label: 'Shop', line1: '1 Green Road', city: 'Dhaka', district: 'Dhaka', isDefault: true },
    ],
  });
  shopId = shop._id;

  await Medicine.create({
    _id: medicineId,
    reference: 'MED-LM-000001',
    sku: 'LM-NAPA-500',
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
    defaultSellingPriceMinor: 1_250,
    mrpMinor: 1_500,
    createdBy: manager._id,
  });
  const batch = await receiveStock(
    {
      medicineId: String(medicineId),
      batchNumber: 'LM-B1',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2028-01-01'),
      costPriceMinor: 800,
      quantity: 200,
      warehouseLocation: 'AISLE-A',
    },
    manager,
  );
  batchId = (batch as unknown as { _id: Types.ObjectId })._id;

  // A delivered order and its invoice, so a return has something to be against.
  const order = await Order.create({
    reference: 'ORD-LM-000001',
    shopId,
    placedBy: owner._id,
    deliveryAddressSnapshot: { line1: '1 Green Road', city: 'Dhaka', district: 'Dhaka' },
    items: [
      {
        medicineId,
        medicineSnapshot: {
          brandName: 'Napa',
          genericName: 'Paracetamol',
          strength: '500 mg',
          packSize: '10s',
          unit: 'box',
          manufacturer: 'Beximco',
          classification: MedicineClassification.OTC,
        },
        requestedQuantity: 20,
        approvedQuantity: 20,
        unitPriceMinor: 1_250,
        estimatedUnitPriceMinor: 1_250,
        estimatedDiscountMinor: 0,
        estimatedLineTotalMinor: 25_000,
        availableStockSnapshot: 200,
      },
    ],
    submittedBy: owner._id,
    status: OrderStatus.DELIVERED,
    statusHistory: [{ to: OrderStatus.DELIVERED, actorId: owner._id, at: new Date() }],
    submittedAt: new Date(),
  });
  const invoice = await Invoice.create({
    reference: 'INV-LM-000001',
    orderId: order._id,
    shopId,
    supplierSnapshot: { name: 'MedSupply B2B' },
    shopSnapshot: { reference: shop.reference, name: shop.name },
    orderSnapshot: { reference: order.reference },
    deliveryAddressSnapshot: { line1: '1 Green Road', city: 'Dhaka', district: 'Dhaka' },
    items: [
      {
        medicineId,
        medicineSnapshot: {
          brandName: 'Napa',
          genericName: 'Paracetamol',
          strength: '500 mg',
          packSize: '10s',
          unit: 'box',
          manufacturer: 'Beximco',
          classification: MedicineClassification.OTC,
        },
        batchId,
        batchNumber: 'LM-B1',
        expiryDate: new Date('2028-01-01'),
        quantity: 20,
        unitPriceMinor: 1_250,
        discountMinor: 0,
        lineTotalMinor: 25_000,
      },
    ],
    subtotalMinor: 25_000,
    orderDiscountMinor: 0,
    deliveryChargeMinor: 0,
    taxMinor: 0,
    previousBalanceMinor: 0,
    grandTotalMinor: 25_000,
    amountDueMinor: 25_000,
    totalOutstandingMinor: 25_000,
    paymentTermsDays: 30,
    invoiceDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86_400_000),
    issuedBy: manager._id,
    issuedAt: new Date(),
  });
  invoiceId = invoice._id;

  const assigned = await makeDelivery('00001', DeliveryStatus.ASSIGNED, rider._id);
  deliveryId = assigned._id;
  const waiting = await makeDelivery('00002', DeliveryStatus.READY_FOR_ASSIGNMENT);
  cancellableId = waiting._id;

  const bytes = Buffer.from('signature-image-bytes');
  const proof = await ProofFile.create({
    deliveryId,
    purpose: 'SIGNATURE',
    fileName: 'signature.png',
    mimeType: 'image/png',
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    data: bytes,
    uploadedBy: rider._id,
  });
  proofId = proof._id;

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

// ─── The delivery board ──────────────────────────────────────────────────────

test('the board shows a rider their own round and the office everybody’s', async () => {
  const office = await get('/api/v1/deliveries?limit=50', manager);
  assert.equal(office.status, 200);
  const officeReferences = (office.body.data as unknown as { reference: string }[]).map(
    (row) => row.reference,
  );
  assert.ok(officeReferences.includes('DLV-LM-00001'));
  assert.ok(officeReferences.includes('DLV-LM-00002'), 'including what is not yet assigned');

  /*
   * The rule that would be wrong quietly. A rider's board is filtered to what
   * is assigned to them; without that clause the list still returns 200 and
   * still contains their own stops, so every naive assertion passes while a
   * rider reads the addresses and phone numbers of every customer in the city.
   */
  const mine = await get('/api/v1/deliveries?limit=50', rider);
  assert.equal(mine.status, 200);
  const riderReferences = (mine.body.data as unknown as { reference: string }[]).map(
    (row) => row.reference,
  );
  assert.deepEqual(riderReferences, ['DLV-LM-00001']);

  const idle = await get('/api/v1/deliveries?limit=50', otherRider);
  assert.deepEqual(
    (idle.body.data as unknown as unknown[]).length,
    0,
    'a rider with nothing assigned has an empty round, not the whole board',
  );

  const customer = await get('/api/v1/deliveries?limit=50', owner);
  assert.equal(customer.status, 200);
  assert.ok(
    (customer.body.data as unknown as unknown[]).length >= 1,
    'a customer sees deliveries coming to them',
  );
});

test('one delivery opens for the rider carrying it and the shop expecting it', async () => {
  for (const who of [manager, rider, owner]) {
    const opened = await get(`/api/v1/deliveries/${deliveryId}`, who);
    assert.equal(opened.status, 200, 'each of these has a reason to look at it');
  }

  const strangerRider = await get(`/api/v1/deliveries/${deliveryId}`, otherRider);
  assert.equal(strangerRider.status, 403, 'a rider it was not given to');

  const strangerOwner = await get(`/api/v1/deliveries/${deliveryId}`, otherOwner);
  assert.equal(strangerOwner.status, 403, 'and a shop it is not going to');
});

test('the office can see who is available to carry it', async () => {
  const people = await get('/api/v1/deliveries/personnel', manager);
  assert.equal(people.status, 200);
  assert.ok(
    (people.body.data as unknown as unknown[]).length >= 2,
    'both riders are available to be assigned',
  );

  const byRider = await get('/api/v1/deliveries/personnel', rider);
  assert.equal(
    byRider.status,
    403,
    'a rider planning their own assignment is the office’s job, not theirs',
  );
});

test('proof of delivery is reachable by the people the delivery concerns, and no others', async () => {
  const byRider = await get(`/api/v1/deliveries/proof/${proofId}`, rider);
  assert.equal(byRider.status, 200);
  assert.match(byRider.contentType, /image\/png/);
  assert.equal(byRider.text, 'signature-image-bytes');

  const byCustomer = await get(`/api/v1/deliveries/proof/${proofId}`, owner);
  assert.equal(byCustomer.status, 200, 'the customer signed it; they may see it');

  /*
   * A proof file carries a signature and a photograph of somebody's premises.
   * The handler looks the file up first and *then* checks the delivery, so the
   * scoping has to travel through the delivery — a check that only looked at
   * the file id would let any signed-in person walk the collection.
   */
  const stranger = await get(`/api/v1/deliveries/proof/${proofId}`, otherOwner);
  assert.equal(stranger.status, 403);
});

test('a delivery that has not left can be cancelled, and only by the office', async () => {
  const byRider = await post(`/api/v1/deliveries/${cancellableId}/cancel`, rider, {
    version: 0,
    idempotencyKey: 'last-mile-cancel-1',
  });
  assert.equal(byRider.status, 403);

  const cancelled = await post(`/api/v1/deliveries/${cancellableId}/cancel`, manager, {
    version: 0,
    idempotencyKey: 'last-mile-cancel-1',
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));

  const stored = await Delivery.findById(cancellableId).lean();
  assert.equal(stored!.status, DeliveryStatus.CANCELLED);

  const replay = await post(`/api/v1/deliveries/${cancellableId}/cancel`, manager, {
    version: 0,
    idempotencyKey: 'last-mile-cancel-1',
  });
  assert.equal(replay.status, 200, 'a retried cancellation is answered, not doubled');
});

// ─── Returns ─────────────────────────────────────────────────────────────────

async function requestReturn(key: string, quantity: number) {
  const created = await post('/api/v1/returns', owner, {
    invoiceId: String(invoiceId),
    primaryReason: 'DAMAGED_IN_TRANSIT',
    lines: [
      {
        medicineId: String(medicineId),
        batchId: String(batchId),
        quantity,
        reason: 'DAMAGED_IN_TRANSIT',
      },
    ],
    idempotencyKey: key,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return String((created.body.data as unknown as { _id: string })._id);
}

test('a return is readable by the customer who raised it and by nobody else’s', async () => {
  const returnId = await requestReturn('last-mile-return-read-1', 2);

  const mine = await get(`/api/v1/returns/${returnId}`, owner);
  assert.equal(mine.status, 200);
  assert.match((mine.body.data as unknown as { reference: string }).reference, /^RET-/);

  const theirs = await get(`/api/v1/returns/${returnId}`, otherOwner);
  assert.equal(theirs.status, 403);
});

test('a return is claimed for review before it is decided', async () => {
  const returnId = await requestReturn('last-mile-return-review-1', 3);

  const byCustomer = await post(`/api/v1/returns/${returnId}/review`, owner, {
    version: await returnVersion(returnId),
    idempotencyKey: 'last-mile-review-refused-1',
  });
  assert.equal(byCustomer.status, 403, 'the person who asked does not also decide');

  const claimed = await post(`/api/v1/returns/${returnId}/review`, manager, {
    version: await returnVersion(returnId),
    idempotencyKey: 'last-mile-review-1',
  });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));

  const stored = await Return.findById(returnId).lean();
  assert.equal(stored!.status, ReturnStatus.UNDER_REVIEW);

  /*
   * The version check, which is the same rule as on an order review and matters
   * more here: two managers deciding the same return would credit the customer
   * twice for one box of goods.
   */
  const stale = await post(`/api/v1/returns/${returnId}/review`, manager, {
    version: 0,
    idempotencyKey: 'last-mile-review-stale-1',
  });
  assert.notEqual(stale.status, 200);
});

test('a refused return says why, and restocks nothing', async () => {
  const returnId = await requestReturn('last-mile-return-reject-1', 4);
  await post(`/api/v1/returns/${returnId}/review`, manager, {
    version: await returnVersion(returnId),
    idempotencyKey: 'last-mile-review-2',
  });

  const before = await MedicineBatch.findById(batchId).lean();

  const rejected = await post(`/api/v1/returns/${returnId}/reject`, manager, {
    version: await returnVersion(returnId),
    rejectionReason: 'Goods were signed for undamaged and reported nine days later',
    idempotencyKey: 'last-mile-reject-1',
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));

  const stored = await Return.findById(returnId).lean();
  assert.equal(stored!.status, ReturnStatus.REJECTED);
  assert.match(String(stored!.rejectionReason ?? ''), /nine days later/);

  const after = await MedicineBatch.findById(batchId).lean();
  assert.deepEqual(
    after!.quantities,
    before!.quantities,
    'a refused return must not move stock — the goods never came back',
  );
});

test('approved goods are collected by a rider, then credited', async () => {
  const returnId = await requestReturn('last-mile-return-credit-1', 5);
  await post(`/api/v1/returns/${returnId}/review`, manager, {
    version: await returnVersion(returnId),
    idempotencyKey: 'last-mile-review-3',
  });
  const decided = await post(`/api/v1/returns/${returnId}/decision`, manager, {
    version: await returnVersion(returnId),
    lines: [{ medicineId: String(medicineId), batchId: String(batchId), approvedQuantity: 5 }],
    idempotencyKey: 'last-mile-decision-1',
  });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));

  const byStorekeeper = await post(`/api/v1/returns/${returnId}/collect`, storekeeper, {
    version: await returnVersion(returnId),
    idempotencyKey: 'last-mile-collect-refused-1',
  });
  assert.equal(
    byStorekeeper.status,
    403,
    'collecting happens at the customer’s counter, which is where the rider is',
  );

  const collected = await post(`/api/v1/returns/${returnId}/collect`, rider, {
    version: await returnVersion(returnId),
    idempotencyKey: 'last-mile-collect-1',
    notes: 'Collected two boxes, sealed',
  });
  assert.equal(collected.status, 200, JSON.stringify(collected.body));

  await post(`/api/v1/returns/${returnId}/receive`, storekeeper, {
    version: await returnVersion(returnId),
    lines: [
      {
        medicineId: String(medicineId),
        batchId: String(batchId),
        restockQuantity: 0,
        damagedQuantity: 5,
        expiredQuantity: 0,
        quarantinedQuantity: 0,
      },
    ],
    idempotencyKey: 'last-mile-receive-1',
  });

  const issued = await post(`/api/v1/returns/${returnId}/credit-note`, manager, {
    version: await returnVersion(returnId),
    idempotencyKey: 'last-mile-credit-1',
  });
  assert.equal(issued.status, 201, JSON.stringify(issued.body));

  const note = await CreditNote.findOne({ returnId }).lean();
  assert.ok(note, 'a settled return produces a document the customer can be shown');

  const read = await get(`/api/v1/returns/credit-notes/${note!._id}`, owner);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(
    (read.body.data as unknown as { reference: string }).reference,
    note!.reference,
    'and it is the customer’s own credit note, readable by them',
  );

  const stranger = await get(`/api/v1/returns/credit-notes/${note!._id}`, otherOwner);
  assert.equal(stranger.status, 403);
});

// ─── The reports that summarise all of it ────────────────────────────────────

test('a report a customer may read is narrowed to them; one they may not is refused', async () => {
  /*
   * Three of these four admit a `SHOP_OWNER` and one does not, and the
   * difference is the point rather than an inconsistency. Orders, returns and
   * the sales breakdown are the customer's own trading history, scoped
   * server-side. The delivery report is performance **by rider** — an internal
   * measure of staff, which is nobody's customer's business.
   *
   * So the assertion is not "a customer is refused". It is that where they are
   * admitted, what comes back is theirs — which is the thing that would be
   * wrong silently, because an unscoped report still returns 200 and still
   * contains their own rows.
   */
  for (const path of [
    '/api/v1/reports/orders',
    '/api/v1/reports/returns',
    '/api/v1/reports/sales/breakdown?dimension=MEDICINE',
  ]) {
    const internal = await get(path, manager);
    assert.equal(internal.status, 200, `${path}: ${JSON.stringify(internal.body)}`);
    assert.ok(internal.body.data, `${path} returned an envelope with nothing in it`);

    const trading = await get(path, owner);
    assert.equal(trading.status, 200, `${path} is the customer's own trading history`);

    /*
     * The scoping, proved by the one case where it cannot be mistaken for
     * anything else: an account with the shop-owner role and no shop. If the
     * report were unscoped it would happily hand them the organisation's
     * figures; instead the request has no subject and is refused.
     */
    const stranger = await get(path, otherOwner);
    assert.equal(
      stranger.status,
      404,
      `${path} answered a customer who owns no shop, which means it was not scoped to one`,
    );
  }

  const deliveries = await get('/api/v1/reports/deliveries', manager);
  assert.equal(deliveries.status, 200, JSON.stringify(deliveries.body));

  const refused = await get('/api/v1/reports/deliveries', owner);
  assert.equal(
    refused.status,
    403,
    'delivery performance is measured by rider, and how fast a named employee works is ' +
      'not something a customer is shown',
  );
});

test('the fixtures mean what the assertions above assume', async () => {
  /*
   * Six assertions above are refusals, and a refusal is indistinguishable from
   * a record that was never created. This pins the other half: both riders
   * exist, the second owns no shop, and one delivery is genuinely assigned to
   * the first — which is what makes `otherRider`'s empty board a scoping result
   * rather than an empty database.
   */
  assert.equal(await Delivery.countDocuments({ assignedTo: rider._id }), 1);
  assert.equal(await Delivery.countDocuments({ assignedTo: otherRider._id }), 0);
  assert.equal(await Shop.countDocuments({ ownerIds: otherOwner._id }), 0);
  assert.ok((await Return.countDocuments({ shopId })) >= 4);

  const readable = await get(`/api/v1/deliveries/${deliveryId}`, manager);
  assert.equal(readable.status, 200, 'the delivery the stranger could not open is genuinely there');
});
