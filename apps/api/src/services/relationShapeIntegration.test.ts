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
import { MedicineRelation } from '../models/MedicineRelation';
import { User } from '../models/User';

/**
 * The relation storage changed shape — one document per (product, kind)
 * holding the whole list, instead of one row per relation — and a shape change
 * is exactly the kind of edit that keeps compiling while the behaviour drifts.
 * Three behaviours have to survive it.
 *
 * **Rank order.** The supplier's first suggestion is better than their
 * twentieth, and `rank` is stored as a number precisely so the order survives
 * anything that filters the list. The fixture stores the array physically out
 * of rank order, so "already in rank order" can only pass if something sorts.
 *
 * **All four kinds, and the advert kept apart.** `SIMILAR`, `BOUGHT_TOGETHER`
 * and `SAME_BRAND` are genuine suggestions; `PROMOTED` is the supplier's
 * bestseller carousel — advertising, which on a prescription line names
 * products with no connection to the medicine at all. It must come back as its
 * own group, last, so a screen can label it; blended into a genuine group it
 * becomes a paid placement presented as a clinical match.
 *
 * **Idempotency.** The old row shape carried a unique index on
 * `(fromId, toId, kind)` whose only job was to stop a re-run of the import
 * doubling the collection. That index went with the rows; what replaced it is
 * delete-then-insert plus a unique index on `(fromId, kind)`. The backstop
 * matters as much as the sequence: an importer that forgets the delete must be
 * refused by the database, not silently accumulate.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };

const sergel = new Types.ObjectId();
/*
 * The three SIMILAR targets. Ranks are assigned so the correct output —
 * Cortifen, Anzitor, Bicozin — matches neither the alphabetical order nor the
 * order the items sit in the stored array, which are the two orders a broken
 * pipeline would produce by accident.
 */
const anzitor = new Types.ObjectId(); // rank 2
const bicozin = new Types.ObjectId(); // rank 3
const cortifen = new Types.ObjectId(); // rank 1
const boughtWith = new Types.ObjectId();
const brandMate = new Types.ObjectId();
const advert = new Types.ObjectId();

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

async function alternatives(id: Types.ObjectId) {
  const response = await fetch(`${base}/api/v1/inventory/medicines/${id}/alternatives`, {
    headers: headers(manager),
  });
  const text = await response.text();
  const body = text.startsWith('{') ? (JSON.parse(text) as { data?: Group[] }) : {};
  return { status: response.status, groups: body.data ?? [] };
}

const groupOf = (groups: Group[], kind: string) => groups.find((group) => group.kind === kind);
const names = (group: Group | undefined) => (group?.items ?? []).map((item) => item.brandName);

function line(_id: Types.ObjectId, brandName: string): Record<string, unknown> {
  const slug = brandName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    _id,
    reference: `MED-REL-${slug.slice(0, 8)}`,
    sku: `REL-${slug.slice(0, 12)}`,
    brandName,
    manufacturer: 'A Manufacturer',
    packSize: '10s',
    unit: 'box',
    category: 'Gastric',
    // OTC, and deliberately no `genericName`: the derived same-ingredient
    // group would otherwise join the four stored kinds and blur the ordering
    // assertion into testing two features at once.
    classification: MedicineClassification.OTC,
    costPriceMinor: 800,
    defaultSellingPriceMinor: 1000,
    mrpMinor: 1200,
    isActive: true,
    createdBy: manager._id,
  };
}

/** The complete supplier record for `sergel`, as the importer writes it. */
function supplierRecord() {
  return [
    {
      fromId: sergel,
      kind: MedicineRelationKind.SIMILAR,
      items: [
        { toId: anzitor, rank: 2 },
        { toId: bicozin, rank: 3 },
        { toId: cortifen, rank: 1 },
      ],
      source: 'AROGGA',
      refreshedAt: new Date(),
    },
    {
      fromId: sergel,
      kind: MedicineRelationKind.BOUGHT_TOGETHER,
      items: [{ toId: boughtWith, rank: 1 }],
      source: 'AROGGA',
      refreshedAt: new Date(),
    },
    {
      fromId: sergel,
      kind: MedicineRelationKind.SAME_BRAND,
      items: [{ toId: brandMate, rank: 1 }],
      source: 'AROGGA',
      refreshedAt: new Date(),
    },
    {
      fromId: sergel,
      kind: MedicineRelationKind.PROMOTED,
      items: [{ toId: advert, rank: 1 }],
      source: 'AROGGA',
      refreshedAt: new Date(),
    },
  ];
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_relation_shape'));
  await mongoose.connection.dropDatabase();
  // `init()` builds the `(fromId, kind)` unique index the idempotency test
  // leans on; without it the duplicate insert below would quietly succeed.
  await Promise.all([Medicine.init(), MedicineRelation.init(), User.init()]);

  await User.create({
    _id: manager._id,
    email: 'relation-manager@test.local',
    passwordHash: 'x',
    firstName: 'Branch',
    lastName: 'Manager',
    role: manager.role,
    status: UserStatus.ACTIVE,
  });

  await Medicine.create([
    line(sergel, 'Sergel'),
    line(anzitor, 'Anzitor'),
    line(bicozin, 'Bicozin'),
    line(cortifen, 'Cortifen'),
    line(boughtWith, 'Oradin'),
    line(brandMate, 'Sergel MUPS'),
    line(advert, 'Advertised Tonic'),
  ]);

  await MedicineRelation.create(supplierRecord());

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

test('a stored list comes back in rank order, whatever order the array holds', async () => {
  const { status, groups } = await alternatives(sergel);
  assert.equal(status, 200);
  assert.deepEqual(
    names(groupOf(groups, 'SIMILAR')),
    ['Cortifen', 'Anzitor', 'Bicozin'],
    'rank decides the order — not array position, and not the alphabet',
  );
});

test('all four kinds round-trip, and the advert is its own group, last', async () => {
  const { groups } = await alternatives(sergel);
  assert.deepEqual(
    groups.map((group) => group.kind),
    ['SIMILAR', 'BOUGHT_TOGETHER', 'SAME_BRAND', 'PROMOTED'],
    'every stored kind must arrive, and the promotion must close the list',
  );
  // Labelled apart is the whole point: the carousel product must not surface
  // inside any genuine group, where a screen would present it as a match.
  for (const kind of ['SIMILAR', 'BOUGHT_TOGETHER', 'SAME_BRAND'] as const) {
    assert.ok(
      !names(groupOf(groups, kind)).includes('Advertised Tonic'),
      `${kind} absorbed the supplier's advertising`,
    );
  }
  assert.deepEqual(names(groupOf(groups, 'PROMOTED')), ['Advertised Tonic']);
});

/*
 * Deliberately last in the file: it rewrites `sergel`'s relations, and the
 * tests above read the original fixture.
 */
test('re-importing a product replaces its relations rather than doubling them', async () => {
  // The importer's sequence, twice over, with the SIMILAR list changed the
  // second time — the supplier dropped two suggestions between scrapes, and a
  // vanished suggestion must be forgotten, not merged with.
  for (let run = 0; run < 2; run += 1) {
    await MedicineRelation.deleteMany({ fromId: sergel });
    const record = supplierRecord();
    record[0]!.items = [{ toId: cortifen, rank: 1 }];
    await MedicineRelation.create(record);
  }

  assert.equal(
    await MedicineRelation.countDocuments({ fromId: sergel }),
    4,
    'two runs must leave one document per kind, not eight',
  );
  const { groups } = await alternatives(sergel);
  assert.deepEqual(
    names(groupOf(groups, 'SIMILAR')),
    ['Cortifen'],
    'the replaced list is the answer; the dropped suggestions must be gone',
  );

  // The backstop. Delete-then-insert is idempotent only while every writer
  // remembers the delete; the unique index is what refuses the one that
  // forgets, which is the job the retired `(fromId, toId, kind)` index did
  // for the row shape.
  await assert.rejects(
    MedicineRelation.create({
      fromId: sergel,
      kind: MedicineRelationKind.SIMILAR,
      items: [{ toId: anzitor, rank: 1 }],
    }),
    /E11000/,
    'a second document for the same (product, kind) must be refused by the index',
  );
});
