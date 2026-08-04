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
import { AuditLog } from '../models/AuditLog';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { StockMovement } from '../models/StockMovement';
import { Stocktake } from '../models/Stocktake';
import { User } from '../models/User';

/**
 * A stocktake, end to end, through the API.
 *
 * The plan's acceptance criterion is "run a stocktake that finds a planted
 * variance and confirm the adjustment posts once, transactionally, with an
 * audit record". Everything here is that sentence, plus the three properties
 * the design turns on:
 *
 *   - the expected quantity is **withheld** while counting, so the count is
 *     blind in the payload and not only on the screen;
 *   - an **uncounted** line posts nothing, so an aisle nobody reached is not
 *     written off;
 *   - the person who counted cannot post their own sheet.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const storekeeper = { _id: new Types.ObjectId(), role: UserRole.STOREKEEPER };

const medicineId = new Types.ObjectId();
const countedBatchId = new Types.ObjectId();
const missedBatchId = new Types.ObjectId();
const committedBatchId = new Types.ObjectId();

function authorization(userId: Types.ObjectId) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`,
  };
}

function quantities(onHand: number, reserved = 0) {
  return {
    onHand,
    available: onHand - reserved,
    reserved,
    picking: 0,
    packed: 0,
    damaged: 0,
    expired: 0,
    returned: 0,
    quarantined: 0,
  };
}

before(async () => {
  const uri = process.env.MONGODB_TEST_URI
    ? process.env.MONGODB_TEST_URI
    : await (async () => {
        memoryReplica = await MongoMemoryReplSet.create({
          replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
        });
        return memoryReplica.getUri('medsupply_stocktake');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([
    AuditLog.init(),
    Medicine.init(),
    MedicineBatch.init(),
    StockMovement.init(),
    Stocktake.init(),
    User.init(),
  ]);

  await User.create([
    {
      _id: manager._id,
      email: 'stocktake-manager@test.local',
      passwordHash: 'x',
      firstName: 'Count',
      lastName: 'Manager',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    },
    {
      _id: storekeeper._id,
      email: 'stocktake-store@test.local',
      passwordHash: 'x',
      firstName: 'Count',
      lastName: 'Store',
      role: UserRole.STOREKEEPER,
      status: UserStatus.ACTIVE,
    },
  ]);

  await Medicine.create({
    _id: medicineId,
    reference: 'MED-2026-000001',
    sku: 'NAPA-500',
    brandName: 'Napa',
    genericName: 'Paracetamol',
    strength: '500 mg',
    dosageForm: 'TABLET',
    packSize: '10s',
    unit: 'box',
    category: 'Analgesic',
    manufacturer: 'Beximco',
    classification: MedicineClassification.OTC,
    defaultSellingPriceMinor: 1080,
    costPriceMinor: 800,
    createdBy: manager._id,
  });

  await MedicineBatch.create([
    {
      _id: countedBatchId,
      medicineId,
      batchNumber: 'AISLE-A-1',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2028-01-01'),
      costPriceMinor: 800,
      receivedQuantity: 100,
      quantities: quantities(100),
      warehouseLocation: 'AISLE-A',
      createdBy: storekeeper._id,
    },
    {
      _id: missedBatchId,
      medicineId,
      batchNumber: 'AISLE-A-2',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2028-06-01'),
      costPriceMinor: 800,
      receivedQuantity: 40,
      quantities: quantities(40),
      warehouseLocation: 'AISLE-A',
      createdBy: storekeeper._id,
    },
    {
      _id: committedBatchId,
      medicineId,
      batchNumber: 'AISLE-A-3',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2028-09-01'),
      costPriceMinor: 800,
      receivedQuantity: 30,
      // Twenty of these are already promised to an order.
      quantities: quantities(30, 20),
      warehouseLocation: 'AISLE-A',
      createdBy: storekeeper._id,
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
  return { status: response.status, body: (await response.json()) as Record<string, never> };
}

interface Sheet {
  _id: string;
  reference: string;
  status: string;
  version: number;
  lines: Array<{
    _id: string;
    systemQuantity?: number;
    countedQuantity: number | null;
    snapshot: { batchNumber: string };
  }>;
  summary?: { linesCounted: number; linesUncounted: number; unitsShort: number; unitsOver: number };
}

test('a count over one aisle: blind while counting, posted once, audited', async () => {
  // ── Open ──────────────────────────────────────────────────────────────────
  const opened = await call(
    'POST',
    '/api/v1/stocktakes',
    { warehouseLocation: 'AISLE-A', notes: 'Monthly count' },
    storekeeper._id,
  );
  assert.equal(opened.status, 201);
  const sheet = opened.body.data as unknown as Sheet;
  assert.equal(sheet.lines.length, 3, 'every batch in the aisle is on the sheet');

  // ── The sheet a counter is given withholds the answer ──────────────────────
  const counting = await call('GET', `/api/v1/stocktakes/${sheet._id}`, undefined, storekeeper._id);
  const blind = counting.body.data as unknown as Sheet;
  assert.equal(blind.status, 'COUNTING');
  for (const line of blind.lines) {
    assert.equal(
      line.systemQuantity,
      undefined,
      'the expected quantity must not be in the payload — a blind count that ships ' +
        'the answer in the response is not blind, whatever the screen shows',
    );
  }
  assert.equal(blind.summary, undefined, 'and neither is the variance summary');

  const lineFor = (batchNumber: string) => {
    const line = blind.lines.find((entry) => entry.snapshot.batchNumber === batchNumber);
    assert.ok(line, `no line for ${batchNumber}`);
    return line;
  };

  // ── Count two of the three lines ───────────────────────────────────────────
  // AISLE-A-1: system says 100, the shelf has 94. A planted variance.
  // AISLE-A-3: counted exactly right, so it must post nothing.
  // AISLE-A-2: never visited, and must stay uncounted rather than become zero.
  const counted = await call(
    'POST',
    `/api/v1/stocktakes/${sheet._id}/counts`,
    {
      version: blind.version,
      counts: [
        {
          lineId: lineFor('AISLE-A-1')._id,
          countedQuantity: 94,
          varianceReason: 'Six units damaged in the aisle and binned last week',
        },
        { lineId: lineFor('AISLE-A-3')._id, countedQuantity: 30 },
      ],
    },
    storekeeper._id,
  );
  assert.equal(counted.status, 200);
  const afterCount = counted.body.data as unknown as { version: number };

  // ── Submitting reveals the variance ───────────────────────────────────────
  const submitted = await call(
    'POST',
    `/api/v1/stocktakes/${sheet._id}/submit`,
    { version: afterCount.version },
    storekeeper._id,
  );
  assert.equal(submitted.status, 200);

  const review = (await call('GET', `/api/v1/stocktakes/${sheet._id}`)).body
    .data as unknown as Sheet;
  assert.equal(review.status, 'REVIEW');
  assert.equal(review.summary?.linesCounted, 2);
  assert.equal(review.summary?.linesUncounted, 1, 'the aisle nobody reached is reported as such');
  assert.equal(review.summary?.unitsShort, 6);
  assert.equal(review.summary?.unitsOver, 0);
  assert.ok(
    review.lines.every((line) => typeof line.systemQuantity === 'number'),
    'the expected quantities appear once counting is finished',
  );

  // ── A storekeeper cannot approve their own count ──────────────────────────
  const selfPost = await call(
    'POST',
    `/api/v1/stocktakes/${sheet._id}/post`,
    { version: review.version, idempotencyKey: 'stocktake-post-attempt-1' },
    storekeeper._id,
  );
  assert.equal(
    selfPost.status,
    403,
    'the value of a count as a control is that somebody else accepts it',
  );

  // ── Posting ───────────────────────────────────────────────────────────────
  const key = 'stocktake-post-key-000001';
  const posted = await call('POST', `/api/v1/stocktakes/${sheet._id}/post`, {
    version: review.version,
    idempotencyKey: key,
  });
  assert.equal(posted.status, 200);

  const adjusted = await MedicineBatch.findById(countedBatchId);
  assert.equal(adjusted?.quantities.onHand, 94, 'the shelf figure becomes what was counted');
  assert.equal(adjusted?.quantities.available, 94);

  const untouched = await MedicineBatch.findById(missedBatchId);
  assert.equal(
    untouched?.quantities.onHand,
    40,
    'an uncounted line posts nothing — treating it as zero would write off stock ' +
      'that is sitting on the shelf',
  );

  const movements = await StockMovement.find({
    batchId: countedBatchId,
    type: StockMovementType.ADJUSTMENT,
  });
  assert.equal(movements.length, 1);
  assert.equal(movements[0]!.quantity, -6);
  assert.match(movements[0]!.reason ?? '', /STK-/, 'the movement names the count it came from');

  const exact = await StockMovement.countDocuments({ batchId: committedBatchId });
  assert.equal(exact, 0, 'a line counted exactly right posts no movement at all');

  const audit = await AuditLog.findOne({ action: 'STOCKTAKE_POSTED' });
  assert.ok(audit, 'posting a count is an audited act');
  assert.equal((audit?.after as { linesAdjusted?: number })?.linesAdjusted, 1);
  assert.equal((audit?.after as { linesUncounted?: number })?.linesUncounted, 1);

  // ── The same key again does not post again ────────────────────────────────
  const replay = await call('POST', `/api/v1/stocktakes/${sheet._id}/post`, {
    version: review.version + 1,
    idempotencyKey: key,
  });
  assert.equal(replay.status, 200, 'a retried approval is answered, not refused');
  assert.equal(
    await StockMovement.countDocuments({ batchId: countedBatchId }),
    1,
    'and it adjusts the shelf exactly once',
  );
});

test('a count below what is already promised to an order is refused, not posted', async () => {
  const opened = await call('POST', '/api/v1/stocktakes', { warehouseLocation: 'AISLE-B' });
  assert.equal(opened.status, 400, 'an empty scope is refused rather than opening a blank sheet');

  // Twenty of AISLE-A-3 are reserved against an order. Counting fewer than that
  // cannot be posted: making a reservation negative breaks the order rather
  // than reporting the problem.
  const sheet = (
    await call('POST', '/api/v1/stocktakes', { warehouseLocation: 'AISLE-A' }, storekeeper._id)
  ).body.data as unknown as Sheet;

  const line = sheet.lines.find((entry) => entry.snapshot.batchNumber === 'AISLE-A-3');
  assert.ok(line);

  const counted = await call(
    'POST',
    `/api/v1/stocktakes/${sheet._id}/counts`,
    {
      version: sheet.version,
      counts: [{ lineId: line._id, countedQuantity: 5, varianceReason: 'Only five on the shelf' }],
    },
    storekeeper._id,
  );
  const version = (counted.body.data as unknown as { version: number }).version;
  await call('POST', `/api/v1/stocktakes/${sheet._id}/submit`, { version }, storekeeper._id);

  const posted = await call('POST', `/api/v1/stocktakes/${sheet._id}/post`, {
    version: version + 1,
    idempotencyKey: 'stocktake-committed-key-1',
  });
  assert.equal(posted.status, 409);
  assert.equal(
    (await MedicineBatch.findById(committedBatchId))?.quantities.onHand,
    30,
    'and nothing moved: the whole posting is one transaction',
  );
});

test('the list shows progress without showing the sheet', async () => {
  const listed = await call('GET', '/api/v1/stocktakes?limit=10', undefined, storekeeper._id);
  assert.equal(listed.status, 200);
  const page = listed.body.data as unknown as {
    items: Array<{
      reference: string;
      status: string;
      lines?: unknown;
      summary: { linesCounted: number };
    }>;
    total: number;
  };
  assert.ok(page.total >= 1);
  for (const row of page.items) {
    assert.equal(
      row.lines,
      undefined,
      'a counter must not be able to read the expected figures off the index either',
    );
    assert.equal(typeof row.summary.linesCounted, 'number');
  }
});

test('an abandoned count posts nothing and says why', async () => {
  /*
   * The sheet left behind by the previous test, which could not be posted
   * because a line was counted below what was promised to an order. That is
   * exactly when a count gets abandoned in practice, and it is also why opening
   * a second count over the same aisle is refused: two sheets for one shelf is
   * how a variance gets posted twice.
   */
  const blocked = await call('POST', '/api/v1/stocktakes', { warehouseLocation: 'AISLE-A' });
  assert.equal(blocked.status, 409, 'one open count per scope');

  const open = await Stocktake.findOne({ status: 'REVIEW' });
  assert.ok(open, 'the unpostable sheet is still there rather than silently gone');
  const sheet = { _id: String(open._id), version: open.version } as unknown as Sheet;

  const before = await StockMovement.countDocuments({});
  const abandoned = await call('POST', `/api/v1/stocktakes/${sheet._id}/abandon`, {
    version: sheet.version,
    reason: 'Aisle was being restacked, count restarted tomorrow',
  });
  assert.equal(abandoned.status, 200);
  assert.equal((abandoned.body.data as unknown as Sheet).status, 'ABANDONED');
  assert.equal(await StockMovement.countDocuments({}), before, 'nothing moved');

  const audit = await AuditLog.findOne({ action: 'STOCKTAKE_ABANDONED' });
  assert.ok(audit, 'abandoning a count is recorded, so a missing sheet has an explanation');
});
