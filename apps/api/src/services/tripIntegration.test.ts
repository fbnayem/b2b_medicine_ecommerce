import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { DeliveryStatus, UserRole, UserStatus } from '@medsupply/shared-types';
import { app } from '../app';
import { AuditLog } from '../models/AuditLog';
import { Delivery } from '../models/Delivery';
import { Shop } from '../models/Shop';
import { Trip } from '../models/Trip';
import { User } from '../models/User';

/**
 * A rider's round, end to end.
 *
 * The plan's acceptance criterion is "build a trip of six stops and confirm the
 * rider app shows them in sequence". The properties worth asserting beyond that
 * are the ones that decide whether adding this is safe:
 *
 *   - a delivery belongs to **one** round, so no shop gets visited twice;
 *   - calling a round off leaves every delivery **exactly** as it was;
 *   - a rider sees their own rounds and nobody else's, decided by the query
 *     rather than by the screen.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const rider = { _id: new Types.ObjectId(), role: UserRole.DELIVERY_PERSON };
const otherRider = { _id: new Types.ObjectId(), role: UserRole.DELIVERY_PERSON };
const shopId = new Types.ObjectId();
const deliveryIds = Array.from({ length: 6 }, () => new Types.ObjectId());

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
        return memoryReplica.getUri('medsupply_trips');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([AuditLog.init(), Delivery.init(), Shop.init(), Trip.init(), User.init()]);

  await User.create([
    {
      _id: manager._id,
      email: 'trip-manager@test.local',
      passwordHash: 'x',
      firstName: 'Trip',
      lastName: 'Manager',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    },
    {
      _id: rider._id,
      email: 'trip-rider@test.local',
      passwordHash: 'x',
      firstName: 'Trip',
      lastName: 'Rider',
      role: UserRole.DELIVERY_PERSON,
      status: UserStatus.ACTIVE,
    },
    {
      _id: otherRider._id,
      email: 'trip-rider-2@test.local',
      passwordHash: 'x',
      firstName: 'Other',
      lastName: 'Rider',
      role: UserRole.DELIVERY_PERSON,
      status: UserStatus.ACTIVE,
    },
  ]);

  await Shop.create({
    _id: shopId,
    reference: 'SHP-TRIP',
    name: 'Bismillah Pharmacy',
    ownerIds: [manager._id],
    primaryPhone: '01711000000',
    creditLimit: 100_000_00,
    paymentTermsDays: 30,
    deliveryAddresses: [
      {
        _id: new Types.ObjectId(),
        label: 'Shop',
        line1: '12 Green Road',
        city: 'Dhaka',
        district: 'Dhaka',
        isDefault: true,
      },
    ],
  });

  for (const [index, _id] of deliveryIds.entries()) {
    await Delivery.create({
      _id,
      reference: `DEL-2026-00000${index + 1}`,
      orderId: new Types.ObjectId(),
      packageId: new Types.ObjectId(),
      invoiceId: new Types.ObjectId(),
      shopId,
      // The delivery model has called this `assignedTo` since the delivery
      // phase; the trip calls the same thing `deliveryPersonId`.
      assignedTo: rider._id,
      status: DeliveryStatus.ASSIGNED,
      addressSnapshot: { line1: `${index + 1} Green Road`, city: 'Dhaka', district: 'Dhaka' },
      contactSnapshot: { name: 'Shop owner', phone: '01711000000' },
      proofRequirements: ['OTP'],
    });
  }

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

interface TripView {
  _id: string;
  reference: string;
  status: string;
  version: number;
  stops: Array<{ sequence: number; delivery: { _id: string; reference: string } | null }>;
  summary: { stopsTotal: number; stopsSettled: number; stopsRemaining: number };
}

test('a round of six stops, in the order it was planned', async () => {
  const plannable = await call('GET', '/api/v1/trips/plannable');
  assert.equal(plannable.status, 200);
  assert.equal(
    (plannable.body.data as unknown as unknown[]).length,
    6,
    'everything assigned and not yet on a round',
  );

  const planned = await call('POST', '/api/v1/trips', {
    deliveryPersonId: String(rider._id),
    tripDate: '2026-08-04',
    deliveryIds: deliveryIds.map(String),
    vehicleReference: 'DHK-METRO-11-2345',
  });
  assert.equal(planned.status, 201);
  const trip = planned.body.data as unknown as TripView;

  const fetched = (await call('GET', `/api/v1/trips/${trip._id}`, undefined, rider._id)).body
    .data as unknown as TripView;
  assert.equal(fetched.stops.length, 6);
  assert.deepEqual(
    fetched.stops.map((stop) => stop.sequence),
    [1, 2, 3, 4, 5, 6],
    'the rider is given the stops in sequence',
  );
  assert.deepEqual(
    fetched.stops.map((stop) => stop.delivery?.reference),
    deliveryIds.map((_, index) => `DEL-2026-00000${index + 1}`),
    'and in the order the office planned them',
  );
  assert.equal(fetched.summary.stopsRemaining, 6);

  // ── The day is stored as the day, not as the day before ───────────────────
  const stored = await Trip.findById(trip._id);
  const dhaka = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(
    stored!.tripDate,
  );
  assert.equal(
    dhaka,
    '2026-08-04',
    '`new Date("2026-08-04")` parses as UTC, which would store this as the 3rd at ' +
      '18:00 Dhaka and sort it into the wrong day',
  );

  // ── One stop, one round ───────────────────────────────────────────────────
  const doubleBooked = await call('POST', '/api/v1/trips', {
    deliveryPersonId: String(otherRider._id),
    tripDate: '2026-08-04',
    deliveryIds: [String(deliveryIds[0])],
  });
  assert.equal(
    doubleBooked.status,
    409,
    'two riders holding the same stop is how a shop gets visited twice',
  );

  // ── Reordering ────────────────────────────────────────────────────────────
  const reversed = [...deliveryIds].reverse().map(String);
  const resequenced = await call('POST', `/api/v1/trips/${trip._id}/sequence`, {
    version: trip.version,
    deliveryIds: reversed,
  });
  assert.equal(resequenced.status, 200);

  const afterReorder = (await call('GET', `/api/v1/trips/${trip._id}`)).body
    .data as unknown as TripView;
  assert.deepEqual(
    afterReorder.stops.map((stop) => stop.delivery?._id),
    reversed,
    'the round is reordered as a whole list rather than by move instructions',
  );

  const wrongSet = await call('POST', `/api/v1/trips/${trip._id}/sequence`, {
    version: afterReorder.version,
    deliveryIds: reversed.slice(0, 3),
  });
  assert.equal(wrongSet.status, 400, 'reordering cannot quietly drop three stops');

  // ── The rider starts their own round ──────────────────────────────────────
  const started = await call(
    'POST',
    `/api/v1/trips/${trip._id}/start`,
    { version: afterReorder.version },
    rider._id,
  );
  assert.equal(started.status, 200);
  assert.equal((started.body.data as unknown as TripView).status, 'IN_PROGRESS');
});

test('a rider sees their own rounds and nobody else’s', async () => {
  const mine = await call('GET', '/api/v1/trips', undefined, rider._id);
  assert.equal(mine.status, 200);
  const page = mine.body.data as unknown as { items: Array<{ deliveryPersonId: unknown }> };
  assert.ok(page.items.length >= 1);

  const theirs = await call('GET', '/api/v1/trips', undefined, otherRider._id);
  assert.equal(
    (theirs.body.data as unknown as { items: unknown[] }).items.length,
    0,
    'scoped by the query rather than by the screen — a filter a client applies ' +
      'is a filter a client can drop',
  );

  const trip = await Trip.findOne({ deliveryPersonId: rider._id });
  const peek = await call('GET', `/api/v1/trips/${trip!._id}`, undefined, otherRider._id);
  assert.equal(peek.status, 403, 'and the same on the detail');
});

test('calling a round off leaves every delivery exactly as it was', async () => {
  const trip = await Trip.findOne({ deliveryPersonId: rider._id });
  const before = await Delivery.find({ _id: { $in: deliveryIds } })
    .select('status deliveryPersonId')
    .lean();

  const cancelled = await call('POST', `/api/v1/trips/${trip!._id}/cancel`, {
    version: trip!.version,
    reason: 'Vehicle broke down before the round started',
  });
  assert.equal(cancelled.status, 200);

  const afterCancel = await Delivery.find({ _id: { $in: deliveryIds } })
    .select('status deliveryPersonId')
    .lean();
  assert.deepEqual(
    afterCancel.map((delivery) => delivery.status),
    before.map((delivery) => delivery.status),
    'a round is a plan, not the work — unassigning here would strand boxes a ' +
      'rider is already holding',
  );

  assert.ok(await AuditLog.findOne({ action: 'TRIP_CANCELLED' }));

  // The stops are free again, so tomorrow's round can be planned.
  const plannable = (await call('GET', '/api/v1/trips/plannable')).body
    .data as unknown as unknown[];
  assert.equal(plannable.length, 6);
});
