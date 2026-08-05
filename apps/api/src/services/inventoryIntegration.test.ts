import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  MedicineClassification,
  StockMovementType,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { StockMovement } from '../models/StockMovement';
import { User } from '../models/User';

/**
 * The warehouse tranche: reading stock, and the four ways of changing it.
 *
 * Twelve endpoints in this area had never been called. They matter because
 * every one of them either states how much of something exists or rewrites that
 * number, and the number is what the credit check, the picking list and the
 * regulator's register all read.
 *
 * The endpoint-specific rule in each test is the one that would be wrong
 * quietly. Stock is not a single figure: a batch holds `onHand`, `available`,
 * `reserved`, `damaged` and four more, and almost every real defect in this
 * area is one of those moving without another moving to match. So the
 * assertions are on the **relationships between the buckets**, not on a total.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const storekeeper = { _id: new Types.ObjectId(), role: UserRole.STOREKEEPER };
const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };

const medicineId = new Types.ObjectId();
let batchId: Types.ObjectId;

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

/** The quantity buckets as the API reports them. */
async function quantities() {
  const batch = await MedicineBatch.findById(batchId).lean();
  return batch!.quantities as unknown as Record<string, number>;
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_inventory'));
  await mongoose.connection.dropDatabase();
  await Promise.all([Medicine.init(), MedicineBatch.init(), StockMovement.init(), User.init()]);

  await User.create(
    (
      [
        [manager, 'inv-manager', 'Branch', 'Manager'],
        [storekeeper, 'inv-storekeeper', 'Store', 'Keeper'],
        [owner, 'inv-owner', 'Shop', 'Owner'],
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
    reference: 'MED-INV-000001',
    sku: 'INV-NAPA-500',
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

// ─── Receiving ───────────────────────────────────────────────────────────────

test('receiving stock creates a batch whose every bucket adds up', async () => {
  const refused = await post('/api/v1/inventory/batches/receive', owner, {
    medicineId: String(medicineId),
    batchNumber: 'inv-b1',
    manufacturingDate: '2026-01-01',
    expiryDate: '2028-01-01',
    costPriceMinor: 800,
    quantity: 500,
    warehouseLocation: 'AISLE-A',
  });
  assert.equal(refused.status, 403, 'a customer does not receive goods into the warehouse');

  const received = await post('/api/v1/inventory/batches/receive', storekeeper, {
    medicineId: String(medicineId),
    batchNumber: 'inv-b1',
    manufacturingDate: '2026-01-01',
    expiryDate: '2028-01-01',
    costPriceMinor: 800,
    quantity: 500,
    warehouseLocation: 'AISLE-A',
  });
  assert.equal(received.status, 201, JSON.stringify(received.body));
  batchId = new Types.ObjectId((received.body.data as unknown as { _id: string })._id);

  const stock = await quantities();
  assert.equal(stock.onHand, 500);
  assert.equal(
    stock.available,
    500,
    'newly received stock is available; a receipt that lands as on-hand but not ' +
      'available is invisible to every allocation',
  );
  assert.equal(stock.reserved + stock.damaged + stock.expired + stock.quarantined, 0);

  /*
   * The batch number is uppercased by the schema. It matters because a
   * storekeeper scanning `inv-b1` and one typing `INV-B1` must reach the same
   * batch, and the recall trace searches by exactly this field.
   */
  const stored = await MedicineBatch.findById(batchId).lean();
  assert.equal(stored!.batchNumber, 'INV-B1');

  const expiryBeforeManufacture = await post('/api/v1/inventory/batches/receive', storekeeper, {
    medicineId: String(medicineId),
    batchNumber: 'inv-b2',
    manufacturingDate: '2028-01-01',
    expiryDate: '2026-01-01',
    costPriceMinor: 800,
    quantity: 10,
    warehouseLocation: 'AISLE-A',
  });
  assert.equal(expiryBeforeManufacture.status, 400, 'a batch cannot expire before it was made');
});

// ─── Reading ─────────────────────────────────────────────────────────────────

test('the warehouse can read the catalogue, its batches and its movements', async () => {
  const medicine = await get(`/api/v1/inventory/medicines/${medicineId}`, storekeeper);
  assert.equal(medicine.status, 200);
  assert.equal((medicine.body.data as unknown as { sku: string }).sku, 'INV-NAPA-500');

  const batches = await get(`/api/v1/inventory/batches?medicineId=${medicineId}`, storekeeper);
  assert.equal(batches.status, 200);
  assert.equal((batches.body.data as unknown as unknown[]).length, 1);

  const batch = await get(`/api/v1/inventory/batches/${batchId}`, storekeeper);
  assert.equal(batch.status, 200);
  assert.equal((batch.body.data as unknown as { batchNumber: string }).batchNumber, 'INV-B1');

  const movements = await get(`/api/v1/inventory/movements?medicineId=${medicineId}`, storekeeper);
  assert.equal(movements.status, 200);
  const kinds = (movements.body.data as unknown as { type: string }[]).map((row) => row.type);
  assert.ok(
    kinds.includes(StockMovementType.RECEIPT),
    'the receipt above left a movement record — stock history is the audit trail for ' +
      'every figure the buckets report',
  );

  for (const path of [
    `/api/v1/inventory/batches?medicineId=${medicineId}`,
    `/api/v1/inventory/batches/${batchId}`,
    `/api/v1/inventory/movements`,
  ]) {
    const customer = await get(path, owner);
    assert.equal(customer.status, 403, `${path} tells a customer how much stock exists`);
  }
});

test('the stock-movement report is the warehouse’s, not a customer’s', async () => {
  const report = await get('/api/v1/reports/stock-movements', storekeeper);
  assert.equal(report.status, 200);

  const customer = await get('/api/v1/reports/stock-movements', owner);
  assert.equal(customer.status, 403);
});

// ─── Changing stock ──────────────────────────────────────────────────────────

test('an operation moves quantity between buckets without inventing any', async () => {
  const before = await quantities();

  const damaged = await post(`/api/v1/inventory/batches/${batchId}/operations`, storekeeper, {
    type: StockMovementType.DAMAGE,
    quantity: 20,
    reason: 'Crushed carton on the pallet',
    idempotencyKey: 'inventory-damage-1',
  });
  assert.equal(damaged.status, 200, JSON.stringify(damaged.body));

  const after = await quantities();
  assert.equal(after.damaged, before.damaged + 20);
  assert.equal(
    after.available,
    before.available - 20,
    'damaged stock leaves the available pool, or it is picked and shipped to a customer',
  );
  assert.equal(
    after.onHand,
    before.onHand - 20,
    'and leaves `onHand` too: damage is permanent, so counting it as stock held would ' +
      'inflate the valuation report by the shrinkage figure',
  );

  /*
   * The contrast that makes the rule above a rule rather than a coincidence.
   * Quarantine is reversible — a batch held pending a certificate is still
   * stock this business owns — so it leaves `available` and **stays** in
   * `onHand`. Damage and quarantine both move out of `available`; only one of
   * them is a write-off, and a transition table that treated them alike would
   * pass every test that looked at `available` alone.
   */
  const held = await post(`/api/v1/inventory/batches/${batchId}/operations`, storekeeper, {
    type: StockMovementType.QUARANTINE,
    quantity: 10,
    reason: 'Awaiting a certificate of analysis',
    idempotencyKey: 'inventory-quarantine-1',
  });
  assert.equal(held.status, 200, JSON.stringify(held.body));

  const quarantined = await quantities();
  assert.equal(quarantined.quarantined, after.quarantined + 10);
  assert.equal(quarantined.available, after.available - 10);
  assert.equal(quarantined.onHand, after.onHand, 'quarantined stock is still stock');

  const released = await post(`/api/v1/inventory/batches/${batchId}/operations`, storekeeper, {
    type: StockMovementType.QUARANTINE_RELEASE,
    quantity: 10,
    reason: 'Certificate received',
    idempotencyKey: 'inventory-quarantine-release-1',
  });
  assert.equal(released.status, 200);
  assert.deepEqual(await quantities(), after, 'and releasing it puts the batch back where it was');

  /*
   * The key exists because a storekeeper on a warehouse handset retries. A
   * replayed damage report that damaged another twenty units would be a
   * shrinkage figure invented by a flaky connection.
   */
  const replay = await post(`/api/v1/inventory/batches/${batchId}/operations`, storekeeper, {
    type: StockMovementType.DAMAGE,
    quantity: 20,
    reason: 'Crushed carton on the pallet',
    idempotencyKey: 'inventory-damage-1',
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(await quantities(), after, 'a replay changed nothing');

  const tooMuch = await post(`/api/v1/inventory/batches/${batchId}/operations`, storekeeper, {
    type: StockMovementType.DAMAGE,
    quantity: 100_000,
    reason: 'Everything is broken',
    idempotencyKey: 'inventory-damage-2',
  });
  assert.notEqual(tooMuch.status, 200, 'a batch cannot go negative');
});

test('a reservation takes from available and shows in reserved', async () => {
  const before = await quantities();

  const refused = await post('/api/v1/inventory/allocations/reserve', storekeeper, {
    medicineId: String(medicineId),
    quantity: 30,
    idempotencyKey: 'inventory-reserve-1',
    referenceType: 'Order',
    referenceId: 'ORD-INV-1',
  });
  assert.equal(
    refused.status,
    403,
    'reserving stock commits it to a customer, which is a commercial decision rather ' +
      'than a warehouse one',
  );

  const reserved = await post('/api/v1/inventory/allocations/reserve', manager, {
    medicineId: String(medicineId),
    quantity: 30,
    idempotencyKey: 'inventory-reserve-1',
    referenceType: 'Order',
    referenceId: 'ORD-INV-1',
  });
  assert.equal(reserved.status, 200, JSON.stringify(reserved.body));

  const after = await quantities();
  assert.equal(after.reserved, before.reserved + 30);
  assert.equal(
    after.available,
    before.available - 30,
    'stock promised to one order must stop being offered to the next',
  );
  assert.equal(after.onHand, before.onHand, 'nothing has left the building yet');
});

test('blocking a batch takes it out of allocation and says why', async () => {
  const refused = await patch(`/api/v1/inventory/batches/${batchId}/block`, storekeeper, {
    blocked: true,
    reason: 'Suspected counterfeit — awaiting DGDA',
  });
  assert.equal(refused.status, 403);

  const noReason = await patch(`/api/v1/inventory/batches/${batchId}/block`, manager, {
    blocked: true,
  });
  assert.equal(
    noReason.status,
    400,
    'a blocked batch without a reason is a batch nobody can decide to unblock',
  );

  const blocked = await patch(`/api/v1/inventory/batches/${batchId}/block`, manager, {
    blocked: true,
    reason: 'Suspected counterfeit — awaiting DGDA',
  });
  assert.equal(blocked.status, 200, JSON.stringify(blocked.body));

  const stored = await MedicineBatch.findById(batchId).lean();
  assert.equal(stored!.isBlocked, true);

  /*
   * The rule that makes blocking worth having: a blocked batch must not be
   * allocated. Recording the flag and still reserving from it is the failure
   * mode that puts a suspect batch on a van.
   */
  const allocation = await post('/api/v1/inventory/allocations/reserve', manager, {
    medicineId: String(medicineId),
    quantity: 5,
    idempotencyKey: 'inventory-reserve-after-block',
    referenceType: 'Order',
    referenceId: 'ORD-INV-2',
  });
  assert.notEqual(
    allocation.status,
    200,
    'a blocked batch was still allocated, which is the whole thing blocking prevents',
  );

  const unblocked = await patch(`/api/v1/inventory/batches/${batchId}/block`, manager, {
    blocked: false,
    reason: 'Cleared by the manufacturer',
  });
  assert.equal(unblocked.status, 200);
});

test('an adjustment sets the count a person swears to, and leaves a movement saying so', async () => {
  const before = await quantities();

  const refused = await post(`/api/v1/inventory/batches/${batchId}/adjust`, storekeeper, {
    newOnHand: before.onHand - 5,
    reason: 'Five short at the annual count',
    idempotencyKey: 'inventory-adjust-1',
  });
  assert.equal(
    refused.status,
    403,
    'the person who counted does not also approve the correction — an adjustment is the ' +
      'one stock operation with no arithmetic behind it',
  );

  const adjusted = await post(`/api/v1/inventory/batches/${batchId}/adjust`, manager, {
    newOnHand: before.onHand - 5,
    reason: 'Five short at the annual count',
    idempotencyKey: 'inventory-adjust-1',
  });
  assert.equal(adjusted.status, 200, JSON.stringify(adjusted.body));

  const after = await quantities();
  assert.equal(after.onHand, before.onHand - 5);
  assert.equal(
    after.reserved,
    before.reserved,
    'an adjustment corrects what is on the shelf and must not quietly release stock ' +
      'already promised to an order',
  );

  const movements = await StockMovement.find({
    batchId,
    type: StockMovementType.ADJUSTMENT,
  }).lean();
  assert.equal(movements.length, 1);
  assert.match(String(movements[0]!.reason ?? ''), /annual count/);
});

test('the fixtures mean what the assertions above assume', async () => {
  /*
   * Every refusal above is indistinguishable from a missing fixture. This pins
   * the other half: the batch exists, it belongs to the medicine under test,
   * and the movement history is not empty — so a 403 was a refusal rather than
   * a 404 wearing a different number.
   */
  assert.equal(await MedicineBatch.countDocuments({ medicineId }), 1);
  assert.ok((await StockMovement.countDocuments({ batchId })) >= 3);

  const readable = await get(`/api/v1/inventory/batches/${batchId}`, manager);
  assert.equal(readable.status, 200, 'the batch the customer could not read is genuinely there');
});
