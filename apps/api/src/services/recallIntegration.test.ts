import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MedicineClassification, ShopStatus, UserRole, UserStatus } from '@medsupply/shared-types';
import { app } from '../app';
import { GoodsReceipt } from '../models/GoodsReceipt';
import { Invoice } from '../models/Invoice';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { Shop } from '../models/Shop';
import { StockMovement } from '../models/StockMovement';
import { Supplier } from '../models/Supplier';
import { User } from '../models/User';
import { traceBatch } from './recallService';

/**
 * **The regulatory acceptance test.**
 *
 * The plan names this journey as the one that decides whether phase 6 is done:
 * receive stock against a purchase order, sell it to two shops, then run a
 * recall on that batch and confirm the trace names both shops and the supplier.
 *
 * Every fact it needs already existed in this database — invoice lines have
 * carried `batchId` since the invoicing phase — and nothing had ever asked for
 * them, so the answer took a person exporting invoices and reading them. On the
 * day a manufacturer withdraws a batch, that is the difference between an
 * afternoon and a week.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const storekeeper = { _id: new Types.ObjectId(), role: UserRole.STOREKEEPER };

function authorization(userId: Types.ObjectId) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`,
  };
}

before(async () => {
  const uri = process.env.MONGODB_TEST_URI
    ? process.env.MONGODB_TEST_URI
    : await (async () => {
        memoryReplica = await MongoMemoryReplSet.create({
          replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
        });
        return memoryReplica.getUri('medsupply_recall');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([
    GoodsReceipt.init(),
    Invoice.init(),
    Medicine.init(),
    MedicineBatch.init(),
    PurchaseOrder.init(),
    Shop.init(),
    StockMovement.init(),
    Supplier.init(),
    User.init(),
  ]);

  await User.create([
    {
      _id: manager._id,
      email: 'recall-manager@test.local',
      passwordHash: 'x',
      firstName: 'Recall',
      lastName: 'Manager',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    },
    {
      _id: storekeeper._id,
      email: 'recall-store@test.local',
      passwordHash: 'x',
      firstName: 'Recall',
      lastName: 'Store',
      role: UserRole.STOREKEEPER,
      status: UserStatus.ACTIVE,
    },
  ]);

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

async function call(method: string, path: string, body?: unknown, as = manager._id) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: authorization(as),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as { data?: never; error?: never },
  };
}

test('the whole journey: purchase, receive, sell to two shops, then recall', async () => {
  // ── A supplier ────────────────────────────────────────────────────────────
  const supplierResponse = await call('POST', '/api/v1/purchasing/suppliers', {
    name: 'Beximco Pharmaceuticals',
    primaryPhone: '01711223344',
    drugLicenceNumber: 'DL-BD-99213',
    paymentTermsDays: 45,
  });
  assert.equal(supplierResponse.status, 201);
  const supplier = supplierResponse.body.data as unknown as { _id: string; reference: string };

  const medicine = await Medicine.create({
    reference: 'MED-RECALL-1',
    sku: 'NAP-RECALL',
    brandName: 'Napa',
    genericName: 'Paracetamol',
    manufacturer: 'Beximco',
    strength: '500mg',
    dosageForm: 'Tablet',
    packSize: '10',
    unit: 'box',
    category: 'General',
    barcode: '8801234567895',
    costPriceMinor: 800,
    defaultSellingPriceMinor: 1200,
    minimumOrderQuantity: 1,
    classification: MedicineClassification.OTC,
    createdBy: manager._id,
  });

  // ── A purchase order ──────────────────────────────────────────────────────
  const orderResponse = await call('POST', '/api/v1/purchasing/orders', {
    supplierId: supplier._id,
    supplierReference: 'BX-PO-2026-771',
    lines: [{ medicineId: String(medicine._id), orderedQuantity: 400, unitCostMinor: 800 }],
  });
  assert.equal(orderResponse.status, 201);
  const order = orderResponse.body.data as unknown as {
    _id: string;
    reference: string;
    lines: Array<{ _id: string }>;
  };
  assert.match(order.reference, /^PO-\d{4}-\d{6}$/, 'a human-readable reference, not an ObjectId');

  // ── Goods arrive, and 20 fewer than ordered ───────────────────────────────
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 2);
  const manufactured = new Date();
  manufactured.setFullYear(manufactured.getFullYear() - 1);

  const receiptResponse = await call(
    'POST',
    `/api/v1/purchasing/orders/${order._id}/receipts`,
    {
      supplierInvoiceReference: 'BX-INV-88431',
      lines: [
        {
          purchaseOrderLineId: order.lines[0]._id,
          batchNumber: 'BX-2026-A17',
          manufacturingDate: manufactured.toISOString(),
          expiryDate: expiry.toISOString(),
          receivedQuantity: 380,
          warehouseLocation: 'A1-3',
          supplierBatchReference: 'LOT-A17',
          varianceReason: 'Twenty boxes short; supplier notified',
        },
      ],
    },
    storekeeper._id,
  );
  assert.equal(receiptResponse.status, 201);
  const receipt = receiptResponse.body.data as unknown as {
    reference: string;
    lines: Array<{ batchId: string; varianceQuantity: number }>;
  };
  assert.match(receipt.reference, /^GRN-\d{4}-\d{6}$/);

  // The shortfall is recorded rather than silently accepted.
  assert.equal(receipt.lines[0].varianceQuantity, 20);

  const batchId = receipt.lines[0].batchId;
  const batch = await MedicineBatch.findById(batchId);
  assert.equal(batch?.quantities.available, 380, 'the stock that actually arrived');
  assert.equal(String(batch?.supplierId), supplier._id, 'the batch knows where it came from');
  assert.equal(String(batch?.purchaseOrderId), order._id);
  assert.ok(batch?.goodsReceiptId);

  // The purchase order is partly received, not finished.
  const stored = await PurchaseOrder.findById(order._id);
  assert.equal(stored?.status, 'PARTIALLY_RECEIVED');
  assert.equal(stored?.lines[0].receivedQuantity, 380);

  // ── Sold to two shops ─────────────────────────────────────────────────────
  const [shopA, shopB] = await Shop.create([
    {
      reference: 'SHP-RECALL-A',
      name: 'Dhanmondi Pharmacy',
      ownerIds: [new Types.ObjectId()],
      primaryPhone: '01722000001',
      status: ShopStatus.ACTIVE,
      deliveryAddresses: [],
    },
    {
      reference: 'SHP-RECALL-B',
      name: 'Gulshan Medico',
      ownerIds: [new Types.ObjectId()],
      primaryPhone: '01722000002',
      status: ShopStatus.ACTIVE,
      deliveryAddresses: [],
    },
  ]);

  const invoiceFor = (shop: InstanceType<typeof Shop>, reference: string, quantity: number) => {
    const total = quantity * 1200;
    return Invoice.create({
      reference,
      orderId: new Types.ObjectId(),
      shopId: shop._id,
      supplierSnapshot: { name: 'MedSupply B2B' },
      shopSnapshot: { reference: shop.reference, name: shop.name },
      orderSnapshot: { reference: 'ORD-RECALL' },
      deliveryAddressSnapshot: { line1: 'Street', city: 'Dhaka', district: 'Dhaka' },
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 86_400_000),
      items: [
        {
          medicineId: medicine._id,
          // The line that makes the forward trace possible, and which has been
          // populated on every invoice since the invoicing phase.
          batchId,
          batchNumber: 'BX-2026-A17',
          expiryDate: expiry,
          medicineSnapshot: { brandName: 'Napa', strength: '500mg' },
          quantity,
          unitPriceMinor: 1200,
          discountMinor: 0,
          lineDiscountMinor: 0,
          lineTotalMinor: total,
        },
      ],
      subtotalMinor: total,
      taxMinor: 0,
      deliveryChargeMinor: 0,
      orderDiscountMinor: 0,
      grandTotalMinor: total,
      amountDueMinor: total,
      previousBalanceMinor: 0,
      totalOutstandingMinor: total,
      paymentTermsDays: 30,
      status: 'ISSUED',
      issuedAt: new Date(),
      issuedBy: manager._id,
    });
  };

  await invoiceFor(shopA, 'INV-RECALL-A', 100);
  await invoiceFor(shopB, 'INV-RECALL-B', 60);

  await MedicineBatch.updateOne(
    { _id: batchId },
    { $inc: { 'quantities.available': -160, 'quantities.onHand': -160 } },
  );

  // ── The recall ────────────────────────────────────────────────────────────
  const traceResponse = await call(
    'GET',
    `/api/v1/purchasing/recall/batches/${batchId}`,
    undefined,
    storekeeper._id,
  );
  assert.equal(traceResponse.status, 200, 'the storekeeper holding the notice can look it up');
  const trace = traceResponse.body.data as unknown as Awaited<ReturnType<typeof traceBatch>>;

  // Forward: both shops, by name, with a telephone number to ring.
  assert.equal(trace.totals.shopsAffected, 2);
  const names = trace.recipients.map((entry) => entry.shopName).sort();
  assert.deepEqual(names, ['Dhanmondi Pharmacy', 'Gulshan Medico']);
  assert.deepEqual(trace.recipients.map((entry) => entry.primaryPhone).sort(), [
    '01722000001',
    '01722000002',
  ]);
  assert.equal(trace.totals.quantityDespatched, 160);
  assert.equal(trace.totals.quantityStillHeld, 220);

  // Backward: the supplier, the order, the receipt and the paper references.
  assert.equal(trace.origin.supplierName, 'Beximco Pharmaceuticals');
  assert.equal(trace.origin.drugLicenceNumber, 'DL-BD-99213');
  assert.equal(trace.origin.purchaseOrderReference, order.reference);
  assert.equal(trace.origin.goodsReceiptReference, receipt.reference);
  assert.equal(trace.origin.supplierInvoiceReference, 'BX-INV-88431');
  assert.equal(trace.origin.supplierBatchReference, 'LOT-A17');
  assert.equal(trace.origin.predatesPurchasing, false);

  // 380 received, 160 out, 220 held: nothing missing.
  assert.equal(trace.totals.quantityUnaccounted, 0);
});

test('a batch received before purchasing existed says so, rather than implying we lost the record', async () => {
  const medicine = await Medicine.findOne({ sku: 'NAP-RECALL' });
  const legacy = await MedicineBatch.create({
    medicineId: medicine!._id,
    batchNumber: 'LEGACY-001',
    manufacturingDate: new Date('2025-01-01'),
    expiryDate: new Date('2029-01-01'),
    costPriceMinor: 800,
    receivedQuantity: 50,
    quantities: {
      onHand: 50,
      available: 50,
      reserved: 0,
      picking: 0,
      packed: 0,
      damaged: 0,
      expired: 0,
      returned: 0,
      quarantined: 0,
    },
    warehouseLocation: 'B2-1',
    createdBy: manager._id,
  });

  const trace = await traceBatch(String(legacy._id));

  // "We do not know" and "this arrived before we recorded suppliers" are
  // different answers to an inspector, and only one of them is defensible.
  assert.equal(trace.origin.predatesPurchasing, true);
  assert.equal(trace.origin.supplierName, undefined);
  assert.equal(trace.recipients.length, 0);
});

test('stock cannot be booked in against an order that never issued it', async () => {
  const supplier = await Supplier.findOne({ name: 'Beximco Pharmaceuticals' });
  const medicine = await Medicine.findOne({ sku: 'NAP-RECALL' });
  const order = await PurchaseOrder.findOne({ supplierId: supplier!._id });

  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 2);

  const response = await call(
    'POST',
    `/api/v1/purchasing/orders/${order!._id}/receipts`,
    {
      lines: [
        {
          // A line id from nowhere.
          purchaseOrderLineId: String(new Types.ObjectId()),
          batchNumber: 'GHOST-1',
          manufacturingDate: '2026-01-01',
          expiryDate: expiry.toISOString(),
          receivedQuantity: 10,
          warehouseLocation: 'A1',
        },
      ],
    },
    storekeeper._id,
  );

  assert.equal(response.status, 400);
  assert.equal(await MedicineBatch.countDocuments({ batchNumber: 'GHOST-1' }), 0);
  assert.ok(medicine);
});

test('more cannot arrive than was ordered', async () => {
  const order = await PurchaseOrder.findOne({ supplierReference: 'BX-PO-2026-771' });
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 2);

  const response = await call(
    'POST',
    `/api/v1/purchasing/orders/${order!._id}/receipts`,
    {
      lines: [
        {
          purchaseOrderLineId: String(order!.lines[0]._id),
          batchNumber: 'BX-2026-A18',
          manufacturingDate: '2026-01-01',
          expiryDate: expiry.toISOString(),
          // 20 outstanding, 100 turning up.
          receivedQuantity: 100,
          warehouseLocation: 'A1-4',
        },
      ],
    },
    storekeeper._id,
  );

  assert.equal(response.status, 409);
  assert.equal((response.body.error as unknown as { code: string }).code, 'OVER_RECEIPT');
});

test('expired stock is refused on arrival rather than quarantined', async () => {
  const order = await PurchaseOrder.findOne({ supplierReference: 'BX-PO-2026-771' });

  const response = await call(
    'POST',
    `/api/v1/purchasing/orders/${order!._id}/receipts`,
    {
      lines: [
        {
          purchaseOrderLineId: String(order!.lines[0]._id),
          batchNumber: 'BX-OLD-1',
          manufacturingDate: '2020-01-01',
          expiryDate: '2024-01-01',
          receivedQuantity: 5,
          warehouseLocation: 'A1-5',
        },
      ],
    },
    storekeeper._id,
  );

  // Booking it in would create sellable-looking inventory that FEFO must then
  // be trusted to skip; refusing it keeps the shelf honest.
  assert.equal(response.status, 400);
  assert.equal((response.body.error as unknown as { code: string }).code, 'EXPIRED_ON_ARRIVAL');
});

test('a storekeeper cannot commit the business to buying something', async () => {
  const supplier = await Supplier.findOne({ name: 'Beximco Pharmaceuticals' });
  const medicine = await Medicine.findOne({ sku: 'NAP-RECALL' });

  const response = await call(
    'POST',
    '/api/v1/purchasing/orders',
    {
      supplierId: String(supplier!._id),
      lines: [{ medicineId: String(medicine!._id), orderedQuantity: 10, unitCostMinor: 800 }],
    },
    storekeeper._id,
  );

  assert.equal(response.status, 403);
});

test('the recall query is served by an index rather than a collection scan', async () => {
  const batch = await MedicineBatch.findOne({ batchNumber: 'BX-2026-A17' });
  const explanation = await Invoice.find({ 'items.batchId': batch!._id }).explain('queryPlanner');

  const plan = JSON.stringify(explanation);
  // `items.batchId` was required and populated on every invoice line and
  // indexed by nothing, so a recall would have scanned every invoice ever
  // issued — on the day it was most urgently needed.
  assert.ok(plan.includes('IXSCAN'), 'the recall lookup must use an index');
  assert.ok(!plan.includes('"stage":"COLLSCAN"'), 'a recall must never scan the collection');
});

test('the reads a purchasing screen needs all answer', async () => {
  const order = await PurchaseOrder.findOne({ supplierReference: 'BX-PO-2026-771' });

  const suppliers = await call(
    'GET',
    '/api/v1/purchasing/suppliers?limit=10',
    undefined,
    storekeeper._id,
  );
  assert.equal(suppliers.status, 200);
  assert.equal((suppliers.body.data as unknown as { total: number }).total, 1);

  const orders = await call(
    'GET',
    '/api/v1/purchasing/orders?limit=10',
    undefined,
    storekeeper._id,
  );
  assert.equal(orders.status, 200);

  const detail = await call(
    'GET',
    `/api/v1/purchasing/orders/${order!._id}`,
    undefined,
    storekeeper._id,
  );
  assert.equal(detail.status, 200);
  const body = detail.body.data as unknown as { receipts: unknown[] };
  assert.equal(body.receipts.length, 1, 'the order carries the receipt that filled it');

  // Whoever raises a recall is holding a supplier notice with a batch number on
  // it, not a database identifier.
  const lookup = await call(
    'GET',
    '/api/v1/purchasing/recall/batches?batchNumber=bx-2026-a17',
    undefined,
    storekeeper._id,
  );
  assert.equal(lookup.status, 200);
  assert.equal((lookup.body.data as unknown as unknown[]).length, 1, 'matched case-insensitively');
});

test('the controlled-substance register reports movement and any variance', async () => {
  // `MedicineClassification` has been stored on every medicine since the
  // catalogue phase and read by nothing at all.
  const prescription = await Medicine.create({
    reference: 'MED-CTRL-1',
    sku: 'CTRL-1',
    brandName: 'Sedaxin',
    genericName: 'Diazepam',
    manufacturer: 'Beximco',
    strength: '5mg',
    dosageForm: 'Tablet',
    packSize: '10',
    unit: 'box',
    category: 'Controlled',
    barcode: '8801234567901',
    costPriceMinor: 400,
    defaultSellingPriceMinor: 900,
    minimumOrderQuantity: 1,
    classification: MedicineClassification.PRESCRIPTION,
    createdBy: manager._id,
  });

  const quantities = {
    onHand: 60,
    available: 60,
    reserved: 0,
    picking: 0,
    packed: 0,
    damaged: 0,
    expired: 0,
    returned: 0,
    quarantined: 0,
  };
  const batch = await MedicineBatch.create({
    medicineId: prescription._id,
    batchNumber: 'CTRL-B1',
    manufacturingDate: new Date('2026-01-01'),
    expiryDate: new Date('2029-01-01'),
    costPriceMinor: 400,
    receivedQuantity: 60,
    quantities,
    warehouseLocation: 'C1',
    createdBy: manager._id,
  });
  await StockMovement.create({
    medicineId: prescription._id,
    batchId: batch._id,
    type: 'RECEIPT',
    quantity: 60,
    before: { ...quantities, onHand: 0, available: 0 },
    after: quantities,
    reason: 'Controlled stock receipt',
    referenceType: 'Test',
    referenceId: 'ctrl-1',
    actorId: storekeeper._id,
    actorRole: UserRole.STOREKEEPER,
    idempotencyKey: 'ctrl-receipt-1',
  });

  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 86_400_000).toISOString();
  const response = await call(
    'GET',
    `/api/v1/purchasing/controlled-register?from=${from}&to=${to}`,
  );
  assert.equal(response.status, 200);

  const register = response.body.data as unknown as {
    rows: Array<{ reference: string; receivedQuantity: number; varianceQuantity: number }>;
  };
  const row = register.rows.find((entry) => entry.reference === 'MED-CTRL-1');
  assert.ok(row, 'the prescription medicine appears on the register');
  assert.equal(row!.receivedQuantity, 60);
  // The register compares its own arithmetic against the shelf rather than only
  // adding up its own movements, which could never disagree with itself.
  assert.equal(row!.varianceQuantity, 0);

  // An OTC medicine is not on a controlled register.
  assert.equal(
    register.rows.some((entry) => entry.reference === 'MED-RECALL-1'),
    false,
  );
});

test('a storekeeper cannot produce the regulatory return', async () => {
  const response = await call(
    'GET',
    '/api/v1/purchasing/controlled-register',
    undefined,
    storekeeper._id,
  );
  assert.equal(response.status, 403);
});
