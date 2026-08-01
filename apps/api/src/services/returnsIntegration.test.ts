import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  LedgerTransactionType,
  OrderStatus,
  ReturnStatus,
  StockMovementType,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { AuditLog } from '../models/AuditLog';
import { CreditNote } from '../models/CreditNote';
import { Invoice } from '../models/Invoice';
import { LedgerTransaction } from '../models/LedgerTransaction';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { Order } from '../models/Order';
import { Return } from '../models/Return';
import { Shop } from '../models/Shop';
import { StockMovement } from '../models/StockMovement';
import { User } from '../models/User';
import { getLedgerBalance } from './ledgerService';
import { invalidateSettingsCache } from './settingsService';

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

function authorization(userId: Types.ObjectId) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`,
  };
}

async function createUser(overrides: Record<string, unknown>) {
  return User.create({
    passwordHash: await bcrypt.hash('OriginalPassword1', 10),
    firstName: 'Test',
    lastName: 'User',
    status: UserStatus.ACTIVE,
    ...overrides,
  });
}

interface Fixture {
  owner: Awaited<ReturnType<typeof createUser>>;
  shop: InstanceType<typeof Shop>;
  invoice: InstanceType<typeof Invoice>;
  order: InstanceType<typeof Order>;
  batch: InstanceType<typeof MedicineBatch>;
  medicine: InstanceType<typeof Medicine>;
}

let fixtureCount = 0;

/**
 * Builds a delivered order with one issued invoice line of 10 units at 12.50
 * each, no discounts and no tax, so every credit figure in the assertions is
 * exact rather than rounded.
 */
async function deliveredInvoice(
  options: { quantity?: number; expired?: boolean } = {},
): Promise<Fixture> {
  fixtureCount += 1;
  const suffix = `${fixtureCount}`;
  const quantity = options.quantity ?? 10;
  const owner = await createUser({
    email: `owner-${suffix}@returns.local`,
    role: UserRole.SHOP_OWNER,
  });
  const shop = await Shop.create({
    reference: `SHP-RET-${suffix}`,
    name: `Return Test Pharmacy ${suffix}`,
    ownerIds: [owner._id],
    // Unique per fixture; the shop phone carries a unique index.
    primaryPhone: `017${String(fixtureCount).padStart(8, '0')}`,
    creditLimit: 10_000_000,
    paymentTermsDays: 30,
    status: 'ACTIVE',
  });
  const medicine = await Medicine.create({
    reference: `MED-RET-${suffix}`,
    sku: `SKU-RET-${suffix}`,
    brandName: 'Napa',
    genericName: 'Paracetamol',
    manufacturer: 'Beximco',
    strength: '500mg',
    dosageForm: 'Tablet',
    packSize: '10x10',
    unit: 'Strip',
    category: 'Analgesic',
    costPriceMinor: 800,
    defaultSellingPriceMinor: 1250,
    classification: 'OTC',
    createdBy: owner._id,
  });
  const expiryDate = options.expired
    ? new Date(Date.now() - 86_400_000)
    : new Date(Date.now() + 365 * 86_400_000);
  const batch = await MedicineBatch.create({
    medicineId: medicine._id,
    batchNumber: `BATCH-${suffix}`,
    manufacturingDate: new Date(Date.now() - 30 * 86_400_000),
    expiryDate,
    costPriceMinor: 800,
    receivedQuantity: 100,
    quantities: {
      onHand: 100,
      available: 100,
      reserved: 0,
      picking: 0,
      packed: 0,
      damaged: 0,
      expired: 0,
      returned: 0,
      quarantined: 0,
    },
    warehouseLocation: 'A1',
    createdBy: owner._id,
  });
  const snapshot = {
    reference: medicine.reference,
    sku: medicine.sku,
    brandName: medicine.brandName,
    genericName: medicine.genericName,
    manufacturer: medicine.manufacturer,
    strength: medicine.strength,
    dosageForm: medicine.dosageForm,
    packSize: medicine.packSize,
    unit: medicine.unit,
  };
  const order = await Order.create({
    reference: `ORD-RET-${suffix}`,
    shopId: shop._id,
    submittedBy: owner._id,
    items: [
      {
        medicineId: medicine._id,
        medicineSnapshot: snapshot,
        requestedQuantity: quantity,
        estimatedUnitPriceMinor: 1250,
        estimatedDiscountMinor: 0,
        estimatedLineTotalMinor: 1250 * quantity,
        availableStockSnapshot: 100,
      },
    ],
    status: OrderStatus.DELIVERED,
    statusHistory: [
      { to: OrderStatus.SUBMITTED, actorId: owner._id, at: new Date() },
      { to: OrderStatus.DELIVERED, actorId: owner._id, at: new Date() },
    ],
    submittedAt: new Date(),
  });
  const invoice = await Invoice.create({
    reference: `INV-RET-${suffix}`,
    orderId: order._id,
    shopId: shop._id,
    supplierSnapshot: { name: 'MedSupply B2B' },
    shopSnapshot: { reference: shop.reference, name: shop.name },
    orderSnapshot: { reference: order.reference },
    deliveryAddressSnapshot: { line1: 'Street', city: 'Dhaka', district: 'Dhaka' },
    items: [
      {
        medicineId: medicine._id,
        medicineSnapshot: snapshot,
        batchId: batch._id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        quantity,
        unitPriceMinor: 1250,
        discountMinor: 0,
        lineTotalMinor: 1250 * quantity,
      },
    ],
    subtotalMinor: 1250 * quantity,
    orderDiscountMinor: 0,
    deliveryChargeMinor: 0,
    taxMinor: 0,
    previousBalanceMinor: 0,
    grandTotalMinor: 1250 * quantity,
    amountDueMinor: 1250 * quantity,
    totalOutstandingMinor: 1250 * quantity,
    paymentTermsDays: 30,
    invoiceDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86_400_000),
    issuedBy: owner._id,
    issuedAt: new Date(),
  });
  return { owner, shop, invoice, order, batch, medicine };
}

async function post(path: string, actorId: Types.ObjectId, body: unknown) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method: 'POST',
    headers: authorization(actorId),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

async function get(path: string, actorId: Types.ObjectId) {
  const response = await fetch(`${base}/api/v1${path}`, { headers: authorization(actorId) });
  const isCsv = response.headers.get('content-type')?.includes('text/csv') ?? false;
  // Read CSV as raw bytes: `Response.text()` strips a UTF-8 byte order mark, so
  // decoding first would hide whether the export actually carries one.
  const bytes = isCsv ? new Uint8Array(await response.arrayBuffer()) : new Uint8Array();
  return {
    status: response.status,
    bytes,
    text: isCsv ? Buffer.from(bytes).toString('latin1') : '',
    disposition: response.headers.get('content-disposition') ?? '',
    body: isCsv ? (undefined as unknown) : ((await response.json()) as unknown),
  };
}

/** Drives a return from request through to an issued credit note. */
async function requestReturn(fixture: Fixture, quantity: number, actorId = fixture.owner._id) {
  return post('/returns', actorId, {
    invoiceId: String(fixture.invoice._id),
    primaryReason: 'DAMAGED_IN_TRANSIT',
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        quantity,
        reason: 'DAMAGED_IN_TRANSIT',
      },
    ],
    idempotencyKey: `return-${fixture.invoice.reference}-${quantity}-${Date.now()}`,
  });
}

let manager: Awaited<ReturnType<typeof createUser>>;
let storekeeper: Awaited<ReturnType<typeof createUser>>;

before(async () => {
  const uri = process.env.MONGODB_TEST_URI
    ? process.env.MONGODB_TEST_URI
    : await (async () => {
        memoryReplica = await MongoMemoryReplSet.create({
          replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
        });
        return memoryReplica.getUri('medsupply_returns');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([
    AuditLog.init(),
    CreditNote.init(),
    Invoice.init(),
    LedgerTransaction.init(),
    Medicine.init(),
    MedicineBatch.init(),
    Order.init(),
    Return.init(),
    Shop.init(),
    StockMovement.init(),
    User.init(),
  ]);
  invalidateSettingsCache();

  manager = await createUser({ email: 'manager@returns.local', role: UserRole.MANAGER });
  storekeeper = await createUser({ email: 'store@returns.local', role: UserRole.STOREKEEPER });

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

test('a full return restocks the batch, credits the ledger and closes the order', async () => {
  const fixture = await deliveredInvoice();
  const created = await requestReturn(fixture, 10);
  assert.equal(created.status, 201);
  const returnId = String((created.body as { data: { _id: string } }).data._id);

  const afterRequest = await Order.findById(fixture.order._id);
  assert.equal(afterRequest?.status, OrderStatus.RETURN_REQUESTED);

  const loaded = await Return.findById(returnId);
  const decision = await post(`/returns/${returnId}/decision`, manager._id, {
    version: loaded!.version,
    idempotencyKey: `decide-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        approvedQuantity: 10,
      },
    ],
  });
  assert.equal(decision.status, 200, JSON.stringify(decision.body));
  const approved = await Return.findById(returnId);
  assert.equal(approved?.status, ReturnStatus.APPROVED);
  assert.equal(approved?.approvedTotalMinor, 12_500);

  const receipt = await post(`/returns/${returnId}/receive`, storekeeper._id, {
    version: approved!.version,
    idempotencyKey: `receive-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        restockQuantity: 10,
        damagedQuantity: 0,
        expiredQuantity: 0,
        quarantinedQuantity: 0,
      },
    ],
  });
  assert.equal(receipt.status, 200, JSON.stringify(receipt.body));

  const restocked = await MedicineBatch.findById(fixture.batch._id);
  assert.equal(restocked?.quantities.onHand, 110);
  assert.equal(restocked?.quantities.available, 110);
  // The holding bucket is emptied by the disposition, not left occupied.
  assert.equal(restocked?.quantities.returned, 0);

  const received = await Return.findById(returnId);
  const credit = await post(`/returns/${returnId}/credit-note`, manager._id, {
    version: received!.version,
    idempotencyKey: `credit-${returnId}`,
  });
  assert.equal(credit.status, 201, JSON.stringify(credit.body));

  const note = await CreditNote.findOne({ returnId });
  assert.ok(note);
  assert.equal(note!.totalMinor, 12_500);
  assert.ok(note!.reference.startsWith('CRN-'));

  const ledger = await LedgerTransaction.findOne({
    type: LedgerTransactionType.RETURN_CREDIT,
    shopId: fixture.shop._id,
  });
  assert.ok(ledger);
  assert.equal(ledger!.customerBalanceDeltaMinor, -12_500);
  assert.equal(await getLedgerBalance(fixture.shop._id), -12_500);

  const closedOrder = await Order.findById(fixture.order._id);
  assert.equal(closedOrder?.status, OrderStatus.RETURNED);
  const completed = await Return.findById(returnId);
  assert.equal(completed?.status, ReturnStatus.COMPLETED);
});

test('a partial return credits only what was received and reopens the order', async () => {
  const fixture = await deliveredInvoice();
  const created = await requestReturn(fixture, 6);
  const returnId = String((created.body as { data: { _id: string } }).data._id);

  let record = await Return.findById(returnId);
  await post(`/returns/${returnId}/decision`, manager._id, {
    version: record!.version,
    idempotencyKey: `decide-partial-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        approvedQuantity: 4,
      },
    ],
  });
  record = await Return.findById(returnId);
  assert.equal(record?.status, ReturnStatus.PARTIALLY_APPROVED);

  // Two of the four returned units are unsaleable.
  await post(`/returns/${returnId}/receive`, storekeeper._id, {
    version: record!.version,
    idempotencyKey: `receive-partial-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        restockQuantity: 2,
        damagedQuantity: 2,
        expiredQuantity: 0,
        quarantinedQuantity: 0,
      },
    ],
  });

  const batch = await MedicineBatch.findById(fixture.batch._id);
  assert.equal(batch?.quantities.available, 102);
  assert.equal(batch?.quantities.damaged, 2);
  // Damaged units are physically present but leave onHand, as write-offs do.
  assert.equal(batch?.quantities.onHand, 102);

  record = await Return.findById(returnId);
  assert.equal(record?.approvedTotalMinor, 5000);

  await post(`/returns/${returnId}/credit-note`, manager._id, {
    version: record!.version,
    idempotencyKey: `credit-partial-${returnId}`,
  });
  const order = await Order.findById(fixture.order._id);
  // Only part of the invoice came back, so the order stays delivered.
  assert.equal(order?.status, OrderStatus.DELIVERED);
  assert.equal(await getLedgerBalance(fixture.shop._id), -5000);
});

test('an expired batch cannot be restocked but can still be written off', async () => {
  const fixture = await deliveredInvoice({ expired: true });
  const created = await requestReturn(fixture, 5);
  const returnId = String((created.body as { data: { _id: string } }).data._id);
  let record = await Return.findById(returnId);
  await post(`/returns/${returnId}/decision`, manager._id, {
    version: record!.version,
    idempotencyKey: `decide-expired-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        approvedQuantity: 5,
      },
    ],
  });
  record = await Return.findById(returnId);

  const rejected = await post(`/returns/${returnId}/receive`, storekeeper._id, {
    version: record!.version,
    idempotencyKey: `receive-expired-bad-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        restockQuantity: 5,
        damagedQuantity: 0,
        expiredQuantity: 0,
        quarantinedQuantity: 0,
      },
    ],
  });
  assert.equal(rejected.status, 409);
  assert.equal((rejected.body as { error: { code: string } }).error.code, 'EXPIRED_BATCH_RESTOCK');

  const accepted = await post(`/returns/${returnId}/receive`, storekeeper._id, {
    version: record!.version,
    idempotencyKey: `receive-expired-good-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        restockQuantity: 0,
        damagedQuantity: 0,
        expiredQuantity: 5,
        quarantinedQuantity: 0,
      },
    ],
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const batch = await MedicineBatch.findById(fixture.batch._id);
  assert.equal(batch?.quantities.expired, 5);
  assert.equal(batch?.quantities.available, 100);
});

test('a second return cannot claim more units than the invoice has left', async () => {
  const fixture = await deliveredInvoice();
  const first = await requestReturn(fixture, 7);
  assert.equal(first.status, 201);
  const second = await requestReturn(fixture, 4);
  assert.equal(second.status, 409);
  assert.equal((second.body as { error: { code: string } }).error.code, 'RETURN_EXCEEDS_INVOICE');
  // Three units remain, and a request for exactly three succeeds.
  const third = await requestReturn(fixture, 3);
  assert.equal(third.status, 201, JSON.stringify(third.body));
});

test('a cancelled return releases its claim on the invoice', async () => {
  const fixture = await deliveredInvoice();
  const created = await requestReturn(fixture, 10);
  const returnId = String((created.body as { data: { _id: string } }).data._id);
  const record = await Return.findById(returnId);

  const blocked = await requestReturn(fixture, 1);
  assert.equal(blocked.status, 409);

  const cancelled = await post(`/returns/${returnId}/cancel`, fixture.owner._id, {
    version: record!.version,
    idempotencyKey: `cancel-${returnId}`,
    reason: 'Sending the goods back was no longer necessary',
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));

  const order = await Order.findById(fixture.order._id);
  assert.equal(order?.status, OrderStatus.DELIVERED);
  const retry = await requestReturn(fixture, 10);
  assert.equal(retry.status, 201, JSON.stringify(retry.body));
});

test('a shop owner cannot see or act on another shop return', async () => {
  const mine = await deliveredInvoice();
  const theirs = await deliveredInvoice();
  const created = await requestReturn(theirs, 2);
  const returnId = String((created.body as { data: { _id: string } }).data._id);

  const read = await get(`/returns/${returnId}`, mine.owner._id);
  assert.equal(read.status, 403);

  const record = await Return.findById(returnId);
  const cancelled = await post(`/returns/${returnId}/cancel`, mine.owner._id, {
    version: record!.version,
    idempotencyKey: `cross-shop-${returnId}`,
    reason: 'Attempting to cancel another shop return',
  });
  assert.equal(cancelled.status, 403);

  const list = await get('/returns', mine.owner._id);
  assert.equal(list.status, 200);
  const references = (list.body as { data: Array<{ reference: string }> }).data.map(
    (row) => row.reference,
  );
  assert.ok(!references.includes(record!.reference));
});

test('a storekeeper cannot approve a return and a shop owner cannot receive one', async () => {
  const fixture = await deliveredInvoice();
  const created = await requestReturn(fixture, 2);
  const returnId = String((created.body as { data: { _id: string } }).data._id);
  const record = await Return.findById(returnId);

  const approval = await post(`/returns/${returnId}/decision`, storekeeper._id, {
    version: record!.version,
    idempotencyKey: `store-approve-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        approvedQuantity: 2,
      },
    ],
  });
  assert.equal(approval.status, 403);

  const receipt = await post(`/returns/${returnId}/receive`, fixture.owner._id, {
    version: record!.version,
    idempotencyKey: `owner-receive-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        restockQuantity: 2,
        damagedQuantity: 0,
        expiredQuantity: 0,
        quarantinedQuantity: 0,
      },
    ],
  });
  assert.equal(receipt.status, 403);
});

test('replaying a receipt does not double the restocked stock', async () => {
  const fixture = await deliveredInvoice();
  const created = await requestReturn(fixture, 3);
  const returnId = String((created.body as { data: { _id: string } }).data._id);
  let record = await Return.findById(returnId);
  await post(`/returns/${returnId}/decision`, manager._id, {
    version: record!.version,
    idempotencyKey: `decide-replay-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        approvedQuantity: 3,
      },
    ],
  });
  record = await Return.findById(returnId);
  const payload = {
    version: record!.version,
    idempotencyKey: `receive-replay-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        restockQuantity: 3,
        damagedQuantity: 0,
        expiredQuantity: 0,
        quarantinedQuantity: 0,
      },
    ],
  };
  const first = await post(`/returns/${returnId}/receive`, storekeeper._id, payload);
  const replay = await post(`/returns/${returnId}/receive`, storekeeper._id, payload);
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(
    (replay.body as { meta: { idempotentReplay: boolean } }).meta.idempotentReplay,
    true,
  );

  const batch = await MedicineBatch.findById(fixture.batch._id);
  assert.equal(batch?.quantities.available, 103);
  const movements = await StockMovement.countDocuments({
    batchId: fixture.batch._id,
    type: StockMovementType.RETURN_RECEIPT,
  });
  assert.equal(movements, 1);
});

test('replaying a credit note issue returns the original and credits once', async () => {
  const fixture = await deliveredInvoice();
  const created = await requestReturn(fixture, 2);
  const returnId = String((created.body as { data: { _id: string } }).data._id);
  let record = await Return.findById(returnId);
  await post(`/returns/${returnId}/decision`, manager._id, {
    version: record!.version,
    idempotencyKey: `decide-credit-replay-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        approvedQuantity: 2,
      },
    ],
  });
  record = await Return.findById(returnId);
  await post(`/returns/${returnId}/receive`, storekeeper._id, {
    version: record!.version,
    idempotencyKey: `receive-credit-replay-${returnId}`,
    lines: [
      {
        medicineId: String(fixture.medicine._id),
        batchId: String(fixture.batch._id),
        restockQuantity: 2,
        damagedQuantity: 0,
        expiredQuantity: 0,
        quarantinedQuantity: 0,
      },
    ],
  });
  record = await Return.findById(returnId);
  const body = { version: record!.version, idempotencyKey: `credit-replay-${returnId}` };
  const first = await post(`/returns/${returnId}/credit-note`, manager._id, body);
  const replay = await post(`/returns/${returnId}/credit-note`, manager._id, body);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);

  assert.equal(await CreditNote.countDocuments({ returnId }), 1);
  assert.equal(
    await LedgerTransaction.countDocuments({
      shopId: fixture.shop._id,
      type: LedgerTransactionType.RETURN_CREDIT,
    }),
    1,
  );
  assert.equal(await getLedgerBalance(fixture.shop._id), -2500);
});

test('a stale version is refused so two reviewers cannot both decide', async () => {
  const fixture = await deliveredInvoice();
  const created = await requestReturn(fixture, 2);
  const returnId = String((created.body as { data: { _id: string } }).data._id);
  const record = await Return.findById(returnId);

  const lines = [
    {
      medicineId: String(fixture.medicine._id),
      batchId: String(fixture.batch._id),
      approvedQuantity: 2,
    },
  ];
  const first = await post(`/returns/${returnId}/decision`, manager._id, {
    version: record!.version,
    idempotencyKey: `stale-first-${returnId}`,
    lines,
  });
  assert.equal(first.status, 200);
  const stale = await post(`/returns/${returnId}/decision`, manager._id, {
    version: record!.version,
    idempotencyKey: `stale-second-${returnId}`,
    lines,
  });
  assert.equal(stale.status, 409);
  assert.equal((stale.body as { error: { code: string } }).error.code, 'STALE_RETURN');
});

test('the return lifecycle is written to the append-only audit log', async () => {
  const fixture = await deliveredInvoice();
  const created = await requestReturn(fixture, 1);
  const returnId = String((created.body as { data: { _id: string } }).data._id);
  const actions = await AuditLog.find({ entityType: 'Return', entityId: returnId }).distinct(
    'action',
  );
  assert.ok(actions.includes('RETURN_REQUESTED'));
});

test('reports summarise sales, returns and receivables for management', async () => {
  const fixture = await deliveredInvoice();
  const today = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
  const range = `from=${today}&to=${today}&granularity=DAY`;

  const sales = await get(`/reports/sales?${range}`, manager._id);
  assert.equal(sales.status, 200);
  const totals = (sales.body as { data: { totals: { netMinor: number; invoiceCount: number } } })
    .data.totals;
  assert.ok(totals.invoiceCount >= 1);
  assert.ok(totals.netMinor >= fixture.invoice.grandTotalMinor);

  const overview = await get(`/reports/overview?${range}`, manager._id);
  assert.equal(overview.status, 200);
  assert.ok(
    (overview.body as { data: { receivables: { outstandingMinor: number } } }).data.receivables
      .outstandingMinor > 0,
  );

  const ageing = await get('/reports/receivables-ageing', manager._id);
  assert.equal(ageing.status, 200);
  assert.equal(
    (ageing.body as { data: { buckets: Array<{ bucket: string }> } }).data.buckets.length,
    5,
  );

  const inventory = await get('/reports/inventory', storekeeper._id);
  assert.equal(inventory.status, 200);
  assert.ok(
    (inventory.body as { data: { totals: { costValueMinor: number } } }).data.totals
      .costValueMinor > 0,
  );
});

test('a CSV export is quoted, prefixed against formula injection and role gated', async () => {
  const today = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
  const csv = await get(
    `/reports/sales?from=${today}&to=${today}&granularity=DAY&format=csv`,
    manager._id,
  );
  assert.equal(csv.status, 200);
  assert.deepEqual(
    Array.from(csv.bytes.slice(0, 3)),
    [0xef, 0xbb, 0xbf],
    'CSV should start with a UTF-8 byte order mark so Excel reads it correctly',
  );
  assert.ok(csv.text.includes('Period,Invoices,Gross'));
  assert.ok(csv.disposition.includes('attachment; filename="sales-summary'));
  // Every data row is a plain number, so nothing can be read as a formula.
  assert.ok(!/(^|,)[=+@]/m.test(csv.text));

  const shopOwner = await createUser({
    email: 'csv-owner@returns.local',
    role: UserRole.SHOP_OWNER,
  });
  const denied = await get('/reports/receivables-ageing', shopOwner._id);
  assert.equal(denied.status, 403);
});

test('a shop owner sales report is narrowed to their own shop', async () => {
  const mine = await deliveredInvoice();
  await deliveredInvoice();
  const today = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
  const response = await get(
    `/reports/sales?from=${today}&to=${today}&granularity=DAY`,
    mine.owner._id,
  );
  assert.equal(response.status, 200);
  const totals = (response.body as { data: { totals: { netMinor: number; shopCount: number } } })
    .data.totals;
  assert.equal(totals.shopCount, 1);
  assert.equal(totals.netMinor, mine.invoice.grandTotalMinor);
});
