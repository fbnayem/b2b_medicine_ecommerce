import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MedicineClassification, UserRole, UserStatus } from '@medsupply/shared-types';
import { app } from '../app';
import { Medicine } from '../models/Medicine';
import { User } from '../models/User';

/**
 * `isActive` means whether *we* sell the line. It stopped meaning that once:
 * the first import set `isActive = (availability === 'in_stock')`, which
 * switched off 24,188 products — 43% of the catalogue — because a competitor's
 * warehouse happened to be out of them on the day their site was scraped.
 * Which products a pharmacy may browse was being decided by somebody else's
 * stock room, frozen at scrape time.
 *
 * The fix split the fact in two: the supplier's word moved to
 * `listedElsewhere`, dated, as the observation it is, and `isActive` went back
 * to being ours. The importer's side of the split — that only a zero price
 * deactivates, 219 products' worth — is proven by its own reconciliation
 * gates; what this file pins is the serving side, which is where the defect
 * actually hurt: the shelf a shop owner is shown.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };

/** In our catalogue, out of the supplier's — the 24,188-product case. */
const rebeca = new Types.ObjectId();
/** Zero price: unpurchasable, so inactive — even though the supplier sells it. */
const sample = new Types.ObjectId();

const CHECKED_AT = new Date('2026-02-14T00:00:00.000Z');

function headers(user: { _id: Types.ObjectId }) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET!)}`,
  };
}

async function get(path: string, as: { _id: Types.ObjectId }) {
  const response = await fetch(`${base}${path}`, { headers: headers(as) });
  const text = await response.text();
  return {
    status: response.status,
    body: text.startsWith('{') ? (JSON.parse(text) as Record<string, never>) : ({} as never),
  };
}

interface Page {
  data: Array<Record<string, unknown>>;
  meta: { total: number };
}

function line(
  _id: Types.ObjectId,
  brandName: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const slug = brandName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    _id,
    reference: `MED-ACT-${slug.slice(0, 8)}`,
    sku: `ACT-${slug.slice(0, 12)}`,
    brandName,
    manufacturer: 'A Manufacturer',
    packSize: '10s',
    unit: 'box',
    category: 'Gastric',
    classification: MedicineClassification.OTC,
    costPriceMinor: 800,
    defaultSellingPriceMinor: 1000,
    mrpMinor: 1200,
    isActive: true,
    createdBy: manager._id,
    ...extra,
  };
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_activation'));
  await mongoose.connection.dropDatabase();
  await Promise.all([Medicine.init(), User.init()]);

  await User.create(
    (
      [
        [manager, 'activation-manager', 'Branch', 'Manager'],
        [owner, 'activation-owner', 'Shop', 'Owner'],
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

  await Medicine.create([
    // Exactly as the importer now writes the 24,188: active, because we sell
    // it, with the supplier's contrary opinion kept beside it as a dated note.
    line(rebeca, 'Rebeca', {
      isActive: true,
      listedElsewhere: { availability: 'out_of_stock', checkedAt: CHECKED_AT },
    }),
    // And the one thing that does deactivate: no price to sell at. The
    // supplier stocking it makes the point from the other direction — their
    // word must not activate a line any more than it may deactivate one.
    line(sample, 'Sample Sachet', {
      isActive: false,
      costPriceMinor: 0,
      defaultSellingPriceMinor: 0,
      mrpMinor: 0,
      listedElsewhere: { availability: 'in_stock', checkedAt: CHECKED_AT },
    }),
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
  await mongoose.disconnect();
  await memoryReplica?.stop();
});

test('a line the supplier ran out of is still on the shelf a shop owner sees', async () => {
  const list = await get('/api/v1/inventory/medicines?search=Rebeca', owner);
  assert.equal(list.status, 200);
  const page = list.body as unknown as Page;
  assert.equal(
    page.meta.total,
    1,
    'the supplier being out of a line must not hide it from our customers',
  );
  assert.equal(page.data[0]!.brandName, 'Rebeca');

  const detail = await get(`/api/v1/inventory/medicines/${rebeca}`, owner);
  assert.equal(detail.status, 200, 'visible in the list must mean openable in detail');
});

test('what the supplier said is recorded beside the line, dated, not obeyed', async () => {
  const { body } = await get(`/api/v1/inventory/medicines/${rebeca}`, manager);
  const item = (body as unknown as { data: Record<string, unknown> }).data;
  assert.equal(item.isActive, true, 'ours: we sell it');
  assert.deepEqual(
    item.listedElsewhere,
    { availability: 'out_of_stock', checkedAt: CHECKED_AT.toISOString() },
    'theirs: an observation with a date, worth keeping and worth nothing more',
  );
});

test('a zero-price line stays off the shop owner shelf — it cannot be purchased', async () => {
  const list = await get('/api/v1/inventory/medicines?search=Sample', owner);
  assert.equal(
    (list.body as unknown as Page).meta.total,
    0,
    'no price means no sale, whatever the supplier says about their own stock',
  );

  const detail = await get(`/api/v1/inventory/medicines/${sample}`, owner);
  assert.equal(detail.status, 404, 'nor may the detail page leak what the list hides');
});

test('a manager still sees the zero-price line, flagged for what it is', async () => {
  const list = await get('/api/v1/inventory/medicines?search=Sample', manager);
  const page = list.body as unknown as Page;
  assert.equal(page.meta.total, 1, 'deciding what to stock requires seeing what is switched off');
  assert.equal(page.data[0]!.isActive, false);
  assert.equal(page.data[0]!.defaultSellingPriceMinor, 0, 'and why: there is no price to sell at');
});
