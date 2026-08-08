import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  MedicineClassification,
  MedicineRelationKind,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { MedicineRelation } from '../models/MedicineRelation';
import { User } from '../models/User';

/**
 * "We are out of it — what else can you send?"
 *
 * The question a distributor is asked every day, and the one the catalogue
 * could not answer. Two things are being tested and they fail in different
 * ways.
 *
 * **The derived group** — other brands of the same drug — is a query over
 * `genericName`, so its failure mode is a *wrong* answer rather than a missing
 * one: match carelessly and every product with no active ingredient becomes an
 * alternative for every other, which looks like a working feature and is a
 * null-equals-null bug. Most of this catalogue is not a drug, so that group is
 * the majority of it.
 *
 * **The stored groups** fail the ordinary way: a suggestion that points at
 * something delisted.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };
const rider = { _id: new Types.ObjectId(), role: UserRole.DELIVERY_PERSON };

/** Paracetamol 500, and the brands a shop could be sent instead. */
const napa = new Types.ObjectId();
const ace = new Types.ObjectId();
const fast = new Types.ObjectId();
/** Same drug, different strength — offerable, but not first. */
const napaExtra = new Types.ObjectId();
/** Same drug, withdrawn. */
const delisted = new Types.ObjectId();
/** Not a drug at all, and neither is `soap` — both have no active ingredient. */
const shampoo = new Types.ObjectId();
const soap = new Types.ObjectId();

function headers(user: { _id: Types.ObjectId }) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET!)}`,
  };
}

interface Group {
  kind: string;
  items: Array<Record<string, unknown>>;
}

async function alternatives(id: Types.ObjectId, as: { _id: Types.ObjectId }) {
  const response = await fetch(`${base}/api/v1/inventory/medicines/${id}/alternatives`, {
    headers: headers(as),
  });
  const text = await response.text();
  const body = text.startsWith('{') ? (JSON.parse(text) as { data?: Group[] }) : {};
  return { status: response.status, groups: body.data ?? [] };
}

const groupOf = (groups: Group[], kind: string) => groups.find((group) => group.kind === kind);
const names = (group: Group | undefined) => (group?.items ?? []).map((item) => item.brandName);

function line(
  _id: Types.ObjectId,
  brandName: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    _id,
    reference: `MED-ALT-${brandName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8)}`,
    sku: `ALT-${brandName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12)}`,
    brandName,
    manufacturer: 'A Manufacturer',
    packSize: '10s',
    unit: 'box',
    category: 'Analgesic',
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
  await mongoose.connect(memoryReplica.getUri('medsupply_alternatives'));
  await mongoose.connection.dropDatabase();
  await Promise.all([Medicine.init(), MedicineBatch.init(), MedicineRelation.init(), User.init()]);

  await User.create(
    (
      [
        [manager, 'alt-manager', 'Branch', 'Manager'],
        [owner, 'alt-owner', 'Shop', 'Owner'],
        [rider, 'alt-rider', 'Delivery', 'Person'],
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
    line(napa, 'Napa', { genericName: 'Paracetamol', strength: '500 mg' }),
    // Deliberately lower-cased. The catalogue is typed by people.
    line(ace, 'Ace', {
      genericName: 'paracetamol',
      strength: '500 mg',
      defaultSellingPriceMinor: 1400,
    }),
    line(fast, 'Fast', {
      genericName: 'Paracetamol',
      strength: '500 mg',
      defaultSellingPriceMinor: 900,
    }),
    line(napaExtra, 'Napa Extra', { genericName: 'Paracetamol', strength: '665 mg' }),
    line(delisted, 'Withdrawn', {
      genericName: 'Paracetamol',
      strength: '500 mg',
      isActive: false,
    }),
    // Neither is a drug, so neither has an active ingredient — and they sit on
    // a shelf of their own so the fallback assertion below means something
    // narrower than "everything in the fixture".
    line(shampoo, 'Shampoo', { category: 'Toiletries' }),
    line(soap, 'Soap', { category: 'Toiletries' }),
  ]);

  // Only `Fast` has stock. Nothing else does, which is what makes the ordering
  // assertion below mean something.
  await MedicineBatch.create({
    medicineId: fast,
    warehouseId: new Types.ObjectId(),
    warehouseLocation: 'A1',
    batchNumber: 'ALT-B1',
    manufacturingDate: new Date('2026-01-01'),
    expiryDate: new Date('2027-01-01'),
    costPriceMinor: 800,
    receivedQuantity: 100,
    quantities: { onHand: 100, available: 100 },
    createdBy: manager._id,
  });

  await MedicineRelation.create([
    {
      fromId: napa,
      kind: MedicineRelationKind.SIMILAR,
      items: [
        { toId: shampoo, rank: 2 },
        { toId: soap, rank: 1 },
        // Points at a product nobody may be sent. Must not appear.
        { toId: delisted, rank: 3 },
      ],
    },
    { fromId: napa, kind: MedicineRelationKind.BOUGHT_TOGETHER, items: [{ toId: soap, rank: 1 }] },
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

test('offers other brands of the same drug, and not the drug itself', async () => {
  const { status, groups } = await alternatives(napa, manager);
  assert.equal(status, 200);
  const same = groupOf(groups, 'SAME_INGREDIENT');
  assert.ok(same, 'a paracetamol tablet must have a same-ingredient group');
  assert.ok(!names(same).includes('Napa'), 'a medicine is not an alternative to itself');
  assert.ok(names(same).includes('Ace'));
  assert.ok(names(same).includes('Fast'));
});

test('matches an active ingredient however it was typed', async () => {
  const { groups } = await alternatives(napa, manager);
  // `Ace` was entered as `paracetamol`. A pharmacy that types the ingredient in
  // lower case has not entered a different drug.
  assert.ok(
    names(groupOf(groups, 'SAME_INGREDIENT')).includes('Ace'),
    'case must not decide whether two products share an active ingredient',
  );
});

test('puts the same strength first, then what is actually in stock', async () => {
  const { groups } = await alternatives(napa, manager);
  const offered = names(groupOf(groups, 'SAME_INGREDIENT'));
  // 665 mg is the same molecule and not interchangeable with 500 mg, so it is
  // offerable but never the first thing suggested.
  assert.equal(
    offered[offered.length - 1],
    'Napa Extra',
    'a different strength must rank below every same-strength alternative',
  );
  assert.equal(
    offered[0],
    'Fast',
    'among equals, the one there is stock of is the one that can be sent today',
  );
});

test('never offers a withdrawn product', async () => {
  const { groups } = await alternatives(napa, manager);
  for (const group of groups) {
    assert.ok(
      !names(group).includes('Withdrawn'),
      `${group.kind} offered a product that is not for sale`,
    );
  }
});

test('a product with no active ingredient has no same-ingredient group', async () => {
  const { groups } = await alternatives(shampoo, manager);
  assert.equal(
    groupOf(groups, 'SAME_INGREDIENT'),
    undefined,
    'a shampoo and a soap share no active ingredient — they share the absence of one',
  );
});

test('keeps the supplier ranking on stored suggestions', async () => {
  const { groups } = await alternatives(napa, manager);
  assert.deepEqual(
    names(groupOf(groups, 'SIMILAR')),
    ['Soap', 'Shampoo'],
    'rank 1 is a better suggestion than rank 2 and must be shown first',
  );
});

test('separates what is comparable from what is bought alongside', async () => {
  const { groups } = await alternatives(napa, manager);
  assert.deepEqual(names(groupOf(groups, 'BOUGHT_TOGETHER')), ['Soap']);
});

test('reports free stock so a suggestion can be acted on', async () => {
  const { groups } = await alternatives(napa, manager);
  const fastItem = groupOf(groups, 'SAME_INGREDIENT')!.items.find(
    (item) => item.brandName === 'Fast',
  );
  assert.equal(fastItem?.totalAvailable, 100);
});

test('a shop owner is never shown what the goods cost us', async () => {
  const { status, groups } = await alternatives(napa, owner);
  assert.equal(status, 200);
  for (const group of groups) {
    for (const item of group.items) {
      assert.ok(
        !('costPriceMinor' in item),
        `${group.kind} leaked a cost price to a customer on ${String(item.brandName)}`,
      );
    }
  }
});

test('a rider cannot browse the catalogue for alternatives', async () => {
  const { status } = await alternatives(napa, rider);
  assert.equal(status, 403, 'a rider carries what is on the note and does not sell');
});

test('an unknown medicine is not found rather than empty', async () => {
  const { status } = await alternatives(new Types.ObjectId(), manager);
  assert.equal(status, 404);
});

/*
 * The floor. 225 products in the imported catalogue have neither a stored
 * suggestion nor an active ingredient — a walking stick, a one-off device — and
 * before this they showed a blank space where their alternatives should be.
 */
test('a product with nothing better falls back to its own shelf', async () => {
  const { groups } = await alternatives(shampoo, manager);
  const shelf = groupOf(groups, 'SAME_CATEGORY');
  assert.ok(
    shelf,
    'a product with no ingredient and no stored suggestion must still offer something',
  );
  assert.deepEqual(names(shelf), ['Soap'], 'the other product on the Analgesic shelf');
});

test('the shelf is a last resort, never a fourth suggestion', async () => {
  // `Napa` has same-ingredient alternatives and stored suggestions, so it is on
  // the same shelf as everything else and must still not be offered the shelf —
  // "others in this category" beside a real list is noise, and noise teaches
  // people to stop reading the list.
  const { groups } = await alternatives(napa, manager);
  assert.equal(
    groupOf(groups, 'SAME_CATEGORY'),
    undefined,
    'the shelf group appeared alongside better suggestions',
  );
});
