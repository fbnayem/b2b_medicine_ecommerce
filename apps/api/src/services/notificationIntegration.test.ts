import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  ActivityEntityType,
  NotificationCategory,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEvent,
  NotificationPriority,
  PushPlatform,
  ShopStatus,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { ActivityEvent } from '../models/ActivityEvent';
import { Notification } from '../models/Notification';
import { NotificationDelivery } from '../models/NotificationDelivery';
import { NotificationPreference } from '../models/NotificationPreference';
import { PushDevice } from '../models/PushDevice';
import { Shop } from '../models/Shop';
import { User } from '../models/User';
import { notificationQueue, notify, sweepPendingDeliveries } from './notificationService';
import { recordActivity } from './activityService';
import {
  registerChannelAdapter,
  type ChannelAdapter,
  type OutboundMessage,
} from './notificationChannels';

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const sentEmails: OutboundMessage[] = [];
const sentPushes: OutboundMessage[] = [];

/** Recording adapters keep the assertions about real dispatch, not about mocks of it. */
class RecordingAdapter implements ChannelAdapter {
  constructor(
    readonly channel: NotificationChannel,
    readonly name: string,
    private readonly sink: OutboundMessage[],
    private readonly requiresContact: 'email' | 'phone' | null,
  ) {}

  async unavailableReason(message: OutboundMessage) {
    if (this.requiresContact === 'email' && !message.recipient.email) return 'No email on record';
    if (this.requiresContact === 'phone' && !message.recipient.phone) return 'No phone on record';
    return null;
  }

  async send(message: OutboundMessage) {
    this.sink.push(message);
    return { providerReference: `${this.channel}-${this.sink.length}` };
  }
}

function authorization(userId: Types.ObjectId) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`,
  };
}

async function createUser(overrides: Record<string, unknown>) {
  return User.create({
    passwordHash: 'x',
    firstName: 'Test',
    lastName: 'User',
    status: UserStatus.ACTIVE,
    ...overrides,
  });
}

/** Runs every queued dispatch job to completion before assertions read the rows. */
async function settleQueue() {
  await notificationQueue().drain();
}

before(async () => {
  const uri = process.env.MONGODB_TEST_URI
    ? process.env.MONGODB_TEST_URI
    : await (async () => {
        memoryReplica = await MongoMemoryReplSet.create({
          replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
        });
        return memoryReplica.getUri('medsupply_notifications');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([
    ActivityEvent.init(),
    Notification.init(),
    NotificationDelivery.init(),
    NotificationPreference.init(),
    PushDevice.init(),
    Shop.init(),
    User.init(),
  ]);

  registerChannelAdapter(
    new RecordingAdapter(NotificationChannel.EMAIL, 'TEST_EMAIL', sentEmails, 'email'),
  );
  registerChannelAdapter(
    new RecordingAdapter(NotificationChannel.PUSH, 'TEST_PUSH', sentPushes, null),
  );

  await new Promise<void>((resolve) => {
    const runningServer = app.listen(0, '127.0.0.1', () => {
      const address = runningServer.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server = runningServer;
  });
});

after(async () => {
  await notificationQueue().close();
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  await mongoose.disconnect();
  await memoryReplica?.stop();
});

test('a notification writes one in-app record plus one delivery row per channel', async () => {
  const manager = await createUser({ email: 'm1@test.local', role: UserRole.MANAGER });
  const { notificationIds } = await notify({
    event: NotificationEvent.ORDER_APPROVED,
    recipientIds: [manager._id],
    context: {
      reference: 'ORD-2026-000001',
      status: 'APPROVED',
      orderId: String(new Types.ObjectId()),
    },
    entityType: 'Order',
    entityId: new Types.ObjectId(),
    occurrenceKey: 'approved-1',
  });
  await settleQueue();

  assert.equal(notificationIds.length, 1);
  const stored = await Notification.findById(notificationIds[0]).lean();
  assert.equal(stored?.event, NotificationEvent.ORDER_APPROVED);
  assert.equal(stored?.type, NotificationEvent.ORDER_APPROVED);
  assert.equal(stored?.category, NotificationCategory.APPROVAL);
  assert.equal(stored?.priority, NotificationPriority.HIGH);
  assert.match(stored?.title ?? '', /ORD-2026-000001/);

  const rows = await NotificationDelivery.find({ notificationId: notificationIds[0] }).lean();
  // One row per channel: enabled ones sent, the rest recorded as suppressed.
  assert.equal(rows.length, 5);
  const inApp = rows.find((row) => row.channel === NotificationChannel.IN_APP);
  assert.equal(inApp?.status, NotificationDeliveryStatus.SENT);
  const email = rows.find((row) => row.channel === NotificationChannel.EMAIL);
  assert.equal(email?.status, NotificationDeliveryStatus.SENT);
  const sms = rows.find((row) => row.channel === NotificationChannel.SMS);
  assert.equal(sms?.status, NotificationDeliveryStatus.SUPPRESSED);
  assert.match(sms?.suppressionReason ?? '', /preference/i);
  assert.ok(sentEmails.some((message) => message.recipient.id === String(manager._id)));
});

test('replaying the same occurrence creates no second notification or delivery', async () => {
  const manager = await createUser({ email: 'm2@test.local', role: UserRole.MANAGER });
  const entityId = new Types.ObjectId();
  const input = () => ({
    event: NotificationEvent.PICKING_READY,
    recipientIds: [manager._id],
    context: { reference: 'ORD-2026-000002' },
    entityType: 'Order',
    entityId,
    occurrenceKey: 'ready-1',
  });

  const first = await notify(input());
  const second = await notify(input());
  await settleQueue();

  assert.deepEqual(first.notificationIds, second.notificationIds);
  assert.equal(await Notification.countDocuments({ recipientId: manager._id }), 1);
  const rows = await NotificationDelivery.countDocuments({ recipientId: manager._id });
  assert.equal(rows, 5);
});

test('muting an event keeps the in-app record and suppresses every other channel', async () => {
  const manager = await createUser({ email: 'm3@test.local', role: UserRole.MANAGER });
  await NotificationPreference.create({
    userId: manager._id,
    mutedEvents: [NotificationEvent.PACKING_SHORTFALL],
  });

  await notify({
    event: NotificationEvent.PACKING_SHORTFALL,
    recipientIds: [manager._id],
    context: { reference: 'ORD-2026-000003' },
    entityType: 'Order',
    entityId: new Types.ObjectId(),
    occurrenceKey: 'shortfall-1',
  });
  await settleQueue();

  const rows = await NotificationDelivery.find({
    recipientId: manager._id,
    event: NotificationEvent.PACKING_SHORTFALL,
  }).lean();
  const sent = rows.filter((row) => row.status === NotificationDeliveryStatus.SENT);
  assert.deepEqual(
    sent.map((row) => row.channel),
    [NotificationChannel.IN_APP],
  );
  assert.equal(await Notification.countDocuments({ recipientId: manager._id }), 1);
  assert.ok(!sentEmails.some((message) => message.recipient.id === String(manager._id)));
});

test('the notification inbox is isolated, countable and markable per recipient', async () => {
  const [ownerA, ownerB] = await Promise.all([
    createUser({ email: 'inbox-a@test.local', role: UserRole.SHOP_OWNER }),
    createUser({ email: 'inbox-b@test.local', role: UserRole.SHOP_OWNER }),
  ]);
  await notify({
    event: NotificationEvent.ORDER_SUBMITTED,
    recipientIds: [ownerA._id],
    context: { reference: 'ORD-2026-000004', shopName: 'Shop A' },
    entityType: 'Order',
    entityId: new Types.ObjectId(),
    occurrenceKey: 'inbox-a',
  });
  await settleQueue();

  const listA = await fetch(`${base}/api/v1/notifications`, { headers: authorization(ownerA._id) });
  const bodyA = (await listA.json()) as { data: Array<{ _id: string }>; meta: { total: number } };
  assert.equal(listA.status, 200);
  assert.equal(bodyA.meta.total, 1);

  const listB = await fetch(`${base}/api/v1/notifications`, { headers: authorization(ownerB._id) });
  const bodyB = (await listB.json()) as { meta: { total: number } };
  assert.equal(bodyB.meta.total, 0);

  // Owner B may not mark Owner A's notification read.
  const crossMark = await fetch(`${base}/api/v1/notifications/read`, {
    method: 'POST',
    headers: authorization(ownerB._id),
    body: JSON.stringify({ notificationIds: [bodyA.data[0]._id] }),
  });
  assert.equal(crossMark.status, 200);
  assert.equal(((await crossMark.json()) as { data: { updated: number } }).data.updated, 0);
  assert.equal((await Notification.findById(bodyA.data[0]._id).lean())?.readAt ?? null, null);

  const countBefore = await fetch(`${base}/api/v1/notifications/unread-count`, {
    headers: authorization(ownerA._id),
  });
  assert.equal(((await countBefore.json()) as { data: { total: number } }).data.total, 1);

  const mark = await fetch(`${base}/api/v1/notifications/read`, {
    method: 'POST',
    headers: authorization(ownerA._id),
    body: JSON.stringify({ notificationIds: [bodyA.data[0]._id] }),
  });
  assert.equal(((await mark.json()) as { data: { updated: number } }).data.updated, 1);

  const countAfter = await fetch(`${base}/api/v1/notifications/unread-count`, {
    headers: authorization(ownerA._id),
  });
  assert.equal(((await countAfter.json()) as { data: { total: number } }).data.total, 0);
});

test('saved preferences change which channels a later notification uses', async () => {
  const storekeeper = await createUser({ email: 'pref@test.local', role: UserRole.STOREKEEPER });
  const update = await fetch(`${base}/api/v1/notifications/preferences`, {
    method: 'PUT',
    headers: authorization(storekeeper._id),
    body: JSON.stringify({
      defaultChannels: ['EMAIL'],
      quietHours: { enabled: false, start: '22:00', end: '07:00' },
    }),
  });
  assert.equal(update.status, 200);

  await notify({
    event: NotificationEvent.PICKING_READY,
    recipientIds: [storekeeper._id],
    context: { reference: 'ORD-2026-000005' },
    entityType: 'Order',
    entityId: new Types.ObjectId(),
    occurrenceKey: 'pref-1',
  });
  await settleQueue();

  const rows = await NotificationDelivery.find({ recipientId: storekeeper._id }).lean();
  const sentChannels = rows
    .filter((row) => row.status === NotificationDeliveryStatus.SENT)
    .map((row) => row.channel)
    .sort();
  // The template defaults to PUSH; the saved preference replaces it with EMAIL.
  assert.deepEqual(sentChannels, [NotificationChannel.EMAIL, NotificationChannel.IN_APP]);
});

test('push registration moves a token between users and reaches only active devices', async () => {
  const [driverA, driverB] = await Promise.all([
    createUser({ email: 'drive-a@test.local', role: UserRole.DELIVERY_PERSON }),
    createUser({ email: 'drive-b@test.local', role: UserRole.DELIVERY_PERSON }),
  ]);
  const token = 'ExponentPushToken[phase9-shared-device]';

  const first = await fetch(`${base}/api/v1/notifications/devices`, {
    method: 'POST',
    headers: authorization(driverA._id),
    body: JSON.stringify({ token, platform: PushPlatform.ANDROID, deviceName: 'Pixel' }),
  });
  assert.equal(first.status, 201);

  const second = await fetch(`${base}/api/v1/notifications/devices`, {
    method: 'POST',
    headers: authorization(driverB._id),
    body: JSON.stringify({ token, platform: PushPlatform.ANDROID }),
  });
  assert.equal(second.status, 201);
  assert.equal(await PushDevice.countDocuments({ token }), 1);
  assert.equal(String((await PushDevice.findOne({ token }).lean())?.userId), String(driverB._id));

  const before = sentPushes.length;
  await notify({
    event: NotificationEvent.DELIVERY_ASSIGNED,
    recipientIds: [driverB._id],
    context: { reference: 'DEL-2026-000001', date: '2026-08-02' },
    entityType: 'Delivery',
    entityId: new Types.ObjectId(),
    occurrenceKey: 'assigned-1',
  });
  await settleQueue();
  assert.equal(sentPushes.length, before + 1);
  assert.equal(sentPushes.at(-1)?.recipient.id, String(driverB._id));

  const removed = await fetch(`${base}/api/v1/notifications/devices`, {
    method: 'DELETE',
    headers: authorization(driverB._id),
    body: JSON.stringify({ token }),
  });
  assert.equal(((await removed.json()) as { data: { removed: number } }).data.removed, 1);
});

test('a rejected token registration never reaches the push provider', async () => {
  const driver = await createUser({ email: 'drive-c@test.local', role: UserRole.DELIVERY_PERSON });
  const response = await fetch(`${base}/api/v1/notifications/devices`, {
    method: 'POST',
    headers: authorization(driver._id),
    body: JSON.stringify({ token: 'raw-fcm-token', platform: PushPlatform.ANDROID }),
  });
  assert.equal(response.status, 400);
  assert.equal(await PushDevice.countDocuments({ userId: driver._id }), 0);
});

test('the activity timeline is visibility filtered for shop owners and internal roles', async () => {
  const [ownerA, ownerB, manager] = await Promise.all([
    createUser({ email: 'tl-a@test.local', role: UserRole.SHOP_OWNER }),
    createUser({ email: 'tl-b@test.local', role: UserRole.SHOP_OWNER }),
    createUser({ email: 'tl-m@test.local', role: UserRole.MANAGER }),
  ]);
  const [shopA, shopB] = await Shop.create([
    {
      reference: 'SHP-TL-A',
      name: 'Timeline A',
      ownerIds: [ownerA._id],
      primaryPhone: '01712345678',
      status: ShopStatus.ACTIVE,
      deliveryAddresses: [],
    },
    {
      reference: 'SHP-TL-B',
      name: 'Timeline B',
      ownerIds: [ownerB._id],
      primaryPhone: '01712345679',
      status: ShopStatus.ACTIVE,
      deliveryAddresses: [],
    },
  ]);

  const orderId = new Types.ObjectId();
  await recordActivity({
    action: 'ORDER_SUBMITTED',
    category: NotificationCategory.ORDER,
    entityType: ActivityEntityType.ORDER,
    entityId: orderId,
    orderId,
    shopId: shopA._id,
    summary: 'Order submitted by Timeline A',
    visibleToRoles: [UserRole.MANAGER, UserRole.ADMIN],
    visibleToShop: true,
    occurrenceKey: 'tl-submitted',
  });
  await recordActivity({
    action: 'ORDER_INTERNAL_NOTE',
    category: NotificationCategory.APPROVAL,
    entityType: ActivityEntityType.ORDER,
    entityId: orderId,
    orderId,
    shopId: shopA._id,
    summary: 'Internal credit assessment recorded',
    visibleToRoles: [UserRole.MANAGER],
    visibleToShop: false,
    occurrenceKey: 'tl-internal',
  });

  const query = `entityType=Order&entityId=${orderId}`;
  const asOwnerA = await fetch(`${base}/api/v1/activity/timeline?${query}`, {
    headers: authorization(ownerA._id),
  });
  const ownerAItems = ((await asOwnerA.json()) as { data: Array<{ action: string }> }).data;
  assert.deepEqual(
    ownerAItems.map((item) => item.action),
    ['ORDER_SUBMITTED'],
  );

  const asOwnerB = await fetch(`${base}/api/v1/activity/timeline?${query}`, {
    headers: authorization(ownerB._id),
  });
  assert.equal(((await asOwnerB.json()) as { data: unknown[] }).data.length, 0);
  assert.ok(shopB);

  const asManager = await fetch(`${base}/api/v1/activity/timeline?${query}`, {
    headers: authorization(manager._id),
  });
  const managerItems = ((await asManager.json()) as { data: Array<{ action: string }> }).data;
  assert.equal(managerItems.length, 2);
});

test('activity records are append-only and deduplicated by occurrence', async () => {
  const entityId = new Types.ObjectId();
  const input = {
    action: 'DELIVERY_COMPLETED',
    category: NotificationCategory.DELIVERY,
    entityType: ActivityEntityType.DELIVERY,
    entityId,
    summary: 'Delivery completed',
    occurrenceKey: 'dedupe-1',
  } as const;

  await recordActivity({ ...input });
  await recordActivity({ ...input, summary: 'A different summary for the same occurrence' });

  const rows = await ActivityEvent.find({ entityId }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].summary, 'Delivery completed');
});

test('the sweeper re-queues a pending delivery whose dispatch was lost', async () => {
  const manager = await createUser({ email: 'sweep@test.local', role: UserRole.MANAGER });
  const notification = await Notification.create({
    recipientId: manager._id,
    type: NotificationEvent.INVOICE_ISSUED,
    event: NotificationEvent.INVOICE_ISSUED,
    category: NotificationCategory.FINANCE,
    priority: NotificationPriority.NORMAL,
    title: 'Invoice INV-2026-000009 issued',
    body: 'The order is packed and invoiced.',
  });
  // Simulates a process that died between writing the row and enqueuing the job.
  const orphan = await NotificationDelivery.create({
    notificationId: notification._id,
    recipientId: manager._id,
    event: NotificationEvent.INVOICE_ISSUED,
    channel: NotificationChannel.EMAIL,
    status: NotificationDeliveryStatus.PENDING,
    attempts: 0,
    idempotencyKey: `sweep-test-${notification._id}`,
    createdAt: new Date(Date.now() - 120_000),
  });

  const requeued = await sweepPendingDeliveries();
  await settleQueue();

  assert.ok(requeued >= 1);
  const settled = await NotificationDelivery.findById(orphan._id).lean();
  assert.equal(settled?.status, NotificationDeliveryStatus.SENT);
});

test('the admin test-send endpoint is closed to non-admin roles', async () => {
  const [manager, admin, target] = await Promise.all([
    createUser({ email: 'ts-m@test.local', role: UserRole.MANAGER }),
    createUser({ email: 'ts-a@test.local', role: UserRole.ADMIN }),
    createUser({ email: 'ts-t@test.local', role: UserRole.STOREKEEPER }),
  ]);
  const payload = JSON.stringify({
    recipientId: String(target._id),
    event: NotificationEvent.PICKING_READY,
    channels: ['IN_APP'],
    note: 'Phase 9 channel check',
  });

  const denied = await fetch(`${base}/api/v1/notifications/test`, {
    method: 'POST',
    headers: authorization(manager._id),
    body: payload,
  });
  assert.equal(denied.status, 403);

  const allowed = await fetch(`${base}/api/v1/notifications/test`, {
    method: 'POST',
    headers: authorization(admin._id),
    body: payload,
  });
  assert.equal(allowed.status, 202);
  await settleQueue();
  assert.equal(await Notification.countDocuments({ recipientId: target._id }), 1);
});
