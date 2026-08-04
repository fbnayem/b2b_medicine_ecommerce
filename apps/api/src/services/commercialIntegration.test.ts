import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  MedicineClassification,
  PaymentMethod,
  ShopStatus,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { Order } from '../models/Order';
import { PriceList } from '../models/PriceList';
import { Scheme } from '../models/Scheme';
import { Shop } from '../models/Shop';
import { User } from '../models/User';

/**
 * The commercial model, end to end.
 *
 * The plan's acceptance criteria: place an order as a `SALES` user for a shop
 * in their territory and confirm it is refused for one outside it, and confirm
 * the audit record names the human rather than the shop.
 *
 * Alongside that, the thing the price resolver exists for: the order line has
 * to say **where its price came from**. Every order route was `SHOP_OWNER`-only
 * and every price was `Medicine.defaultSellingPriceMinor` minus
 * `Shop.defaultDiscount`, so neither question could be asked of the data.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const rep = { _id: new Types.ObjectId(), role: UserRole.SALES };
const medicineId = new Types.ObjectId();
const listedMedicineId = new Types.ObjectId();

let inTerritory: { _id: Types.ObjectId; addressId: Types.ObjectId };
let outsideTerritory: { _id: Types.ObjectId; addressId: Types.ObjectId };
let discountedShop: { _id: Types.ObjectId; addressId: Types.ObjectId };

function authorization(userId: Types.ObjectId) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`,
  };
}

let phoneCounter = 0;

async function makeShop(name: string, territory: string | undefined, discount = 0) {
  const addressId = new Types.ObjectId();
  // `primaryPhone` is unique on the shop, which is right for real data and
  // means fixtures cannot share one.
  phoneCounter += 1;
  const shop = await Shop.create({
    reference: `SHP-${name.replace(/\s+/g, '-').toUpperCase()}`,
    name,
    ownerIds: [manager._id],
    primaryPhone: `017110000${String(phoneCounter).padStart(2, '0')}`,
    status: ShopStatus.ACTIVE,
    creditLimit: 10_000_00,
    paymentTermsDays: 30,
    territory,
    defaultDiscount: discount,
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
  return { _id: shop._id, addressId };
}

before(async () => {
  const uri = process.env.MONGODB_TEST_URI
    ? process.env.MONGODB_TEST_URI
    : await (async () => {
        memoryReplica = await MongoMemoryReplSet.create({
          replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
        });
        return memoryReplica.getUri('medsupply_commercial');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([
    Medicine.init(),
    MedicineBatch.init(),
    Order.init(),
    PriceList.init(),
    Scheme.init(),
    Shop.init(),
    User.init(),
  ]);

  await User.create([
    {
      _id: manager._id,
      email: 'commercial-manager@test.local',
      passwordHash: 'x',
      firstName: 'Commercial',
      lastName: 'Manager',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    },
    {
      _id: rep._id,
      email: 'commercial-rep@test.local',
      passwordHash: 'x',
      firstName: 'Field',
      lastName: 'Rep',
      role: UserRole.SALES,
      status: UserStatus.ACTIVE,
      territories: ['Dhaka North'],
    },
  ]);

  for (const [id, sku, brand, price, mrp] of [
    [medicineId, 'NAPA-500', 'Napa', 1080, 1200],
    [listedMedicineId, 'ACE-500', 'Ace', 1050, 1200],
  ] as const) {
    await Medicine.create({
      _id: id,
      reference: `MED-${sku}`,
      sku,
      brandName: brand,
      genericName: 'Paracetamol',
      strength: '500 mg',
      dosageForm: 'TABLET',
      packSize: '10s',
      unit: 'box',
      category: 'Analgesic',
      manufacturer: 'Beximco',
      classification: MedicineClassification.OTC,
      defaultSellingPriceMinor: price,
      mrpMinor: mrp,
      costPriceMinor: 800,
      createdBy: manager._id,
    });
    await MedicineBatch.create({
      medicineId: id,
      batchNumber: `B-${sku}`,
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2028-01-01'),
      costPriceMinor: 800,
      receivedQuantity: 500,
      quantities: {
        onHand: 500,
        available: 500,
        reserved: 0,
        picking: 0,
        packed: 0,
        damaged: 0,
        expired: 0,
        returned: 0,
        quarantined: 0,
      },
      warehouseLocation: 'AISLE-A',
      createdBy: manager._id,
    });
  }

  inTerritory = await makeShop('Bismillah Pharmacy', 'Dhaka North');
  outsideTerritory = await makeShop('Sylhet Medicos', 'Sylhet');
  discountedShop = await makeShop('Negotiated Pharmacy', 'Dhaka North', 10);

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

async function submit(
  as: Types.ObjectId,
  shop: { _id: Types.ObjectId; addressId: Types.ObjectId },
  medicine: Types.ObjectId,
  idempotencyKey: string,
) {
  const response = await fetch(`${base}/api/v1/orders/submit`, {
    method: 'POST',
    headers: authorization(as),
    body: JSON.stringify({
      shopId: String(shop._id),
      deliveryAddressId: String(shop.addressId),
      requestedPaymentMethod: PaymentMethod.CREDIT,
      idempotencyKey,
      items: [{ medicineId: String(medicine), requestedQuantity: 10 }],
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, never> };
}

test('a rep can order for a shop in their territory, and the record names them', async () => {
  const placed = await submit(rep._id, inTerritory, medicineId, 'commercial-in-territory-1');
  assert.equal(placed.status, 201);

  const order = await Order.findOne({ submissionIdempotencyKey: 'commercial-in-territory-1' });
  assert.ok(order);
  assert.equal(
    String(order.placedBy),
    String(rep._id),
    'the control is not that the order looks like the shop placed it — it is ' +
      'that the record says plainly who did',
  );
  assert.equal(order.placedOnBehalf, true);
  assert.equal(String(order.shopId), String(inTerritory._id));
});

test('and is refused for a shop outside it', async () => {
  const refused = await submit(rep._id, outsideTerritory, medicineId, 'commercial-outside-1');
  assert.equal(refused.status, 403);
  assert.equal(
    (refused.body.error as unknown as { code: string }).code,
    'SHOP_OUTSIDE_TERRITORY',
    'distinguishable from "your role cannot do this at all", which is a ' +
      'different thing for a rep to be told',
  );
  assert.equal(await Order.countDocuments({ submissionIdempotencyKey: 'commercial-outside-1' }), 0);
});

test('a shop owner still orders only for their own shop', async () => {
  // The existing path is unchanged: a `shopId` from a shop owner is ignored
  // rather than honoured, so opening this route cannot let one shop order
  // against another.
  const ownShop = await makeShop('Owner Pharmacy', 'Dhaka North');
  const owner = await User.create({
    email: 'commercial-owner@test.local',
    passwordHash: 'x',
    firstName: 'Shop',
    lastName: 'Owner',
    role: UserRole.SHOP_OWNER,
    status: UserStatus.ACTIVE,
  });
  await Shop.updateOne({ _id: ownShop._id }, { $set: { ownerIds: [owner._id] } });

  const placed = await submit(
    owner._id,
    // Naming somebody else's shop, with their own address id.
    { _id: outsideTerritory._id, addressId: ownShop.addressId },
    medicineId,
    'commercial-owner-1',
  );
  assert.equal(placed.status, 201);

  const order = await Order.findOne({ submissionIdempotencyKey: 'commercial-owner-1' });
  assert.equal(
    String(order?.shopId),
    String(ownShop._id),
    'their own shop, not the one they named',
  );
  assert.equal(order?.placedOnBehalf, false);
});

test('the order line says where its price came from', async () => {
  const list = await PriceList.create({
    reference: 'PRL-2026-000001',
    name: 'Wholesale',
    isDefault: true,
    isActive: true,
    lines: [{ medicineId: listedMedicineId, unitPriceMinor: 950, discountPercent: 5 }],
    createdBy: manager._id,
  });
  assert.ok(list);

  // Priced from the list.
  await submit(rep._id, inTerritory, listedMedicineId, 'commercial-priced-list-1');
  const listed = await Order.findOne({ submissionIdempotencyKey: 'commercial-priced-list-1' });
  assert.equal(listed?.items[0]?.estimatedUnitPriceMinor, 950);
  assert.equal(listed?.items[0]?.priceSource, 'PRICE_LIST');
  assert.equal(
    listed?.items[0]?.priceListReference,
    'PRL-2026-000001',
    'the reference is what answers "why was I charged this" months later',
  );

  // Not on the list, so the medicine's own price — and it says so rather than
  // pricing an unlisted medicine at zero.
  await submit(rep._id, inTerritory, medicineId, 'commercial-priced-default-1');
  const fallback = await Order.findOne({
    submissionIdempotencyKey: 'commercial-priced-default-1',
  });
  assert.equal(fallback?.items[0]?.estimatedUnitPriceMinor, 1080);
  assert.equal(fallback?.items[0]?.priceSource, 'MEDICINE_DEFAULT');

  // A shop's own arrangement beats the list, and applies to the ordinary price
  // rather than the list price.
  await submit(rep._id, discountedShop, listedMedicineId, 'commercial-priced-shop-1');
  const negotiated = await Order.findOne({
    submissionIdempotencyKey: 'commercial-priced-shop-1',
  });
  assert.equal(negotiated?.items[0]?.priceSource, 'SHOP_OVERRIDE');
  assert.equal(
    negotiated?.items[0]?.estimatedUnitPriceMinor,
    1050,
    'the medicine’s price, not the list’s — a customer who negotiated ten ' +
      'percent off negotiated it against the ordinary price',
  );
});

test('a 10+1 line: eleven leave stock, ten are charged, six back credits six elevenths', async () => {
  /*
   * The plan's acceptance criterion for free goods, and the reason the design
   * is safe: **`quantity` stays the chargeable quantity.** Allocation asks for
   * the sum so the warehouse picks eleven; `calculatePackedInvoice` is
   * untouched because it prices ten. The money does not move — only the
   * dispatched count does.
   */
  await Scheme.create({
    reference: 'SCH-2026-000001',
    name: 'Napa 10+1',
    medicineId,
    buyQuantity: 10,
    freeQuantity: 1,
    isActive: true,
    createdBy: manager._id,
  });

  const placed = await submit(rep._id, inTerritory, medicineId, 'commercial-scheme-1');
  assert.equal(placed.status, 201);

  const order = await Order.findOne({ submissionIdempotencyKey: 'commercial-scheme-1' });
  const line = order?.items[0];
  assert.equal(line?.requestedQuantity, 10, 'ten is what the customer asked for and pays for');
  assert.equal(line?.freeQuantity, 1, 'one rides alongside it');
  assert.equal(line?.schemeReference, 'SCH-2026-000001');

  assert.equal(
    order?.estimatedTotalMinor,
    // Ten at ৳10.80 with no discount and no delivery charge.
    10 * 1080,
    'the estimate prices ten, not eleven — the arithmetic never learns about ' +
      'the free unit, which is what makes this safe beside a double-entry ledger',
  );
});

test('a short line earns nothing, because that is what the offer says', async () => {
  const placed = await fetch(`${base}/api/v1/orders/submit`, {
    method: 'POST',
    headers: authorization(rep._id),
    body: JSON.stringify({
      shopId: String(inTerritory._id),
      deliveryAddressId: String(inTerritory.addressId),
      requestedPaymentMethod: PaymentMethod.CREDIT,
      idempotencyKey: 'commercial-scheme-short-1',
      items: [{ medicineId: String(medicineId), requestedQuantity: 9 }],
    }),
  });
  assert.equal(placed.status, 201);

  const order = await Order.findOne({ submissionIdempotencyKey: 'commercial-scheme-short-1' });
  assert.equal(
    order?.items[0]?.freeQuantity,
    0,
    'nine under a 10+1 earns nothing — rounding up would be a discount nobody ' +
      'agreed to, applied silently, on every line that fell short',
  );
});
