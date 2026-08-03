import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { OrderStatus, ShopStatus, UserRole, UserStatus } from '@medsupply/shared-types';
import { app } from '../app';
import { Order } from '../models/Order';
import { Session } from '../models/Session';
import { Shop } from '../models/Shop';
import { User } from '../models/User';

/**
 * The three endpoints phase 4 added, driven over HTTP.
 *
 * Reaching them through the real server rather than the service is the point:
 * `requirePasswordChange` is middleware, and the route guards are middleware,
 * so a service-level test would prove nothing about either. It also takes three
 * routes off the untested list rather than adding three waivers to it.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const PASSWORD = 'initial-password-123';
const NEW_PASSWORD = 'a-much-better-password-456';

let owner: InstanceType<typeof User>;
let manager: InstanceType<typeof User>;
let forced: InstanceType<typeof User>;
let shop: InstanceType<typeof Shop>;

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
        return memoryReplica.getUri('medsupply_phase4');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([Order.init(), Session.init(), Shop.init(), User.init()]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  [owner, manager, forced] = await User.create([
    {
      email: 'p4-owner@test.local',
      passwordHash: hash,
      firstName: 'Phase',
      lastName: 'Owner',
      role: UserRole.SHOP_OWNER,
      status: UserStatus.ACTIVE,
    },
    {
      email: 'p4-manager@test.local',
      passwordHash: hash,
      firstName: 'Phase',
      lastName: 'Manager',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    },
    {
      email: 'p4-forced@test.local',
      passwordHash: hash,
      firstName: 'Phase',
      lastName: 'Forced',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: true,
    },
  ]);

  shop = await Shop.create({
    reference: 'SHP-P4',
    name: 'Phase Four Pharmacy',
    ownerIds: [owner._id],
    primaryPhone: '01799000001',
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

async function makeOrder(reference: string) {
  return Order.create({
    reference,
    shopId: shop._id,
    submittedBy: owner._id,
    status: OrderStatus.SUBMITTED,
    items: [],
    estimatedTotalMinor: 0,
    version: 0,
  });
}

test('a shop owner can ask for a cancellation and a manager decides it', async () => {
  const order = await makeOrder('ORD-P4-CANCEL');

  const request = await fetch(`${base}/api/v1/orders/${order._id}/cancellation-request`, {
    method: 'POST',
    headers: authorization(owner._id),
    body: JSON.stringify({ reason: 'Ordered the wrong pack size entirely' }),
  });
  assert.equal(request.status, 200);
  assert.ok((await Order.findById(order._id))!.cancellationRequestedAt);

  const decision = await fetch(`${base}/api/v1/orders/${order._id}/cancellation-decision`, {
    method: 'POST',
    headers: authorization(manager._id),
    body: JSON.stringify({
      approve: true,
      reason: 'Confirmed with the shop by telephone',
      version: 0,
    }),
  });
  assert.equal(decision.status, 200);

  // The transition ORDER_STATE_MACHINE.md has promised since phase 4 of the
  // original build, and which nothing anywhere performed.
  assert.equal((await Order.findById(order._id))!.status, OrderStatus.CANCELLED);
});

test('a shop owner cannot decide their own cancellation', async () => {
  const order = await makeOrder('ORD-P4-SELF');
  await fetch(`${base}/api/v1/orders/${order._id}/cancellation-request`, {
    method: 'POST',
    headers: authorization(owner._id),
    body: JSON.stringify({ reason: 'Changed my mind about this one' }),
  });

  const decision = await fetch(`${base}/api/v1/orders/${order._id}/cancellation-decision`, {
    method: 'POST',
    headers: authorization(owner._id),
    body: JSON.stringify({ approve: true, reason: 'Cancelling it myself', version: 0 }),
  });
  assert.equal(decision.status, 403);
  assert.equal((await Order.findById(order._id))!.status, OrderStatus.SUBMITTED);
});

test('a user can change their own password and stay signed in here', async () => {
  const response = await fetch(`${base}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: authorization(manager._id),
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
  });
  assert.equal(response.status, 200);

  const stored = await User.findById(manager._id).select('+passwordHash');
  assert.equal(await bcrypt.compare(NEW_PASSWORD, stored!.passwordHash), true);
  assert.equal(stored!.forcePasswordChange, false);
});

test('the wrong current password is refused without changing anything', async () => {
  const before = await User.findById(owner._id).select('+passwordHash');

  const response = await fetch(`${base}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: authorization(owner._id),
    body: JSON.stringify({ currentPassword: 'not-my-password', newPassword: NEW_PASSWORD }),
  });
  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    'CURRENT_PASSWORD_INCORRECT',
  );

  const after = await User.findById(owner._id).select('+passwordHash');
  assert.equal(after!.passwordHash, before!.passwordHash);
});

test('a forced user reaches nothing but the password change', async () => {
  // The flag was set on creation and on an administrative reset, returned at
  // sign-in, and checked nowhere at all — so a temporary password was permanent.
  const blocked = await fetch(`${base}/api/v1/orders`, {
    method: 'GET',
    headers: authorization(forced._id),
  });
  assert.equal(blocked.status, 403);
  assert.equal(
    ((await blocked.json()) as { error: { code: string } }).error.code,
    'PASSWORD_CHANGE_REQUIRED',
  );

  // Their own account is readable, or they could not be told who they are.
  const me = await fetch(`${base}/api/v1/users/me`, { headers: authorization(forced._id) });
  assert.equal(me.status, 200);

  const change = await fetch(`${base}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: authorization(forced._id),
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
  });
  assert.equal(change.status, 200);

  // And now the rest of the application opens up.
  const afterwards = await fetch(`${base}/api/v1/orders`, {
    method: 'GET',
    headers: authorization(forced._id),
  });
  assert.equal(afterwards.status, 200);
});
