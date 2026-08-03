import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MedicineClassification, OrderStatus, ShopStatus, UserRole } from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { CreditReservation, CreditReservationStatus } from '../models/CreditReservation';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { Order } from '../models/Order';
import { Shop } from '../models/Shop';
import { StockMovement } from '../models/StockMovement';
import { receiveStock, reserveFefo } from './inventoryService';
import { reserveCredit } from './creditReservationService';
import { decideCancellation } from './cancellationService';

/**
 * Cancelling an order releases what the order was holding.
 *
 * This is the half of B5 that a status change alone would not have delivered.
 * The endpoint that existed stamped a timestamp and announced that the order
 * had been cancelled; even if it had also set the status, the shop's credit
 * would have stayed reserved and the stock would have stayed allocated to a
 * batch nobody was ever going to pick — so a customer who cancelled twice would
 * find their limit exhausted by orders that no longer exist, and the warehouse
 * would find stock missing that is sitting on the shelf.
 */

let memoryReplica: MongoMemoryReplSet | undefined;

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const storekeeper = { _id: new Types.ObjectId(), role: UserRole.STOREKEEPER };
const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };

before(async () => {
  const uri = process.env.MONGODB_TEST_URI
    ? process.env.MONGODB_TEST_URI
    : await (async () => {
        memoryReplica = await MongoMemoryReplSet.create({
          replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
        });
        return memoryReplica.getUri('medsupply_cancellation');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([
    AuditLog.init(),
    CreditReservation.init(),
    Medicine.init(),
    MedicineBatch.init(),
    Order.init(),
    Shop.init(),
    StockMovement.init(),
  ]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await memoryReplica?.stop();
});

beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}),
    CreditReservation.deleteMany({}),
    StockMovement.deleteMany({}),
    MedicineBatch.deleteMany({}),
    Medicine.deleteMany({}),
    Shop.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

let sequence = 0;

async function fixture(options: { status?: OrderStatus; quantity?: number } = {}) {
  sequence += 1;
  const quantity = options.quantity ?? 20;

  const shop = await Shop.create({
    reference: `SHP-C-${sequence}`,
    name: `Cancellation Shop ${sequence}`,
    ownerIds: [owner._id],
    primaryPhone: `0171000${String(1000 + sequence).slice(-4)}`,
    status: ShopStatus.ACTIVE,
    creditLimit: 100_000_00,
    paymentTermsDays: 30,
    deliveryAddresses: [
      {
        _id: new Types.ObjectId(),
        label: 'Shop',
        line1: '1 Test Road',
        city: 'Dhaka',
        district: 'Dhaka',
        isDefault: true,
      },
    ],
  });

  const medicine = await Medicine.create({
    reference: `MED-C-${sequence}`,
    sku: `C-${sequence}`,
    brandName: 'CancelMed',
    genericName: 'Generic',
    manufacturer: 'Maker',
    strength: '10mg',
    dosageForm: 'Tablet',
    packSize: '10',
    unit: 'box',
    category: 'Test',
    barcode: `88012345678${sequence % 10}`,
    costPriceMinor: 100,
    defaultSellingPriceMinor: 200,
    minimumOrderQuantity: 1,
    classification: MedicineClassification.OTC,
    createdBy: manager._id,
  });

  await receiveStock(
    {
      medicineId: String(medicine._id),
      batchNumber: `C-${sequence}-B1`,
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2028-01-01'),
      costPriceMinor: 100,
      quantity: 100,
      warehouseLocation: 'A1',
    },
    storekeeper,
  );

  const order = await Order.create({
    reference: `ORD-C-${sequence}`,
    shopId: shop._id,
    submittedBy: owner._id,
    status: options.status ?? OrderStatus.APPROVED,
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
        requestedQuantity: quantity,
        estimatedUnitPriceMinor: 200,
        estimatedDiscountMinor: 0,
        estimatedLineTotalMinor: quantity * 200,
        availableStockSnapshot: 100,
      },
    ],
    estimatedTotalMinor: quantity * 200,
    cancellationRequestedAt: new Date(),
    cancellationReason: 'Ordered the wrong strength',
    version: 0,
  });

  await reserveFefo(
    String(medicine._id),
    quantity,
    `order:${order._id}`,
    'Order',
    String(order._id),
    storekeeper,
  );

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await reserveCredit(
        {
          orderId: order._id,
          shopId: shop._id,
          approvedExposureMinor: quantity * 200,
          decisionSnapshot: {
            creditLimitMinor: shop.creditLimit,
            outstandingMinor: 0,
            reservedMinor: 0,
            overdueMinor: 0,
            availableCreditMinor: shop.creditLimit,
            proposedExposureMinor: quantity * 200,
            blockedReasons: [],
            capturedAt: new Date(),
          },
        },
        manager,
        session,
      );
    });
  } finally {
    await session.endSession();
  }

  return { shop, medicine, order, quantity };
}

test('cancelling returns the reserved stock to available', async () => {
  const { medicine, order, quantity } = await fixture();

  const before = await MedicineBatch.findOne({ medicineId: medicine._id });
  assert.equal(before?.quantities.reserved, quantity);
  assert.equal(before?.quantities.available, 100 - quantity);

  const result = await decideCancellation(
    String(order._id),
    { approve: true, reason: 'Shop ordered the wrong strength', version: 0 },
    manager,
  );

  assert.equal(result.releasedStockUnits, quantity);
  const after = await MedicineBatch.findOne({ medicineId: medicine._id });
  assert.equal(after?.quantities.reserved, 0);
  assert.equal(after?.quantities.available, 100, 'every unit is back on the shelf');
});

test('cancelling releases the credit the order was holding', async () => {
  const { order, quantity } = await fixture();

  const result = await decideCancellation(
    String(order._id),
    { approve: true, reason: 'Duplicate order raised by mistake', version: 0 },
    manager,
  );

  assert.equal(result.releasedCreditMinor, quantity * 200);
  const reservation = await CreditReservation.findOne({ orderId: order._id });
  assert.equal(reservation?.status, CreditReservationStatus.RELEASED);
});

test('the order actually reaches CANCELLED', async () => {
  const { order } = await fixture();
  await decideCancellation(
    String(order._id),
    { approve: true, reason: 'No longer required', version: 0 },
    manager,
  );
  // Nothing in the system set this status before. `ORDER_STATE_MACHINE.md` had
  // documented the transition since phase 4 of the original build.
  const stored = await Order.findById(order._id);
  assert.equal(stored?.status, OrderStatus.CANCELLED);
});

test('refusing leaves the order alive and clears the request', async () => {
  const { order, medicine, quantity } = await fixture();

  await decideCancellation(
    String(order._id),
    { approve: false, reason: 'Already picked and packed for dispatch today', version: 0 },
    manager,
  );

  const stored = await Order.findById(order._id);
  assert.equal(stored?.status, OrderStatus.APPROVED, 'the order carries on');
  assert.equal(stored?.cancellationRequestedAt, undefined, 'the request is answered');
  assert.equal(stored?.cancellationDecision, 'REFUSED');

  // Nothing was given back, because nothing was cancelled.
  const batch = await MedicineBatch.findOne({ medicineId: medicine._id });
  assert.equal(batch?.quantities.reserved, quantity);
  const reservation = await CreditReservation.findOne({ orderId: order._id });
  assert.equal(reservation?.status, CreditReservationStatus.ACTIVE);
});

test('a replayed cancellation does not release the same stock twice', async () => {
  const { medicine, order } = await fixture();

  await decideCancellation(
    String(order._id),
    { approve: true, reason: 'Cancelled at the shop’s request', version: 0 },
    manager,
  );
  const afterFirst = await MedicineBatch.findOne({ medicineId: medicine._id });

  const replay = await decideCancellation(
    String(order._id),
    { approve: true, reason: 'Cancelled at the shop’s request', version: 99 },
    manager,
  );

  assert.equal(replay.idempotentReplay, true);
  const afterSecond = await MedicineBatch.findOne({ medicineId: medicine._id });
  assert.equal(
    afterSecond?.quantities.available,
    afterFirst?.quantities.available,
    'a second cancellation must not invent stock',
  );
});

test('a storekeeper cannot decide a cancellation', async () => {
  const { order } = await fixture();
  await assert.rejects(
    () =>
      decideCancellation(
        String(order._id),
        { approve: true, reason: 'Trying it on', version: 0 },
        storekeeper,
      ),
    (error: Error & { code?: string; statusCode?: number }) => {
      assert.equal(error.code, 'FORBIDDEN');
      assert.equal(error.statusCode, 403);
      return true;
    },
  );
});

test('an order that has been packed can no longer be cancelled', async () => {
  const { order } = await fixture({ status: OrderStatus.PACKED });
  await assert.rejects(
    () =>
      decideCancellation(
        String(order._id),
        { approve: true, reason: 'Too late in the day', version: 0 },
        manager,
      ),
    (error: Error & { code?: string }) => {
      // Past packing an invoice exists and stock has left the shelf; the
      // correct instrument is a return, which credits the invoice.
      assert.equal(error.code, 'CANCELLATION_NOT_ALLOWED');
      return true;
    },
  );
});

test('an order with no request cannot be cancelled behind the shop’s back', async () => {
  const { order } = await fixture();
  await Order.updateOne({ _id: order._id }, { $unset: { cancellationRequestedAt: 1 } });

  await assert.rejects(
    () =>
      decideCancellation(
        String(order._id),
        { approve: true, reason: 'Cancelling this one', version: 0 },
        manager,
      ),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'NO_CANCELLATION_REQUEST');
      return true;
    },
  );
});

test('a stale version is refused rather than overwriting a concurrent change', async () => {
  const { order } = await fixture();
  await assert.rejects(
    () =>
      decideCancellation(
        String(order._id),
        { approve: true, reason: 'Deciding on a stale view', version: 7 },
        manager,
      ),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'STALE_VERSION');
      return true;
    },
  );
});

test('the decision is audited with what it gave back', async () => {
  const { order, quantity } = await fixture();
  await decideCancellation(
    String(order._id),
    { approve: true, reason: 'Shop closed unexpectedly', version: 0 },
    manager,
  );

  const record = await AuditLog.findOne({ entityId: order._id, action: 'ORDER_CANCELLED' });
  assert.ok(record, 'a cancellation is a privileged action and must be recorded');
  assert.equal(record?.actorId?.toString(), manager._id.toString());
  const after = record?.after as { releasedCreditMinor: number; releasedStockUnits: number };
  assert.equal(after.releasedCreditMinor, quantity * 200);
  assert.equal(after.releasedStockUnits, quantity);
});
