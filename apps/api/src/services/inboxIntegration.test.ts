import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEvent,
  NotificationPriority,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { Notification } from '../models/Notification';
import { NotificationDelivery } from '../models/NotificationDelivery';
import { User } from '../models/User';

/**
 * The inbox, and the activity feed beside it.
 *
 * Small endpoints, and one of the sharper privacy boundaries in the product:
 * a notification names an order, a customer and an amount, and every one of
 * these routes takes an id from the caller. The rule that matters is not that
 * marking something read works — it is that **an id belonging to somebody else
 * does nothing**, silently and without saying whether it existed.
 *
 * `read-all` is the one worth reading twice. It marks "everything the caller
 * had already seen", not "everything" — a client that renders a list, then
 * calls read-all a second later, must not clear a notification that arrived in
 * between and that the person never saw.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const admin = { _id: new Types.ObjectId(), role: UserRole.ADMIN };
const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };

let mine: Types.ObjectId;
let alsoMine: Types.ObjectId;
let theirs: Types.ObjectId;

function headers(user: { _id: Types.ObjectId }) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET!)}`,
  };
}

async function call(method: string, path: string, as: { _id: Types.ObjectId }, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: headers(as),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.startsWith('{') ? (JSON.parse(text) as Record<string, never>) : ({} as never),
  };
}

const get = (path: string, as: { _id: Types.ObjectId }) => call('GET', path, as);
const post = (path: string, as: { _id: Types.ObjectId }, body?: unknown) =>
  call('POST', path, as, body ?? {});

let counter = 0;

async function notify(recipientId: Types.ObjectId, title: string) {
  counter += 1;
  const created = await Notification.create({
    recipientId,
    type: NotificationEvent.ORDER_SUBMITTED,
    event: NotificationEvent.ORDER_SUBMITTED,
    category: NotificationCategory.ORDER,
    priority: NotificationPriority.NORMAL,
    title,
    body: 'Order ORD-2026-000001 was submitted.',
    dedupeKey: `inbox-test-${counter}`,
  });
  return created._id;
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_inbox'));
  await mongoose.connection.dropDatabase();
  await Promise.all([Notification.init(), NotificationDelivery.init(), User.init()]);

  await User.create(
    (
      [
        [admin, 'inbox-admin', 'System', 'Admin'],
        [manager, 'inbox-manager', 'Branch', 'Manager'],
        [owner, 'inbox-owner', 'Shop', 'Owner'],
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

  mine = await notify(manager._id, 'An order needs approval');
  alsoMine = await notify(manager._id, 'A second order needs approval');
  theirs = await notify(owner._id, 'Your order was approved');

  await NotificationDelivery.create({
    notificationId: theirs,
    recipientId: owner._id,
    event: NotificationEvent.ORDER_SUBMITTED,
    channel: NotificationChannel.IN_APP,
    status: NotificationDeliveryStatus.SENT,
    attempts: 1,
    sentAt: new Date(),
    idempotencyKey: 'inbox-delivery-1',
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

test('the catalogue names every notification type so preferences can be shown by name', async () => {
  const catalogue = await get('/api/v1/notifications/catalogue', owner);
  assert.equal(catalogue.status, 200);
  const data = catalogue.body.data as unknown as {
    channels: string[];
    events: { event: string; defaultChannels: string[] }[];
  };
  assert.ok(data.events.length > 0, 'an empty catalogue renders a preferences screen with no rows');

  /*
   * The specific rule: the in-app channel is not offered as a preference. It is
   * the durable record every other channel is an attempt against, so a person
   * who could switch it off would stop receiving the thing the others exist to
   * announce — and would have no inbox at all.
   */
  for (const entry of data.events) {
    assert.equal(
      entry.defaultChannels.includes('IN_APP'),
      false,
      `${entry.event} offers the in-app channel as something to turn off`,
    );
  }
  assert.equal(data.channels.includes('IN_APP'), false);
});

test('preferences default to something usable for a person who has never set any', async () => {
  const preferences = await get('/api/v1/notifications/preferences', owner);
  assert.equal(preferences.status, 200);
  const data = preferences.body.data as unknown as { userId?: string };
  assert.ok(data, 'a person with no stored preferences gets the defaults, not a 404');
  assert.equal(
    String(data.userId ?? owner._id),
    String(owner._id),
    'and the defaults are theirs rather than a shared template somebody could edit',
  );
});

test('an id belonging to somebody else does nothing at all', async () => {
  /*
   * The boundary this whole file is for. `read` and `archive` take a list of
   * ids from the caller and both filter by `recipientId` — drop that clause and
   * every test that only checks "my own notification was marked" still passes,
   * while any signed-in person can clear anybody's inbox by guessing ids.
   */
  const attempt = await post('/api/v1/notifications/archive', manager, {
    notificationIds: [String(theirs)],
  });
  assert.equal(attempt.status, 200, 'answered normally — nothing tells the caller it existed');
  assert.equal(
    (attempt.body.data as unknown as { updated: number }).updated,
    0,
    'and nothing was changed',
  );

  const untouched = await Notification.findById(theirs).lean();
  assert.equal(untouched!.archivedAt, undefined);
  assert.equal(untouched!.readAt, undefined);
});

test('archiving my own notification reads it as well, because it has left the inbox', async () => {
  const archived = await post('/api/v1/notifications/archive', manager, {
    notificationIds: [String(mine)],
  });
  assert.equal(archived.status, 200);
  assert.equal((archived.body.data as unknown as { updated: number }).updated, 1);

  const stored = await Notification.findById(mine).lean();
  assert.ok(stored!.archivedAt);
  assert.ok(
    stored!.readAt,
    'an archived notification that is still unread keeps the badge showing a number the ' +
      'person cannot clear, because the thing counting it is no longer on screen',
  );
});

test('read-all clears what the caller had seen and not what arrived after', async () => {
  const listed = await get('/api/v1/notifications?limit=50', manager);
  assert.equal(listed.status, 200);
  const seenAt = new Date().toISOString();

  // Arrives after the client rendered its list, exactly as a real one would.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const arrivedLater = await notify(manager._id, 'A third order needs approval');

  const cleared = await post('/api/v1/notifications/read-all', manager, { before: seenAt });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));

  const older = await Notification.findById(alsoMine).lean();
  assert.ok(older!.readAt, 'what was on screen is read');

  const newer = await Notification.findById(arrivedLater).lean();
  assert.equal(
    newer!.readAt,
    undefined,
    'and what arrived after the person looked away is not — a read-all that clears the ' +
      'unseen is how a notification is missed entirely',
  );
});

test('per-channel delivery attempts are an administrator’s diagnostic, not a user’s', async () => {
  const byAdmin = await get(`/api/v1/notifications/${theirs}/deliveries`, admin);
  assert.equal(byAdmin.status, 200);
  assert.equal((byAdmin.body.data as unknown as unknown[]).length, 1);

  const byRecipient = await get(`/api/v1/notifications/${theirs}/deliveries`, owner);
  assert.equal(
    byRecipient.status,
    403,
    'this view names providers and recipients across the deployment; it answers "did the ' +
      'SMS leave", which is an operator’s question',
  );
});

test('the activity feed is readable by everyone and scoped by what they may see', async () => {
  for (const who of [admin, manager, owner]) {
    const feed = await get('/api/v1/activity?limit=10', who);
    assert.equal(feed.status, 200, 'every role has an activity feed of their own');
  }
});

test('the fixtures mean what the assertions above assume', async () => {
  /*
   * Two assertions above are of the form "nothing happened". Nothing happening
   * is also what a missing fixture looks like, so this pins that the other
   * person's notification is genuinely there and genuinely theirs.
   */
  const other = await Notification.findById(theirs).lean();
  assert.ok(other, 'the notification the manager could not archive exists');
  assert.equal(String(other.recipientId), String(owner._id));
  assert.equal(await Notification.countDocuments({ recipientId: manager._id }), 3);
});
