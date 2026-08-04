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
    /*
     * Deliberately outside the counter's series. A fixture that hand-writes
     * `SCH-2026-000001` claims the first reference `nextReference` will issue,
     * so the first scheme created through the API collides on the unique index
     * — which is how this fixture and the API test met.
     */
    reference: 'SCH-2026-009001',
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
  assert.equal(line?.schemeReference, 'SCH-2026-009001');

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

/*
 * ── Setting the terms ───────────────────────────────────────────────────────
 *
 * The models above were written in the same phase as the resolver, and nothing
 * could create either of them: every fixture in this file reaches past the API
 * and writes the document directly, which is exactly how the gap survived. A
 * price list nobody can edit prices nothing.
 */

async function api(
  method: string,
  path: string,
  as: Types.ObjectId,
  body?: Record<string, unknown>,
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: authorization(as),
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: (await response.json()) as Record<string, never> };
}

function payload<T>(result: { body: Record<string, never> }): T {
  return result.body.data as unknown as T;
}

test('a manager creates a price list and reads it back with its lines named', async () => {
  const created = await api('POST', '/api/v1/pricing/price-lists', manager._id, {
    name: 'Chain retail',
    description: 'Negotiated with the pharmacy chain',
    lines: [
      { medicineId: String(listedMedicineId), unitPriceMinor: 990, discountPercent: 2 },
      { medicineId: String(medicineId), unitPriceMinor: 1040 },
    ],
  });
  assert.equal(created.status, 201);

  const id = String(payload<{ _id: string }>(created)._id);
  assert.match(
    payload<{ reference: string }>(created).reference,
    /^PRC-\d{4}-\d{6}$/,
    'a reference a human can quote, from the same counter as every other one',
  );

  const detail = await api('GET', `/api/v1/pricing/price-lists/${id}`, manager._id);
  assert.equal(detail.status, 200);
  const list = payload<{ lines: Array<{ medicineBrandName?: string; medicineSku?: string }> }>(
    detail,
  );
  assert.equal(list.lines.length, 2);
  assert.equal(
    list.lines[0]?.medicineBrandName,
    'Ace 500 mg',
    'the sheet names the medicine — AGENTS.md forbids showing the id, and one ' +
      'request per row is what a forty-line list would otherwise cost',
  );
  assert.equal(list.lines[0]?.medicineSku, 'ACE-500');
});

test('the list refuses two prices for one medicine', async () => {
  /*
   * `resolvePriceFrom` takes the first matching line, so a duplicate is not an
   * error anybody would see — it is a second price that silently never applies,
   * and which of the two wins depends on the order they were typed.
   */
  const refused = await api('POST', '/api/v1/pricing/price-lists', manager._id, {
    name: 'Contradictory',
    lines: [
      { medicineId: String(medicineId), unitPriceMinor: 1000 },
      { medicineId: String(medicineId), unitPriceMinor: 900 },
    ],
  });
  assert.equal(refused.status, 400);
});

test('a list cannot price a medicine that does not exist', async () => {
  // A line against a mistyped id prices nothing, and the resolver falls through
  // to the medicine's own price — so the customer is quietly charged the wrong
  // amount rather than seeing an error.
  const refused = await api('POST', '/api/v1/pricing/price-lists', manager._id, {
    name: 'Ghost',
    lines: [{ medicineId: String(new Types.ObjectId()), unitPriceMinor: 1000 }],
  });
  assert.equal(refused.status, 404);
  assert.equal((refused.body.error as unknown as { code: string }).code, 'MEDICINE_NOT_FOUND');
});

test('making a list the default moves the flag rather than adding a second one', async () => {
  const listing = await api('GET', '/api/v1/pricing/price-lists', manager._id);
  assert.equal(listing.status, 200);
  const before = payload<{ items: Array<{ _id: string; name: string; version: number }> }>(listing);
  const chain = before.items.find((row) => row.name === 'Chain retail');
  assert.ok(chain);

  const updated = await api('PATCH', `/api/v1/pricing/price-lists/${chain._id}`, manager._id, {
    version: chain.version,
    isDefault: true,
  });
  assert.equal(updated.status, 200);

  assert.equal(
    await PriceList.countDocuments({ isDefault: true }),
    1,
    'two defaults would make "which list prices this shop" ambiguous for every ' +
      'shop assigned none',
  );
  assert.equal(String((await PriceList.findOne({ isDefault: true }))?._id), String(chain._id));
});

test('a stale editor is refused rather than silently overwriting the sheet', async () => {
  const listing = await api('GET', '/api/v1/pricing/price-lists', manager._id);
  const chain = payload<{ items: Array<{ _id: string; name: string; version: number }> }>(
    listing,
  ).items.find((row) => row.name === 'Chain retail');
  assert.ok(chain);

  const stale = await api('PATCH', `/api/v1/pricing/price-lists/${chain._id}`, manager._id, {
    version: chain.version - 1,
    name: 'Overwritten',
  });
  assert.equal(stale.status, 409);
  assert.equal((stale.body.error as unknown as { code: string }).code, 'VERSION_CONFLICT');
});

test('a rep reads the terms and cannot set them', async () => {
  // Quoting a customer means knowing what they pay; a rep who has to ask
  // somebody else quotes from memory. Writing stays with management, because a
  // price list is the revenue of every order placed after it.
  assert.equal((await api('GET', '/api/v1/pricing/price-lists', rep._id)).status, 200);
  assert.equal((await api('GET', '/api/v1/pricing/schemes', rep._id)).status, 200);

  const refused = await api('POST', '/api/v1/pricing/price-lists', rep._id, {
    name: 'Rep list',
    lines: [],
  });
  assert.equal(refused.status, 403);
});

test('a scheme created through the API prices the next order and not the last one', async () => {
  const created = await api('POST', '/api/v1/pricing/schemes', manager._id, {
    name: 'Ace 20+3',
    medicineId: String(listedMedicineId),
    buyQuantity: 20,
    freeQuantity: 3,
  });
  assert.equal(created.status, 201);
  const scheme = payload<{ _id: string; reference: string; version: number }>(created);

  const detail = await api('GET', `/api/v1/pricing/schemes/${scheme._id}`, manager._id);
  assert.equal(detail.status, 200);
  assert.equal(
    payload<{ medicineBrandName?: string }>(detail).medicineBrandName,
    'Ace 500 mg',
    'the offer names the medicine it runs on',
  );

  const placed = await submitQuantity(listedMedicineId, 20, 'commercial-api-scheme-1');
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const withScheme = await Order.findOne({ submissionIdempotencyKey: 'commercial-api-scheme-1' });
  assert.equal(withScheme?.items[0]?.freeQuantity, 3);
  assert.equal(withScheme?.items[0]?.schemeReference, scheme.reference);

  // Ending the offer stops the next order rather than restating that one.
  const ended = await api('PATCH', `/api/v1/pricing/schemes/${scheme._id}`, manager._id, {
    version: scheme.version,
    isActive: false,
  });
  assert.equal(ended.status, 200);

  const after = await submitQuantity(listedMedicineId, 20, 'commercial-api-scheme-2');
  assert.equal(after.status, 201);
  const later = await Order.findOne({ submissionIdempotencyKey: 'commercial-api-scheme-2' });
  assert.equal(later?.items[0]?.freeQuantity, 0);

  const unchanged = await Order.findOne({ submissionIdempotencyKey: 'commercial-api-scheme-1' });
  assert.equal(
    unchanged?.items[0]?.freeQuantity,
    3,
    'the order already placed keeps the terms it was given',
  );
});

async function submitQuantity(medicine: Types.ObjectId, quantity: number, key: string) {
  const response = await fetch(`${base}/api/v1/orders/submit`, {
    method: 'POST',
    headers: authorization(rep._id),
    body: JSON.stringify({
      shopId: String(inTerritory._id),
      deliveryAddressId: String(inTerritory.addressId),
      requestedPaymentMethod: PaymentMethod.CREDIT,
      idempotencyKey: key,
      items: [{ medicineId: String(medicine), requestedQuantity: quantity }],
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test('a shop can be assigned a price list, and not an inactive one', async () => {
  const created = await api('POST', '/api/v1/pricing/price-lists', manager._id, {
    name: 'Retired list',
    isActive: false,
    lines: [{ medicineId: String(medicineId), unitPriceMinor: 700 }],
  });
  const retired = payload<{ _id: string }>(created);

  // Editing a customer record is administration, not management — the same
  // roles that could always edit a shop.
  const admin = await User.create({
    email: 'commercial-admin@test.local',
    passwordHash: 'x',
    firstName: 'Commercial',
    lastName: 'Admin',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
  });

  const refused = await fetch(`${base}/api/v1/shops/${inTerritory._id}`, {
    method: 'PATCH',
    headers: authorization(admin._id),
    body: JSON.stringify({ priceListId: retired._id }),
  });
  assert.equal(
    refused.status,
    409,
    'an inactive list assigned to a customer is a price that silently does not ' +
      'apply — the resolver skips it and charges them from the default instead',
  );

  const live = await PriceList.findOne({ name: 'Chain retail' });
  const assigned = await fetch(`${base}/api/v1/shops/${inTerritory._id}`, {
    method: 'PATCH',
    headers: authorization(admin._id),
    body: JSON.stringify({ priceListId: String(live!._id) }),
  });
  assert.equal(assigned.status, 200);
  assert.equal(String((await Shop.findById(inTerritory._id))?.priceListId), String(live!._id));

  // And an empty string clears it rather than reaching Mongoose as a cast error.
  const cleared = await fetch(`${base}/api/v1/shops/${inTerritory._id}`, {
    method: 'PATCH',
    headers: authorization(admin._id),
    body: JSON.stringify({ priceListId: '' }),
  });
  assert.equal(cleared.status, 200);
  assert.equal((await Shop.findById(inTerritory._id))?.priceListId, null);
});

test('the quote a rep sees is the order the customer gets', async () => {
  /*
   * The property order entry rests on.
   *
   * A telesales operator reads a total to somebody on the phone before anything
   * is placed. If that figure came from the screen's own arithmetic it would be
   * the medicine's default price — not this customer's list, not the offer
   * running on the line — and the invoice would say something else. So the
   * quote runs the **same** `buildOrderSnapshot` the submission runs, and this
   * is the test that keeps them the same.
   */
  const quoted = await api('POST', '/api/v1/orders/quote', rep._id, {
    shopId: String(inTerritory._id),
    items: [{ medicineId: String(medicineId), requestedQuantity: 20 }],
  });
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));

  const quote = payload<{
    estimatedTotalMinor: number;
    items: Array<{ estimatedUnitPriceMinor: number; freeQuantity: number; priceSource: string }>;
  }>(quoted);

  assert.equal(await Order.countDocuments({ shopId: inTerritory._id, status: 'DRAFT' }), 0);

  const placed = await submitQuantity(medicineId, 20, 'commercial-quote-1');
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const order = await Order.findOne({ submissionIdempotencyKey: 'commercial-quote-1' });

  assert.equal(
    order?.estimatedTotalMinor,
    quote.estimatedTotalMinor,
    'the figure read out on the phone is the figure on the order',
  );
  assert.equal(order?.items[0]?.estimatedUnitPriceMinor, quote.items[0]?.estimatedUnitPriceMinor);
  assert.equal(
    order?.items[0]?.freeQuantity,
    quote.items[0]?.freeQuantity,
    'the free units are quoted too — a customer told about 10+1 and not given it ' +
      'is a complaint, and one they were not told about is margin given away',
  );
  assert.equal(order?.items[0]?.priceSource, quote.items[0]?.priceSource);
});

test('a rep cannot quote for a shop outside their territory', async () => {
  // The quote reaches the same `targetShop` the submission does, so it cannot
  // become a way to read another territory's prices without placing anything.
  const refused = await api('POST', '/api/v1/orders/quote', rep._id, {
    shopId: String(outsideTerritory._id),
    items: [{ medicineId: String(medicineId), requestedQuantity: 10 }],
  });
  assert.equal(refused.status, 403);
  assert.equal((refused.body.error as unknown as { code: string }).code, 'SHOP_OUTSIDE_TERRITORY');
});

test('an MRP can be set, and a trade price above it is refused', async () => {
  /*
   * `mrpMinor` was on the model, in the shared types and read by
   * `marginBasisPoints` — and absent from the validation schema, so zod stripped
   * it from every request and no medicine could ever carry one.
   */
  const created = await fetch(`${base}/api/v1/inventory/medicines`, {
    method: 'POST',
    headers: authorization(manager._id),
    body: JSON.stringify({
      sku: 'SETMRP-1',
      brandName: 'Seclo',
      genericName: 'Omeprazole',
      manufacturer: 'Square',
      strength: '20 mg',
      dosageForm: 'CAPSULE',
      packSize: '30s',
      unit: 'box',
      category: 'Gastro',
      classification: MedicineClassification.OTC,
      costPriceMinor: 500,
      defaultSellingPriceMinor: 700,
      mrpMinor: 900,
    }),
  });
  assert.equal(created.status, 201);
  const medicine = ((await created.json()) as { data: { _id: string } }).data;
  assert.equal((await Medicine.findById(medicine._id))?.mrpMinor, 900);

  // A pharmacy may not legally sell above the price printed on the pack, so
  // charging them more than it means they lose money on every unit.
  const refused = await fetch(`${base}/api/v1/inventory/medicines/${medicine._id}`, {
    method: 'PATCH',
    headers: authorization(manager._id),
    body: JSON.stringify({ defaultSellingPriceMinor: 1000 }),
  });
  assert.equal(
    refused.status,
    400,
    'the patch alone never sees the stored MRP, so this has to be checked ' +
      'against the merged document rather than against the request',
  );
  assert.equal((await Medicine.findById(medicine._id))?.defaultSellingPriceMinor, 700);
});
