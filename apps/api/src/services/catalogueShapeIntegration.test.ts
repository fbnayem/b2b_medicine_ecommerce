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
 * The two things a catalogue of 56,000 products needs that one of 51 did not:
 * more than one photograph per line, and a way to ask for a branch of the shelf
 * hierarchy rather than one leaf of it.
 *
 * Both were silently absent rather than broken, which is why neither had a
 * test. The catalogue held `productImageUrl` — singular — so 36,000 supplier
 * photographs had nowhere to land; and it kept only the last segment of
 * `Medicine > Antimicrobial > Anti-Bacterial`, so nothing could ask what else
 * was under "Antimicrobial".
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };

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

interface Node {
  name: string;
  path: string[];
  count: number;
  children: Node[];
}

const find = (nodes: Node[], name: string): Node | undefined => nodes.find((n) => n.name === name);

function line(
  brandName: string,
  categoryPath: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const slug = brandName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    reference: `MED-CAT-${slug.slice(0, 8)}`,
    sku: `CAT-${slug.slice(0, 12)}`,
    brandName,
    manufacturer: 'A Manufacturer',
    packSize: '10s',
    unit: 'box',
    category: categoryPath[categoryPath.length - 1],
    categoryPath,
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
  await mongoose.connect(memoryReplica.getUri('medsupply_catalogue_shape'));
  await mongoose.connection.dropDatabase();
  await Promise.all([Medicine.init(), User.init()]);

  await User.create(
    (
      [
        [manager, 'shape-manager', 'Branch', 'Manager'],
        [owner, 'shape-owner', 'Shop', 'Owner'],
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
    line('Cefixin', ['Medicine', 'Antimicrobial', 'Anti-Bacterial'], {
      productImages: ['/media/a-1.webp', '/media/a-2.webp', '/media/a-3.webp'],
      productImageUrl: '/media/a-1.webp',
    }),
    line('Azithro', ['Medicine', 'Antimicrobial', 'Macrolides']),
    line('Painex', ['Medicine', 'Musculoskeletal', 'Anti-Inflammatory']),
    line('Facewash', ['Beauty', 'Skincare', 'Cleansers']),
    // Delisted. A shop owner must not be led to a branch of things they cannot buy.
    line('Withdrawn Cream', ['Beauty', 'Skincare', 'Moisturisers'], { isActive: false }),
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

test('a product keeps every photograph it was given', async () => {
  const { body } = await get('/api/v1/inventory/medicines?search=Cefixin', manager);
  const item = (body as unknown as { data: Array<Record<string, unknown>> }).data[0]!;
  assert.deepEqual(item.productImages, ['/media/a-1.webp', '/media/a-2.webp', '/media/a-3.webp']);
  assert.equal(
    item.productImageUrl,
    '/media/a-1.webp',
    'the primary must mirror the first of the gallery, not drift from it',
  );
});

test('the shelf hierarchy is returned as a tree', async () => {
  const { status, body } = await get('/api/v1/inventory/categories', manager);
  assert.equal(status, 200);
  const roots = (body as unknown as { data: Node[] }).data;

  const medicine = find(roots, 'Medicine');
  assert.ok(medicine, 'Medicine must be a root');
  const antimicrobial = find(medicine.children, 'Antimicrobial');
  assert.ok(antimicrobial, 'Antimicrobial must sit under Medicine');
  assert.ok(find(antimicrobial.children, 'Anti-Bacterial'), 'three levels deep');
  assert.deepEqual(
    antimicrobial.path,
    ['Medicine', 'Antimicrobial'],
    'a node must carry the trail to itself, which is what a caller filters on',
  );
});

test('a branch counts everything underneath it, not only what sits directly on it', async () => {
  const { body } = await get('/api/v1/inventory/categories', manager);
  const roots = (body as unknown as { data: Node[] }).data;
  const antimicrobial = find(find(roots, 'Medicine')!.children, 'Antimicrobial')!;
  assert.equal(
    antimicrobial.count,
    2,
    'Anti-Bacterial and Macrolides both sit under Antimicrobial, so it holds two',
  );
  assert.equal(find(roots, 'Medicine')!.count, 3, 'three medicines across two branches');
});

test('a shop owner is never shown a branch of things they cannot buy', async () => {
  const { body } = await get('/api/v1/inventory/categories', owner);
  const roots = (body as unknown as { data: Node[] }).data;
  const skincare = find(find(roots, 'Beauty')!.children, 'Skincare')!;
  assert.equal(
    find(skincare.children, 'Moisturisers'),
    undefined,
    'the only product under Moisturisers is delisted, so the branch must not exist',
  );
  assert.equal(skincare.count, 1, 'the delisted line must not be counted either');
});

test('a manager browsing the whole catalogue still sees the delisted branch', async () => {
  const { body } = await get('/api/v1/inventory/categories', manager);
  const roots = (body as unknown as { data: Node[] }).data;
  const skincare = find(find(roots, 'Beauty')!.children, 'Skincare')!;
  assert.ok(
    find(skincare.children, 'Moisturisers'),
    'somebody deciding what to stock needs to see what has been taken off',
  );
});

test('a whole branch can be asked for, at any depth', async () => {
  const { body } = await get('/api/v1/inventory/medicines?branch=Antimicrobial', manager);
  const page = body as unknown as { data: Array<{ brandName: string }>; meta: { total: number } };
  assert.equal(page.meta.total, 2, 'both antimicrobials, across two different leaves');
  assert.deepEqual(page.data.map((m) => m.brandName).sort(), ['Azithro', 'Cefixin']);

  const top = await get('/api/v1/inventory/medicines?branch=Medicine', manager);
  assert.equal(
    (top.body as unknown as { meta: { total: number } }).meta.total,
    3,
    'the outermost level must reach everything under it',
  );
});

test('asking for a leaf still means only that leaf', async () => {
  const { body } = await get('/api/v1/inventory/medicines?category=Anti-Bacterial', manager);
  assert.equal((body as unknown as { meta: { total: number } }).meta.total, 1);
});
