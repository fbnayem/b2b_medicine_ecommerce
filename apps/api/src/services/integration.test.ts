import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Server } from 'node:http';
import {
  MedicineClassification,
  PaymentMethod,
  ShopStatus,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { AuditLog } from '../models/AuditLog';
import { Counter } from '../models/Counter';
import { Invoice } from '../models/Invoice';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { Notification } from '../models/Notification';
import { Order } from '../models/Order';
import { OrderApproval } from '../models/OrderApproval';
import { Package } from '../models/Package';
import { PickingList } from '../models/PickingList';
import { Shop } from '../models/Shop';
import { StockMovement } from '../models/StockMovement';
import { User } from '../models/User';
import { Delivery } from '../models/Delivery';
import { ProofFile } from '../models/ProofFile';
import { CreditReservation } from '../models/CreditReservation';
import { LedgerTransaction } from '../models/LedgerTransaction';
import { Payment } from '../models/Payment';
import { PaymentAttachment } from '../models/PaymentAttachment';
import { receiveStock, reserveFefo } from './inventoryService';
import { getInvoiceBalance, postInvoiceCharge } from './ledgerService';

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

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
        return memoryReplica.getUri('medsupply_integration');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([
    AuditLog.init(),
    Counter.init(),
    Invoice.init(),
    Medicine.init(),
    MedicineBatch.init(),
    Notification.init(),
    Order.init(),
    OrderApproval.init(),
    Package.init(),
    PickingList.init(),
    Shop.init(),
    StockMovement.init(),
    User.init(),
    Delivery.init(),
    ProofFile.init(),
    CreditReservation.init(),
    LedgerTransaction.init(),
    Payment.init(),
    PaymentAttachment.init(),
  ]);
  await new Promise<void>((resolve) => {
    const runningServer = app.listen(0, '127.0.0.1', () => {
      const address = runningServer.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server = runningServer;
  });
});

test('two concurrent FEFO reservations cannot oversell', async () => {
  const actor = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
  const medicine = await Medicine.create({
    reference: 'MED-T-1',
    sku: 'T-1',
    brandName: 'TestMed',
    genericName: 'Generic',
    manufacturer: 'Maker',
    strength: '10mg',
    dosageForm: 'Tablet',
    packSize: '10',
    unit: 'box',
    category: 'Test',
    barcode: '1234567890128',
    costPriceMinor: 100,
    defaultSellingPriceMinor: 200,
    minimumOrderQuantity: 1,
    classification: MedicineClassification.OTC,
    createdBy: actor._id,
  });
  await receiveStock(
    {
      medicineId: String(medicine._id),
      batchNumber: 'B1',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2028-01-01'),
      costPriceMinor: 100,
      quantity: 10,
      warehouseLocation: 'A1',
    },
    actor,
  );
  const results = await Promise.allSettled([
    reserveFefo(String(medicine._id), 7, 'concurrent-a', 'Order', 'A', actor),
    reserveFefo(String(medicine._id), 7, 'concurrent-b', 'Order', 'B', actor),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const batch = await MedicineBatch.findOne({ medicineId: medicine._id });
  assert.equal(batch?.quantities.reserved, 7);
  assert.equal(batch?.quantities.available, 3);
});

test('order submission is idempotent and isolated between shops', async () => {
  const [ownerA, ownerB] = await User.create([
    {
      email: 'a@test.local',
      passwordHash: 'x',
      firstName: 'Owner',
      lastName: 'A',
      role: UserRole.SHOP_OWNER,
      status: UserStatus.ACTIVE,
    },
    {
      email: 'b@test.local',
      passwordHash: 'x',
      firstName: 'Owner',
      lastName: 'B',
      role: UserRole.SHOP_OWNER,
      status: UserStatus.ACTIVE,
    },
  ]);
  const address = {
    _id: new Types.ObjectId(),
    label: 'Main',
    line1: '1 Test Road',
    city: 'Dhaka',
    district: 'Dhaka',
    isDefault: true,
  };
  const shopA = await Shop.create({
    reference: 'SHP-T-A',
    name: 'Shop A',
    ownerIds: [ownerA._id],
    primaryPhone: '01700000001',
    status: ShopStatus.ACTIVE,
    deliveryAddresses: [address],
  });
  await Shop.create({
    reference: 'SHP-T-B',
    name: 'Shop B',
    ownerIds: [ownerB._id],
    primaryPhone: '01700000002',
    status: ShopStatus.ACTIVE,
    deliveryAddresses: [{ ...address, _id: new Types.ObjectId() }],
  });
  const medicine = await Medicine.findOne({ sku: 'T-1' });
  const body = {
    items: [{ medicineId: String(medicine!._id), requestedQuantity: 2 }],
    deliveryAddressId: String(shopA.deliveryAddresses[0]!._id),
    requestedPaymentMethod: 'CASH',
    idempotencyKey: 'integration-submit-1',
  };
  const send = () =>
    fetch(`${base}/api/v1/orders/submit`, {
      method: 'POST',
      headers: authorization(ownerA._id),
      body: JSON.stringify(body),
    });
  const first = await send();
  const firstData = (await first.json()) as { data: { _id: string } };
  const replay = await send();
  const replayData = (await replay.json()) as { data: { _id: string } };
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(replayData.data._id, firstData.data._id);
  assert.equal(await Order.countDocuments({ submissionIdempotencyKey: body.idempotencyKey }), 1);
  const forbidden = await fetch(`${base}/api/v1/orders/${firstData.data._id}`, {
    headers: authorization(ownerB._id),
  });
  assert.equal(forbidden.status, 403);
});

test('simultaneous managers cannot approve twice and approval creates picking and notifications', async () => {
  const order = await Order.findOne({ submissionIdempotencyKey: 'integration-submit-1' });
  assert.ok(order);
  const [manager, storekeeper] = await User.create([
    {
      email: 'manager@test.local',
      passwordHash: 'x',
      firstName: 'Test',
      lastName: 'Manager',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    },
    {
      email: 'store@test.local',
      passwordHash: 'x',
      firstName: 'Test',
      lastName: 'Store',
      role: UserRole.STOREKEEPER,
      status: UserStatus.ACTIVE,
    },
  ]);
  const started = await fetch(`${base}/api/v1/approvals/${order._id}/start`, {
    method: 'POST',
    headers: authorization(manager._id),
    body: JSON.stringify({ version: order.version }),
  });
  assert.equal(started.status, 200);
  const startedBody = (await started.json()) as {
    data: {
      version: number;
      items: Array<{ _id: string; requestedQuantity: number; estimatedUnitPriceMinor: number }>;
    };
  };
  const input = {
    version: startedBody.data.version,
    lines: startedBody.data.items.map((item) => ({
      orderItemId: item._id,
      approvedQuantity: item.requestedQuantity,
      unitPriceMinor: item.estimatedUnitPriceMinor,
      lineDiscountMinor: 0,
    })),
    orderDiscountMinor: 0,
    deliveryChargeMinor: 0,
    creditOverride: false,
  };
  const approve = () =>
    fetch(`${base}/api/v1/approvals/${order._id}/approve`, {
      method: 'POST',
      headers: authorization(manager._id),
      body: JSON.stringify(input),
    });
  const responses = await Promise.all([approve(), approve()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(await OrderApproval.countDocuments({ orderId: order._id }), 1);
  assert.equal(await PickingList.countDocuments({ orderId: order._id }), 1);
  assert.ok(await Notification.exists({ recipientId: storekeeper._id, type: 'PICKING_READY' }));
});

test('failed approval rolls back reservations and leaves order submitted', async () => {
  const source = await Order.findOne({ submissionIdempotencyKey: 'integration-submit-1' });
  assert.ok(source);
  const failed = await Order.create({
    reference: 'ORD-ROLLBACK',
    shopId: source.shopId,
    submittedBy: source.submittedBy,
    items: source.items.map((item) => ({ ...item.toObject(), requestedQuantity: 99 })),
    requestedPaymentMethod: 'CASH',
    estimatedSubtotalMinor: 1,
    estimatedDiscountMinor: 0,
    estimatedDeliveryChargeMinor: 0,
    estimatedTotalMinor: 1,
    status: 'SUBMITTED',
    statusHistory: [{ to: 'SUBMITTED', actorId: source.submittedBy, at: new Date() }],
    version: 0,
  });
  const manager = await User.findOne({ role: UserRole.MANAGER });
  const batch = await MedicineBatch.findOne({ medicineId: failed.items[0]!.medicineId });
  const reservedBefore = batch!.quantities.reserved;
  const response = await fetch(`${base}/api/v1/approvals/${failed._id}/approve`, {
    method: 'POST',
    headers: authorization(manager!._id),
    body: JSON.stringify({
      version: 0,
      lines: [
        {
          orderItemId: String(failed.items[0]!._id),
          approvedQuantity: 99,
          unitPriceMinor: 200,
          lineDiscountMinor: 0,
        },
      ],
      orderDiscountMinor: 0,
      deliveryChargeMinor: 0,
      creditOverride: false,
    }),
  });
  assert.equal(response.status, 409);
  assert.equal((await MedicineBatch.findById(batch!._id))!.quantities.reserved, reservedBefore);
  assert.equal((await Order.findById(failed._id))!.status, 'SUBMITTED');
  assert.equal(await OrderApproval.countDocuments({ orderId: failed._id }), 0);
});

test('picking, discrepancy resolution, short packing and immutable invoice are transactional', async () => {
  const order = await Order.findOne({ submissionIdempotencyKey: 'integration-submit-1' });
  const list = await PickingList.findOne({ orderId: order!._id });
  const storekeeper = await User.findOne({ role: UserRole.STOREKEEPER });
  const manager = await User.findOne({ role: UserRole.MANAGER });
  const owners = await User.find({ role: UserRole.SHOP_OWNER }).sort({ email: 1 });
  assert.ok(order && list && storekeeper && manager && owners[0] && owners[1]);
  const batch = await MedicineBatch.findById(list.items[0]!.batchId);
  assert.ok(batch);

  const startPicking = () =>
    fetch(`${base}/api/v1/fulfilment/picking/${list._id}/start`, {
      method: 'POST',
      headers: authorization(storekeeper._id),
      body: JSON.stringify({ version: list.version }),
    });
  const concurrentStarts = await Promise.all([startPicking(), startPicking()]);
  assert.deepEqual(concurrentStarts.map((response) => response.status).sort(), [200, 409]);
  let current = await PickingList.findById(list._id);
  assert.equal(current!.status, 'PICKING');
  assert.equal(current!.items[0]!.pickedQuantity, 0);

  const managerCannotPick = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/progress`, {
    method: 'POST',
    headers: authorization(manager._id),
    body: JSON.stringify({ version: current!.version, action: 'SAVE', items: [] }),
  });
  assert.equal(managerCannotPick.status, 403);

  const progressBody = (action: 'SAVE' | 'PAUSE' | 'COMPLETE') => ({
    version: current!.version,
    action,
    items: current!.items.map((item) => ({
      medicineId: String(item.medicineId),
      batchId: String(item.batchId),
      pickedQuantity: 1,
    })),
  });
  await MedicineBatch.findByIdAndUpdate(batch._id, { $set: { isBlocked: true } });
  const blocked = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/progress`, {
    method: 'POST',
    headers: authorization(storekeeper._id),
    body: JSON.stringify(progressBody('SAVE')),
  });
  assert.equal(blocked.status, 409);
  await MedicineBatch.findByIdAndUpdate(batch._id, {
    $set: { isBlocked: false, expiryDate: new Date('2025-01-01') },
  });
  const expired = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/progress`, {
    method: 'POST',
    headers: authorization(storekeeper._id),
    body: JSON.stringify(progressBody('SAVE')),
  });
  assert.equal(expired.status, 409);
  await MedicineBatch.findByIdAndUpdate(batch._id, {
    $set: { expiryDate: new Date('2028-01-01') },
  });

  const paused = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/progress`, {
    method: 'POST',
    headers: authorization(storekeeper._id),
    body: JSON.stringify(progressBody('PAUSE')),
  });
  assert.equal(paused.status, 200);
  current = await PickingList.findById(list._id);
  assert.equal(current!.status, 'PAUSED');
  const resumed = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/resume`, {
    method: 'POST',
    headers: authorization(storekeeper._id),
    body: JSON.stringify({ version: current!.version }),
  });
  assert.equal(resumed.status, 200);
  current = await PickingList.findById(list._id);

  const discrepancy = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/discrepancies`, {
    method: 'POST',
    headers: authorization(storekeeper._id),
    body: JSON.stringify({
      version: current!.version,
      type: 'MISSING_QUANTITY',
      medicineId: String(current!.items[0]!.medicineId),
      batchId: String(current!.items[0]!.batchId),
      quantity: 1,
      notes: 'One allocated unit is missing',
    }),
  });
  assert.equal(discrepancy.status, 200);
  current = await PickingList.findById(list._id);
  assert.equal(current!.status, 'BLOCKED_DISCREPANCY');
  assert.ok(await AuditLog.exists({ entityId: list._id, action: 'PICKING_DISCREPANCY_REPORTED' }));
  assert.ok(await Notification.exists({ recipientId: manager._id, type: 'PICKING_DISCREPANCY' }));
  const resolved = await fetch(
    `${base}/api/v1/fulfilment/picking/${list._id}/discrepancies/resolve`,
    {
      method: 'POST',
      headers: authorization(manager._id),
      body: JSON.stringify({
        version: current!.version,
        resolutionNotes: 'Pack the available quantity and release the remainder',
      }),
    },
  );
  assert.equal(resolved.status, 200);
  current = await PickingList.findById(list._id);
  assert.equal(current!.status, 'PICKING');
  assert.equal(current!.discrepancies[0]!.status, 'RESOLVED');

  const complete = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/progress`, {
    method: 'POST',
    headers: authorization(storekeeper._id),
    body: JSON.stringify(progressBody('COMPLETE')),
  });
  assert.equal(complete.status, 200);
  current = await PickingList.findById(list._id);
  assert.equal(current!.status, 'PACKING');
  const packingBody = (packedQuantity: number) => ({
    version: current!.version,
    items: current!.items.map((item) => ({
      medicineId: String(item.medicineId),
      batchId: String(item.batchId),
      packedQuantity,
      shortfallReason: packedQuantity < item.pickedQuantity! ? 'One unit unavailable' : undefined,
    })),
    packageCount: 2,
    weightGrams: 750,
    notes: 'Keep dry',
  });
  const batchBeforeInvalidPack = await MedicineBatch.findById(batch._id);
  const overLimit = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/pack`, {
    method: 'POST',
    headers: authorization(storekeeper._id),
    body: JSON.stringify(packingBody(2)),
  });
  assert.equal(overLimit.status, 400);
  assert.equal(await Invoice.countDocuments({ orderId: order._id }), 0);
  assert.deepEqual(
    JSON.parse(JSON.stringify((await MedicineBatch.findById(batch._id))!.quantities)),
    JSON.parse(JSON.stringify(batchBeforeInvalidPack!.quantities)),
  );

  await MedicineBatch.findByIdAndUpdate(batch._id, {
    $set: { expiryDate: new Date('2025-01-01') },
  });
  const expiredPack = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/pack`, {
    method: 'POST',
    headers: authorization(storekeeper._id),
    body: JSON.stringify(packingBody(1)),
  });
  assert.equal(expiredPack.status, 409);
  await MedicineBatch.findByIdAndUpdate(batch._id, {
    $set: { expiryDate: new Date('2028-01-01') },
  });

  const packedResponse = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/pack`, {
    method: 'POST',
    headers: authorization(storekeeper._id),
    body: JSON.stringify(packingBody(1)),
  });
  assert.equal(packedResponse.status, 200);
  const packedData = (await packedResponse.json()) as {
    data: {
      invoice: {
        _id: string;
        reference: string;
        grandTotalMinor: number;
        items: Array<{ quantity: number }>;
      };
      package: { reference: string; packageCount: number };
    };
  };
  assert.equal(packedData.data.invoice.items[0]!.quantity, 1);
  assert.equal(packedData.data.invoice.grandTotalMinor, 200);
  assert.match(packedData.data.invoice.reference, /^INV-\d{4}-\d{6}$/);
  assert.match(packedData.data.package.reference, /^PKG-\d{4}-\d{6}$/);
  assert.equal(packedData.data.package.packageCount, 2);
  assert.equal((await Order.findById(order._id))!.status, 'READY_FOR_DELIVERY');
  const finalBatch = await MedicineBatch.findById(batch._id);
  assert.equal(finalBatch!.quantities.picking, 0);
  assert.equal(finalBatch!.quantities.packed, 1);
  assert.equal(finalBatch!.quantities.available, 2);
  assert.ok(
    await StockMovement.exists({
      referenceId: String(list._id),
      type: 'PICKING_RETURN',
      quantity: 1,
    }),
  );
  assert.ok(await Notification.exists({ recipientId: manager._id, type: 'PACKING_SHORTFALL' }));

  const replayPack = await fetch(`${base}/api/v1/fulfilment/picking/${list._id}/pack`, {
    method: 'POST',
    headers: authorization(storekeeper._id),
    body: JSON.stringify(packingBody(1)),
  });
  assert.equal(replayPack.status, 409);
  assert.equal(await Invoice.countDocuments({ orderId: order._id }), 1);
  assert.equal(await Package.countDocuments({ orderId: order._id }), 1);

  const invoice = await Invoice.findById(packedData.data.invoice._id);
  invoice!.footer = 'Changed after issue';
  await assert.rejects(invoice!.save(), /immutable/i);
  assert.notEqual((await Invoice.findById(invoice!._id))!.footer, 'Changed after issue');

  for (const layout of ['a4', 'thermal']) {
    const pdfResponse: Response = await fetch(
      `${base}/api/v1/fulfilment/invoices/${invoice!._id}/pdf?layout=${layout}`,
      { headers: authorization(storekeeper._id) },
    );
    assert.equal(pdfResponse.status, 200);
    assert.match(pdfResponse.headers.get('content-type') ?? '', /application\/pdf/);
    const bytes = Buffer.from(await pdfResponse.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.4');
    assert.match(
      bytes.toString(),
      layout === 'thermal' ? /MediaBox \[0 0 226 842\]/ : /MediaBox \[0 0 595 842\]/,
    );
  }
  const ownerAInvoice = await fetch(`${base}/api/v1/fulfilment/invoices/${invoice!._id}`, {
    headers: authorization(owners[0]._id),
  });
  const ownerBInvoice = await fetch(`${base}/api/v1/fulfilment/invoices/${invoice!._id}`, {
    headers: authorization(owners[1]._id),
  });
  assert.equal(ownerAInvoice.status, 200);
  assert.equal(ownerBInvoice.status, 403);
  const ready = await fetch(`${base}/api/v1/fulfilment/ready`, {
    headers: authorization(storekeeper._id),
  });
  assert.equal(ready.status, 200);
  const readyData = (await ready.json()) as { data: Array<{ reference: string }> };
  assert.ok(readyData.data.some((item) => item.reference === packedData.data.package.reference));
});

test('delivery assignment, handover, proof, idempotency, permissions, failure and return are controlled', async () => {
  const order = await Order.findOne({ submissionIdempotencyKey: 'integration-submit-1' });
  const delivery = await Delivery.findOne({ orderId: order!._id });
  const pack = await Package.findOne({ orderId: order!._id });
  const invoice = await Invoice.findOne({ orderId: order!._id });
  const manager = await User.findOne({ role: UserRole.MANAGER });
  const storekeeper = await User.findOne({ role: UserRole.STOREKEEPER });
  const owners = await User.find({ role: UserRole.SHOP_OWNER }).sort({ email: 1 });
  assert.ok(
    order && delivery && pack && invoice && manager && storekeeper && owners[0] && owners[1],
  );
  assert.match(delivery.reference, /^DEL-\d{4}-\d{6}$/);
  assert.equal(delivery.status, 'READY_FOR_ASSIGNMENT');

  const [driverA, driverB] = await User.create([
    {
      email: 'driver-a@test.local',
      passwordHash: 'x',
      firstName: 'Driver',
      lastName: 'A',
      role: UserRole.DELIVERY_PERSON,
      status: UserStatus.ACTIVE,
    },
    {
      email: 'driver-b@test.local',
      passwordHash: 'x',
      firstName: 'Driver',
      lastName: 'B',
      role: UserRole.DELIVERY_PERSON,
      status: UserStatus.ACTIVE,
    },
  ]);
  const post = (path: string, userId: Types.ObjectId, body: Record<string, unknown>) =>
    fetch(`${base}/api/v1/deliveries/${delivery._id}/${path}`, {
      method: 'POST',
      headers: authorization(userId),
      body: JSON.stringify(body),
    });

  const storeCannotAssign = await post('assign', storekeeper._id, {
    version: delivery.version,
    idempotencyKey: 'delivery-forbidden-assign',
    deliveryPersonId: String(driverA._id),
    expectedDeliveryDate: '2026-07-30',
    priority: 'NORMAL',
  });
  assert.equal(storeCannotAssign.status, 403);
  let current = await Delivery.findById(delivery._id);
  const firstAssignment = await post('assign', manager._id, {
    version: current!.version,
    idempotencyKey: 'delivery-assign-driver-a',
    deliveryPersonId: String(driverA._id),
    expectedDeliveryDate: '2026-07-30',
    priority: 'HIGH',
  });
  assert.equal(firstAssignment.status, 200);
  current = await Delivery.findById(delivery._id);
  const reassignment = await post('assign', manager._id, {
    version: current!.version,
    idempotencyKey: 'delivery-reassign-driver-b',
    deliveryPersonId: String(driverB._id),
    expectedDeliveryDate: '2026-07-31',
    priority: 'URGENT',
    instructions: 'Call before arrival',
  });
  assert.equal(reassignment.status, 200);
  current = await Delivery.findById(delivery._id);
  assert.equal(String(current!.assignedTo), String(driverB._id));
  assert.equal((await Order.findById(order._id))!.status, 'DELIVERY_ASSIGNED');
  const oldDriverAccess = await fetch(`${base}/api/v1/deliveries/${delivery._id}`, {
    headers: authorization(driverA._id),
  });
  assert.equal(oldDriverAccess.status, 403);

  const mismatch = await post('handover', storekeeper._id, {
    version: current!.version,
    idempotencyKey: 'delivery-handover-mismatch',
    packageReference: 'WRONG',
    invoiceReference: invoice.reference,
    packageCount: pack.packageCount,
  });
  assert.equal(mismatch.status, 400);
  const handover = await post('handover', storekeeper._id, {
    version: current!.version,
    idempotencyKey: 'delivery-handover-ok',
    packageReference: pack.reference,
    invoiceReference: invoice.reference,
    packageCount: pack.packageCount,
  });
  assert.equal(handover.status, 200);
  current = await Delivery.findById(delivery._id);
  assert.equal(current!.status, 'HANDED_OVER');
  const pickupBeforeAck = await post('pickup', driverB._id, {
    version: current!.version,
    idempotencyKey: 'delivery-pickup-before-ack',
  });
  assert.equal(pickupBeforeAck.status, 409);
  const acknowledgement = await post('acknowledge', driverB._id, {
    version: current!.version,
    idempotencyKey: 'delivery-acknowledge-ok',
  });
  assert.equal(acknowledgement.status, 200);
  current = await Delivery.findById(delivery._id);
  const pickup = await post('pickup', driverB._id, {
    version: current!.version,
    idempotencyKey: 'delivery-pickup-ok',
  });
  assert.equal(pickup.status, 200);
  current = await Delivery.findById(delivery._id);
  const started = await post('start', driverB._id, {
    version: current!.version,
    idempotencyKey: 'delivery-start-ok',
  });
  assert.equal(started.status, 200);
  current = await Delivery.findById(delivery._id);
  const arrived = await post('arrived', driverB._id, {
    version: current!.version,
    idempotencyKey: 'delivery-arrived-ok',
  });
  assert.equal(arrived.status, 200);
  current = await Delivery.findById(delivery._id);

  const managerCannotComplete = await post('complete', manager._id, {
    version: current!.version,
    idempotencyKey: 'delivery-manager-complete',
  });
  assert.equal(managerCannotComplete.status, 403);
  const otpResponse = await post('send-otp', driverB._id, {
    version: current!.version,
    idempotencyKey: 'delivery-send-otp',
  });
  assert.equal(otpResponse.status, 200);
  current = await Delivery.findById(delivery._id);
  const otpNotification = await Notification.findOne({
    recipientId: owners[0]._id,
    type: 'DELIVERY_OTP',
  }).sort({ createdAt: -1 });
  const otp = otpNotification?.body.match(/\b\d{6}\b/)?.[0];
  assert.ok(otp);
  const invalidOtp = await post('complete', driverB._id, {
    version: current!.version,
    idempotencyKey: 'delivery-complete-invalid-otp',
    receiverName: 'Receiver One',
    receiverPhone: '01700000001',
    otp: '000000',
    deliveredPackageCount: pack.packageCount,
    collectedAmountMinor: 0,
  });
  assert.equal(invalidOtp.status, 400);
  const onePixelPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const completeBody = {
    version: current!.version,
    idempotencyKey: 'delivery-complete-ok',
    receiverName: 'Receiver One',
    receiverPhone: '01700000001',
    otp,
    photograph: { fileName: 'proof.png', mimeType: 'image/png', base64Data: onePixelPng },
    gps: {
      latitude: 23.8103,
      longitude: 90.4125,
      accuracyMetres: 8,
      capturedAt: new Date().toISOString(),
    },
    deliveredPackageCount: pack.packageCount,
    collectedAmountMinor: 0,
  };
  const completed = await post('complete', driverB._id, completeBody);
  assert.equal(completed.status, 200);
  const replay = await post('complete', driverB._id, completeBody);
  assert.equal(replay.status, 200);
  const replayBody = (await replay.json()) as { meta: { idempotentReplay: boolean } };
  assert.equal(replayBody.meta.idempotentReplay, true);
  current = await Delivery.findById(delivery._id);
  assert.equal(current!.status, 'DELIVERED');
  assert.equal((await Order.findById(order._id))!.status, 'DELIVERED');
  assert.equal(await ProofFile.countDocuments({ deliveryId: delivery._id }), 1);
  assert.ok(await AuditLog.exists({ entityId: delivery._id, action: 'DELIVERY_CONFIRMED' }));
  const ownerDelivery = await fetch(`${base}/api/v1/deliveries/order/${order._id}`, {
    headers: authorization(owners[0]._id),
  });
  const otherOwnerDelivery = await fetch(`${base}/api/v1/deliveries/order/${order._id}`, {
    headers: authorization(owners[1]._id),
  });
  assert.equal(ownerDelivery.status, 200);
  assert.equal(otherOwnerDelivery.status, 403);

  const failedOrder = await Order.create({
    reference: 'ORD-DELIVERY-FAIL',
    shopId: order.shopId,
    submittedBy: order.submittedBy,
    items: order.items.map((item) => item.toObject()),
    deliveryAddressSnapshot: order.deliveryAddressSnapshot,
    contactSnapshot: order.contactSnapshot,
    estimatedSubtotalMinor: 1,
    estimatedDiscountMinor: 0,
    estimatedDeliveryChargeMinor: 0,
    estimatedTotalMinor: 1,
    status: 'OUT_FOR_DELIVERY',
    statusHistory: [{ to: 'OUT_FOR_DELIVERY', actorId: manager._id, at: new Date() }],
    version: 0,
  });
  const failedPack = await Package.create({
    reference: 'PKG-DELIVERY-FAIL',
    orderId: failedOrder._id,
    invoiceId: new Types.ObjectId(),
    packageCount: 1,
    packedBy: storekeeper._id,
    packedAt: new Date(),
    handoverStatus: 'HANDED_OVER',
    barcode: 'PKG:DELIVERY:FAIL',
  });
  const failedDelivery = await Delivery.create({
    reference: 'DEL-DELIVERY-FAIL',
    orderId: failedOrder._id,
    packageId: failedPack._id,
    invoiceId: failedPack.invoiceId,
    shopId: order.shopId,
    addressSnapshot: order.deliveryAddressSnapshot,
    contactSnapshot: order.contactSnapshot,
    status: 'OUT_FOR_DELIVERY',
    assignedTo: driverB._id,
    proofRequirements: ['OTP'],
    history: [
      { to: 'OUT_FOR_DELIVERY', actorId: manager._id, actorRole: UserRole.MANAGER, at: new Date() },
    ],
  });
  const failedPost = (path: string, userId: Types.ObjectId, body: Record<string, unknown>) =>
    fetch(`${base}/api/v1/deliveries/${failedDelivery._id}/${path}`, {
      method: 'POST',
      headers: authorization(userId),
      body: JSON.stringify(body),
    });
  const failure = await failedPost('fail', driverB._id, {
    version: 0,
    idempotencyKey: 'delivery-failure-report',
    reason: 'SHOP_CLOSED',
    notes: 'Shutters were closed',
  });
  assert.equal(failure.status, 200);
  let failedCurrent = await Delivery.findById(failedDelivery._id);
  const returning = await failedPost('returning', driverB._id, {
    version: failedCurrent!.version,
    idempotencyKey: 'delivery-return-start',
  });
  assert.equal(returning.status, 200);
  failedCurrent = await Delivery.findById(failedDelivery._id);
  const returned = await failedPost('returned', storekeeper._id, {
    version: failedCurrent!.version,
    idempotencyKey: 'delivery-return-confirm',
  });
  assert.equal(returned.status, 200);
  assert.equal((await Delivery.findById(failedDelivery._id))!.status, 'RETURNED_TO_STORE');
  assert.equal((await Package.findById(failedPack._id))!.handoverStatus, 'RETURNED_TO_STORE');
  failedCurrent = await Delivery.findById(failedDelivery._id);
  const retryAssignment = await failedPost('assign', manager._id, {
    version: failedCurrent!.version,
    idempotencyKey: 'delivery-reassign-after-return',
    deliveryPersonId: String(driverA._id),
    expectedDeliveryDate: '2026-08-01',
    priority: 'HIGH',
    instructions: 'Second attempt after package return',
  });
  assert.equal(retryAssignment.status, 200);
  assert.equal((await Delivery.findById(failedDelivery._id))!.status, 'ASSIGNED');
  assert.equal((await Package.findById(failedPack._id))!.handoverStatus, 'AWAITING_HANDOVER');
  assert.equal((await Order.findById(failedOrder._id))!.status, 'DELIVERY_ASSIGNED');
});

test('concurrent credit approvals reserve exposure atomically and manager override is explicit', async () => {
  const manager = await User.findOne({ role: UserRole.MANAGER });
  const owner = await User.findOne({ role: UserRole.SHOP_OWNER });
  assert.ok(manager && owner);
  const medicine = await Medicine.create({
    reference: 'MED-CREDIT-1',
    sku: 'CREDIT-1',
    brandName: 'Credit Test',
    genericName: 'Generic',
    manufacturer: 'Maker',
    strength: '5mg',
    dosageForm: 'Tablet',
    packSize: '10',
    unit: 'box',
    category: 'Test',
    costPriceMinor: 50,
    defaultSellingPriceMinor: 200,
    minimumOrderQuantity: 1,
    classification: MedicineClassification.OTC,
    createdBy: manager._id,
  });
  await receiveStock(
    {
      medicineId: String(medicine._id),
      batchNumber: 'CREDIT-B1',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2028-01-01'),
      costPriceMinor: 50,
      quantity: 5,
      warehouseLocation: 'C1',
    },
    { _id: manager._id, role: UserRole.MANAGER },
  );
  const address = {
    _id: new Types.ObjectId(),
    label: 'Main',
    line1: '10 Credit Road',
    city: 'Dhaka',
    district: 'Dhaka',
    isDefault: true,
  };
  const creditShop = await Shop.create({
    reference: 'SHP-CREDIT-ATOMIC',
    name: 'Atomic Credit Shop',
    ownerIds: [owner._id],
    primaryPhone: '01700000009',
    status: ShopStatus.ACTIVE,
    creditLimit: 250,
    reservedCreditMinor: 0,
    deliveryAddresses: [address],
  });
  const makeOrder = (reference: string) =>
    Order.create({
      reference,
      shopId: creditShop._id,
      submittedBy: owner._id,
      items: [
        {
          medicineId: medicine._id,
          medicineSnapshot: {
            reference: medicine.reference,
            sku: medicine.sku,
            brandName: medicine.brandName,
            genericName: medicine.genericName,
            manufacturer: medicine.manufacturer,
            strength: medicine.strength,
            dosageForm: medicine.dosageForm,
            packSize: medicine.packSize,
            unit: medicine.unit,
          },
          requestedQuantity: 1,
          estimatedUnitPriceMinor: 200,
          estimatedDiscountMinor: 0,
          estimatedLineTotalMinor: 200,
          availableStockSnapshot: 5,
        },
      ],
      deliveryAddressSnapshot: address,
      contactSnapshot: { name: 'Credit Owner', phone: creditShop.primaryPhone },
      requestedPaymentMethod: PaymentMethod.CREDIT,
      estimatedSubtotalMinor: 200,
      estimatedDiscountMinor: 0,
      estimatedDeliveryChargeMinor: 0,
      estimatedTotalMinor: 200,
      status: 'SUBMITTED',
      statusHistory: [{ to: 'SUBMITTED', actorId: owner._id, at: new Date() }],
      version: 0,
    });
  const [orderA, orderB] = await Promise.all([
    makeOrder('ORD-CREDIT-ATOMIC-A'),
    makeOrder('ORD-CREDIT-ATOMIC-B'),
  ]);
  const inputFor = (order: InstanceType<typeof Order>, override = false) => ({
    version: order.version,
    lines: [
      {
        orderItemId: String(order.items[0]!._id),
        approvedQuantity: 1,
        unitPriceMinor: 200,
        lineDiscountMinor: 0,
      },
    ],
    orderDiscountMinor: 0,
    deliveryChargeMinor: 0,
    creditOverride: override,
    internalNotes: override
      ? 'Manager accepted temporary exposure after account review'
      : undefined,
  });
  const approve = (order: InstanceType<typeof Order>, override = false) =>
    fetch(`${base}/api/v1/approvals/${order._id}/approve`, {
      method: 'POST',
      headers: authorization(manager._id),
      body: JSON.stringify(inputFor(order, override)),
    });
  const decisions = await Promise.all([approve(orderA), approve(orderB)]);
  assert.deepEqual(decisions.map((response) => response.status).sort(), [200, 409]);
  assert.equal(
    await CreditReservation.countDocuments({ shopId: creditShop._id, status: 'ACTIVE' }),
    1,
  );
  assert.equal((await Shop.findById(creditShop._id))!.reservedCreditMinor, 200);
  const rejectedOrder =
    (await Order.findById(orderA._id))!.status === 'SUBMITTED' ? orderA : orderB;
  const override = await approve(rejectedOrder, true);
  assert.equal(override.status, 200);
  assert.equal(
    await CreditReservation.countDocuments({ shopId: creditShop._id, status: 'ACTIVE' }),
    2,
  );
  assert.equal((await Shop.findById(creditShop._id))!.reservedCreditMinor, 400);
  const overrideReservation = await CreditReservation.findOne({ orderId: rejectedOrder._id });
  assert.equal(overrideReservation!.decisionSnapshot.overrideApplied, true);
  assert.equal(overrideReservation!.decisionSnapshot.overrideRole, UserRole.MANAGER);

  const legacyOrder = await makeOrder('ORD-CREDIT-BACKFILL');
  await Order.updateOne({ _id: legacyOrder._id }, { $set: { status: 'APPROVED' } });
  await OrderApproval.create({
    orderId: legacyOrder._id,
    managerId: manager._id,
    decision: 'APPROVED',
    lines: [
      {
        orderItemId: legacyOrder.items[0]!._id,
        medicineId: medicine._id,
        requestedQuantity: 1,
        approvedQuantity: 1,
        unitPriceMinor: 200,
        lineDiscountMinor: 0,
        lineTotalMinor: 200,
        allocations: [],
      },
    ],
    subtotalMinor: 200,
    totalMinor: 200,
    creditOverride: true,
  });
  const migrationAdmin = await User.create({
    email: 'credit-migration-admin@test.local',
    passwordHash: 'x',
    firstName: 'Credit',
    lastName: 'Migration',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
  });
  const backfillBody = {
    orderId: String(legacyOrder._id),
    reason: 'Approved before the Phase 8 credit reservation rollout',
    idempotencyKey: 'credit-reservation-backfill-legacy-order',
  };
  const backfill = (userId: Types.ObjectId) =>
    fetch(`${base}/api/v1/finance/credit-reservations/backfill`, {
      method: 'POST',
      headers: authorization(userId),
      body: JSON.stringify(backfillBody),
    });
  assert.equal((await backfill(manager._id)).status, 403);
  assert.equal((await backfill(migrationAdmin._id)).status, 201);
  assert.equal((await backfill(migrationAdmin._id)).status, 200);
  const changedBackfill = await fetch(`${base}/api/v1/finance/credit-reservations/backfill`, {
    method: 'POST',
    headers: authorization(migrationAdmin._id),
    body: JSON.stringify({ ...backfillBody, reason: 'A different migration explanation' }),
  });
  assert.equal(changedBackfill.status, 409);
  assert.equal(await CreditReservation.countDocuments({ orderId: legacyOrder._id }), 1);
  assert.equal((await Shop.findById(creditShop._id))!.reservedCreditMinor, 600);
  assert.equal(
    await AuditLog.countDocuments({
      action: 'CREDIT_RESERVATION_BACKFILLED',
      entityId: legacyOrder._id,
    }),
    1,
  );
  const migratedReservation = await CreditReservation.findOne({ orderId: legacyOrder._id });
  assert.equal(migratedReservation!.source, 'MIGRATION_BACKFILL');
  assert.equal(migratedReservation!.decisionSnapshot.overrideApplied, false);
  assert.equal(migratedReservation!.migrationBackfill!.originalCreditOverride, true);
});

test('payments, delivery collections, receipts, reversal, statements and permissions stay ledger-safe', async () => {
  const invoice = await Invoice.findOne({ status: 'ISSUED' }).sort({ createdAt: 1 });
  const manager = await User.findOne({ role: UserRole.MANAGER });
  const driver = await User.findOne({ role: UserRole.DELIVERY_PERSON });
  const owners = await User.find({ role: UserRole.SHOP_OWNER }).sort({ email: 1 });
  const shop = invoice && (await Shop.findById(invoice.shopId));
  assert.ok(invoice && manager && driver && owners[0] && owners[1] && shop);
  const admin = await User.create({
    email: 'finance-admin@test.local',
    passwordHash: 'x',
    firstName: 'Finance',
    lastName: 'Admin',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
  });
  const record = (body: Record<string, unknown>) =>
    fetch(`${base}/api/v1/payments`, {
      method: 'POST',
      headers: authorization(manager._id),
      body: JSON.stringify(body),
    });
  const partialInput = {
    shopId: String(shop._id),
    invoiceId: String(invoice._id),
    amountMinor: 75,
    method: PaymentMethod.CASH,
    collectedAt: new Date().toISOString(),
    allowAdvance: false,
    postNow: true,
    idempotencyKey: 'finance-partial-payment-1',
  };
  const partialResponse = await record(partialInput);
  const partialBody = (await partialResponse.json()) as {
    data: { _id: string; reference: string };
  };
  assert.equal(partialResponse.status, 201);
  assert.match(partialBody.data.reference, /^PAY-\d{4}-\d{6}$/);
  assert.equal((await record(partialInput)).status, 200);
  assert.equal(await Payment.countDocuments({ idempotencyKey: partialInput.idempotencyKey }), 1);
  assert.equal((await record({ ...partialInput, amountMinor: 76 })).status, 409);
  assert.equal((await getInvoiceBalance(invoice._id)).currentAmountDueMinor, 125);

  const overpayment = await record({
    shopId: String(shop._id),
    invoiceId: String(invoice._id),
    amountMinor: 126,
    method: PaymentMethod.CASH,
    allowAdvance: false,
    postNow: true,
    idempotencyKey: 'finance-overpayment-blocked',
  });
  assert.equal(overpayment.status, 409);
  assert.equal(await Payment.countDocuments({ idempotencyKey: 'finance-overpayment-blocked' }), 0);
  const finalResponse = await record({
    shopId: String(shop._id),
    invoiceId: String(invoice._id),
    amountMinor: 125,
    method: PaymentMethod.BANK_TRANSFER,
    transactionReference: 'INT-BANK-0001',
    allowAdvance: false,
    postNow: true,
    idempotencyKey: 'finance-final-payment-1',
  });
  const finalBody = (await finalResponse.json()) as { data: { _id: string } };
  assert.equal(finalResponse.status, 201);
  assert.equal((await getInvoiceBalance(invoice._id)).currentAmountDueMinor, 0);
  assert.equal(
    (
      await record({
        shopId: String(shop._id),
        invoiceId: String(invoice._id),
        amountMinor: 1,
        method: PaymentMethod.BANK_TRANSFER,
        transactionReference: 'INT-BANK-0001',
        allowAdvance: true,
        postNow: true,
        idempotencyKey: 'finance-duplicate-bank-reference',
      })
    ).status,
    409,
  );

  const managerReverse = await fetch(`${base}/api/v1/payments/${finalBody.data._id}/reverse`, {
    method: 'POST',
    headers: authorization(manager._id),
    body: JSON.stringify({
      reason: 'Manager should not reverse',
      idempotencyKey: 'reverse-forbidden-1',
    }),
  });
  assert.equal(managerReverse.status, 403);
  const reverseInput = {
    reason: 'Bank transfer was recalled',
    idempotencyKey: 'reverse-final-payment-1',
  };
  const reverseRequest = () =>
    fetch(`${base}/api/v1/payments/${finalBody.data._id}/reverse`, {
      method: 'POST',
      headers: authorization(admin._id),
      body: JSON.stringify(reverseInput),
    });
  assert.equal((await reverseRequest()).status, 200);
  assert.equal((await reverseRequest()).status, 200);
  assert.equal((await getInvoiceBalance(invoice._id)).currentAmountDueMinor, 125);

  const ownerReceipt = await fetch(
    `${base}/api/v1/payments/${partialBody.data._id}/receipt?format=pdf`,
    {
      headers: authorization(owners[0]._id),
    },
  );
  assert.equal(ownerReceipt.status, 200);
  assert.equal(ownerReceipt.headers.get('content-type'), 'application/pdf');
  assert.ok((await ownerReceipt.arrayBuffer()).byteLength > 100);
  assert.equal(
    (
      await fetch(`${base}/api/v1/payments/${partialBody.data._id}`, {
        headers: authorization(owners[1]._id),
      })
    ).status,
    404,
  );

  const sourceOrder = await Order.findOne({ shopId: shop._id });
  assert.ok(sourceOrder);
  const collectionOrder = await Order.create({
    reference: 'ORD-FINANCE-COLLECTION',
    shopId: shop._id,
    submittedBy: owners[0]._id,
    items: sourceOrder.items.map((item) => item.toObject()),
    deliveryAddressSnapshot: sourceOrder.deliveryAddressSnapshot,
    contactSnapshot: sourceOrder.contactSnapshot,
    requestedPaymentMethod: PaymentMethod.CASH,
    estimatedSubtotalMinor: 50,
    estimatedDiscountMinor: 0,
    estimatedDeliveryChargeMinor: 0,
    estimatedTotalMinor: 50,
    status: 'OUT_FOR_DELIVERY',
    statusHistory: [{ to: 'OUT_FOR_DELIVERY', actorId: manager._id, at: new Date() }],
    version: 0,
  });
  const sourceItem = invoice.items[0]!;
  const collectionInvoice = await Invoice.create({
    reference: 'INV-FINANCE-COLLECTION',
    orderId: collectionOrder._id,
    shopId: shop._id,
    supplierSnapshot: { name: 'MedSupply B2B' },
    shopSnapshot: { reference: shop.reference, name: shop.name, phone: shop.primaryPhone },
    orderSnapshot: { reference: collectionOrder.reference },
    deliveryAddressSnapshot: sourceOrder.deliveryAddressSnapshot,
    items: [
      {
        medicineId: sourceItem.medicineId,
        medicineSnapshot: sourceItem.medicineSnapshot,
        batchId: sourceItem.batchId,
        batchNumber: sourceItem.batchNumber,
        expiryDate: sourceItem.expiryDate,
        quantity: 1,
        unitPriceMinor: 50,
        discountMinor: 0,
        lineTotalMinor: 50,
      },
    ],
    subtotalMinor: 50,
    orderDiscountMinor: 0,
    deliveryChargeMinor: 0,
    taxMinor: 0,
    previousBalanceMinor: 125,
    grandTotalMinor: 50,
    amountPaidMinor: 0,
    amountDueMinor: 50,
    totalOutstandingMinor: 175,
    paymentTermsDays: 0,
    invoiceDate: new Date(Date.now() - 2 * 86_400_000),
    dueDate: new Date(Date.now() - 86_400_000),
    issuedBy: admin._id,
    issuedAt: new Date(Date.now() - 2 * 86_400_000),
  });
  const ledgerSession = await mongoose.startSession();
  try {
    await ledgerSession.withTransaction(async () => {
      await postInvoiceCharge(
        collectionInvoice,
        { _id: admin._id, role: UserRole.ADMIN },
        ledgerSession,
      );
    });
  } finally {
    await ledgerSession.endSession();
  }
  const collectionPackage = await Package.create({
    reference: 'PKG-FINANCE-COLLECTION',
    orderId: collectionOrder._id,
    invoiceId: collectionInvoice._id,
    packageCount: 1,
    packedBy: manager._id,
    packedAt: new Date(),
    handoverStatus: 'HANDED_OVER',
    barcode: 'PKG:FINANCE:COLLECTION',
  });
  const collectionDelivery = await Delivery.create({
    reference: 'DEL-FINANCE-COLLECTION',
    orderId: collectionOrder._id,
    packageId: collectionPackage._id,
    invoiceId: collectionInvoice._id,
    shopId: shop._id,
    addressSnapshot: sourceOrder.deliveryAddressSnapshot,
    contactSnapshot: sourceOrder.contactSnapshot,
    status: 'ARRIVED',
    assignedTo: driver._id,
    proofRequirements: [],
    history: [
      { to: 'ARRIVED', actorId: driver._id, actorRole: UserRole.DELIVERY_PERSON, at: new Date() },
    ],
    version: 0,
  });
  const onePixelPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const completion = {
    version: 0,
    idempotencyKey: 'finance-delivery-complete-1',
    receiverName: 'Account Receiver',
    receiverPhone: '01700000001',
    deliveredPackageCount: 1,
    noPaymentCollected: false,
    collectedAmountMinor: 25,
    collectionMethod: PaymentMethod.CASH,
    paymentProof: { fileName: 'cash-proof.png', mimeType: 'image/png', base64Data: onePixelPng },
  };
  const complete = () =>
    fetch(`${base}/api/v1/deliveries/${collectionDelivery._id}/complete`, {
      method: 'POST',
      headers: authorization(driver._id),
      body: JSON.stringify(completion),
    });
  const completed = await complete();
  const completedBody = (await completed.json()) as {
    meta: { payment?: { reference: string; status: string }; idempotentReplay: boolean };
  };
  assert.equal(completed.status, 200);
  assert.equal(completedBody.meta.payment?.status, 'PENDING');
  assert.match(completedBody.meta.payment?.reference ?? '', /^PAY-\d{4}-\d{6}$/);
  assert.equal((await complete()).status, 200);
  assert.equal(await Payment.countDocuments({ deliveryId: collectionDelivery._id }), 1);
  assert.equal(await PaymentAttachment.countDocuments(), 1);
  const collectionPayment = await Payment.findOne({ deliveryId: collectionDelivery._id });
  assert.ok(collectionPayment);
  const postedCollection = await fetch(`${base}/api/v1/payments/${collectionPayment._id}/post`, {
    method: 'POST',
    headers: authorization(manager._id),
    body: JSON.stringify({ idempotencyKey: 'post-delivery-collection-1', allowAdvance: false }),
  });
  assert.equal(postedCollection.status, 200);
  assert.equal((await getInvoiceBalance(collectionInvoice._id)).currentAmountDueMinor, 25);
  const handedOver = await fetch(`${base}/api/v1/payments/${collectionPayment._id}/handover`, {
    method: 'POST',
    headers: authorization(driver._id),
    body: JSON.stringify({ idempotencyKey: 'cash-handover-1' }),
  });
  assert.equal(handedOver.status, 200);

  const summary = await fetch(`${base}/api/v1/finance/shops/${shop._id}/summary`, {
    headers: authorization(manager._id),
  });
  const summaryBody = (await summary.json()) as {
    data: { outstandingMinor: number; overdueMinor: number; creditBlocked: boolean };
  };
  assert.equal(summary.status, 200);
  assert.equal(summaryBody.data.outstandingMinor, 150);
  assert.equal(summaryBody.data.overdueMinor, 25);
  assert.equal(summaryBody.data.creditBlocked, true);
  const statement = await fetch(
    `${base}/api/v1/finance/shops/${shop._id}/statement?from=2026-01-01&to=2026-12-31`,
    { headers: authorization(manager._id) },
  );
  const statementBody = (await statement.json()) as {
    data: { openingBalanceMinor: number; closingBalanceMinor: number; rows: unknown[] };
  };
  assert.equal(statement.status, 200);
  assert.equal(statementBody.data.openingBalanceMinor, 0);
  assert.equal(statementBody.data.closingBalanceMinor, 150);
  assert.ok(statementBody.data.rows.length >= 6);
  for (const transaction of await LedgerTransaction.find()) {
    const debit = transaction.entries.reduce((sum, entry) => sum + entry.debitMinor, 0);
    const credit = transaction.entries.reduce((sum, entry) => sum + entry.creditMinor, 0);
    assert.equal(debit, credit);
    assert.ok(Number.isSafeInteger(debit));
  }
  await assert.rejects(
    Payment.updateOne({ _id: partialBody.data._id }, { $set: { amountMinor: 1 } }),
    /financial actions/i,
  );
  await assert.rejects(LedgerTransaction.deleteOne({}), /append-only/i);
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  await memoryReplica?.stop();
});
