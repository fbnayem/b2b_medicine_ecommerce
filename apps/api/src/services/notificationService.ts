import { ClientSession, Types } from 'mongoose';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEvent,
  RealtimeEvent,
  UserRole,
} from '@medsupply/shared-types';
import { Notification } from '../models/Notification';
import { NotificationDelivery } from '../models/NotificationDelivery';
import { NotificationPreference } from '../models/NotificationPreference';
import { Shop } from '../models/Shop';
import { User } from '../models/User';
import { channelAdapter, type OutboundMessage } from './notificationChannels';
import { templateFor, type TemplateContext } from './notificationCatalogue';
import {
  deliveryIdempotencyKey,
  notificationDedupeKey,
  resolveChannels,
} from './notificationRules';
import { createJobQueue, type JobQueue } from './jobQueue';
import { emitToUsers } from './realtime';

export interface NotifyInput {
  event: NotificationEvent;
  recipientIds: Array<Types.ObjectId | string>;
  context?: TemplateContext;
  entityType?: string;
  entityId?: Types.ObjectId | string;
  /**
   * Distinguishes repeat occurrences of one event on one entity. Defaults to
   * the entity id, which makes a replayed request idempotent; pass a status,
   * attempt number or timestamp when an event legitimately recurs.
   */
  occurrenceKey?: string;
  correlationId?: string;
  session?: ClientSession;
}

interface DispatchJob {
  deliveryId: string;
}

const QUEUE_NAME = 'notification-dispatch';
/** Gives an enclosing transaction time to commit before the worker reads its rows. */
const TRANSACTIONAL_DISPATCH_DELAY_MS = 500;
/** How far back the sweeper looks for deliveries whose enqueue was lost. */
const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_MIN_AGE_MS = 60_000;

let queue: JobQueue<DispatchJob> | null = null;

export function notificationQueue(): JobQueue<DispatchJob> {
  if (!queue) {
    queue = createJobQueue<DispatchJob>(QUEUE_NAME);
    queue.process(handleDispatchJob);
  }
  return queue;
}

async function unreadSummary(recipientId: Types.ObjectId | string) {
  const rows = await Notification.aggregate<{ _id: string | null; count: number }>([
    {
      $match: {
        recipientId: new Types.ObjectId(String(recipientId)),
        readAt: { $exists: false },
        archivedAt: { $exists: false },
      },
    },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);

  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    total += row.count;
    if (row._id) byCategory[row._id] = row.count;
  }
  return { total, byCategory };
}

export async function emitUnreadCount(recipientId: Types.ObjectId | string) {
  emitToUsers([recipientId], RealtimeEvent.UNREAD_COUNT, await unreadSummary(recipientId));
}

/** Shop Owners frequently have no personal phone; the shop's number is the contactable one. */
async function resolveRecipientContact(userId: string) {
  const user = await User.findById(userId).select('firstName lastName email phone role status');
  if (!user) return null;

  let phone = (user as { phone?: string }).phone;
  if (!phone && user.role === UserRole.SHOP_OWNER) {
    const shop = await Shop.findOne({ ownerIds: user._id }).select('primaryPhone').lean();
    phone = shop?.primaryPhone as string | undefined;
  }

  return {
    id: String(user._id),
    firstName: user.firstName as string,
    lastName: user.lastName as string,
    email: user.email as string | undefined,
    phone,
    active: user.status === 'ACTIVE',
  };
}

async function markDelivery(deliveryId: string, update: Record<string, unknown>, increment = true) {
  await NotificationDelivery.updateOne(
    { _id: deliveryId },
    { $set: update, ...(increment ? { $inc: { attempts: 1 } } : {}) },
  );
}

async function handleDispatchJob(job: DispatchJob) {
  const delivery = await NotificationDelivery.findById(job.deliveryId);
  // Absent means the enclosing transaction aborted; there is nothing to send.
  if (!delivery) return;
  if (delivery.status !== NotificationDeliveryStatus.PENDING) return;

  const notification = await Notification.findById(delivery.notificationId);
  if (!notification) return;

  if (delivery.channel === NotificationChannel.IN_APP) {
    await markDelivery(job.deliveryId, {
      status: NotificationDeliveryStatus.SENT,
      sentAt: new Date(),
      providerReference: 'in-app',
    });
    emitToUsers([delivery.recipientId], RealtimeEvent.NOTIFICATION_CREATED, {
      _id: String(notification._id),
      event: notification.event ?? notification.type,
      type: notification.type,
      category: notification.category,
      priority: notification.priority,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      entityType: notification.entityType,
      entityId: notification.entityId ? String(notification.entityId) : undefined,
      createdAt: notification.createdAt,
    });
    await emitUnreadCount(delivery.recipientId);
    return;
  }

  const adapter = channelAdapter(delivery.channel as NotificationChannel);
  if (!adapter) {
    await markDelivery(job.deliveryId, {
      status: NotificationDeliveryStatus.SUPPRESSED,
      suppressionReason: `No adapter registered for ${delivery.channel}`,
    });
    return;
  }

  const recipient = await resolveRecipientContact(String(delivery.recipientId));
  if (!recipient || !recipient.active) {
    await markDelivery(job.deliveryId, {
      status: NotificationDeliveryStatus.SUPPRESSED,
      suppressionReason: 'Recipient is missing or inactive',
    });
    return;
  }

  const message: OutboundMessage = {
    recipient,
    event: (notification.event ?? notification.type) as NotificationEvent,
    category: notification.category as OutboundMessage['category'],
    priority: notification.priority as OutboundMessage['priority'],
    title: notification.title,
    body: notification.body,
    link: notification.link ?? undefined,
    notificationId: String(notification._id),
    correlationId: notification.correlationId ?? undefined,
  };

  const unavailable = await adapter.unavailableReason(message);
  if (unavailable) {
    await markDelivery(job.deliveryId, {
      status: NotificationDeliveryStatus.SUPPRESSED,
      suppressionReason: unavailable,
    });
    return;
  }

  try {
    const result = await adapter.send(message);
    await markDelivery(job.deliveryId, {
      status: NotificationDeliveryStatus.SENT,
      sentAt: new Date(),
      providerReference: result.providerReference ?? adapter.name,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markDelivery(job.deliveryId, {
      status: NotificationDeliveryStatus.PENDING,
      lastError: reason,
    });
    const attempts = await NotificationDelivery.findById(job.deliveryId).select('attempts').lean();
    if ((attempts?.attempts ?? 0) >= 5) {
      await markDelivery(
        job.deliveryId,
        {
          status: NotificationDeliveryStatus.FAILED,
          failedAt: new Date(),
          lastError: reason,
        },
        false,
      );
      return;
    }
    // Rethrow so the queue applies its shared backoff policy.
    throw error;
  }
}

/**
 * Creates the in-app record for every recipient and queues each enabled
 * channel. Safe to call inside a transaction: rows are written with the caller's
 * session and dispatch is delayed until after the expected commit. A sweeper
 * re-queues anything whose enqueue was lost, so no notification is dropped.
 */
export async function notify(input: NotifyInput): Promise<{ notificationIds: string[] }> {
  const recipientIds = [...new Set(input.recipientIds.filter(Boolean).map(String))];
  if (!recipientIds.length) return { notificationIds: [] };

  const template = templateFor(input.event);
  const context: TemplateContext = { ...input.context };
  const entityId = input.entityId ? String(input.entityId) : undefined;
  const rendered = template.render(context);
  const occurrenceKey = input.occurrenceKey ?? entityId ?? 'singleton';
  const now = new Date();

  const preferences = await NotificationPreference.find({ userId: { $in: recipientIds } })
    .session(input.session ?? null)
    .lean();
  const preferenceByUser = new Map(preferences.map((entry) => [String(entry.userId), entry]));

  const notificationOps = recipientIds.map((recipientId) => {
    const dedupeKey = notificationDedupeKey({
      recipientId,
      event: input.event,
      occurrenceKey,
    });
    return {
      updateOne: {
        filter: { dedupeKey },
        update: {
          $setOnInsert: {
            recipientId: new Types.ObjectId(recipientId),
            type: input.event,
            event: input.event,
            category: template.category,
            priority: template.priority,
            title: rendered.title,
            body: rendered.body,
            link: rendered.link,
            entityType: input.entityType,
            ...(entityId ? { entityId: new Types.ObjectId(entityId) } : {}),
            correlationId: input.correlationId,
            dedupeKey,
            // createdAt/updatedAt are omitted: Mongoose adds its own timestamp
            // $setOnInsert during bulkWrite and duplicating them conflicts.
          },
        },
        upsert: true,
      },
    };
  });

  await Notification.bulkWrite(notificationOps, { session: input.session, ordered: false });

  const dedupeKeys = recipientIds.map((recipientId) =>
    notificationDedupeKey({ recipientId, event: input.event, occurrenceKey }),
  );
  const stored = await Notification.find({ dedupeKey: { $in: dedupeKeys } })
    .select('_id recipientId')
    .session(input.session ?? null)
    .lean();

  const deliveryOps: Array<{
    idempotencyKey: string;
    recipientId: string;
    notificationId: string;
    channel: NotificationChannel;
    status: NotificationDeliveryStatus;
    suppressionReason?: string;
  }> = [];

  for (const record of stored) {
    const recipientId = String(record.recipientId);
    const resolution = resolveChannels({
      template,
      preference: preferenceByUser.get(recipientId) as never,
      at: now,
    });

    for (const channel of resolution.channels) {
      deliveryOps.push({
        idempotencyKey: deliveryIdempotencyKey({
          recipientId,
          event: input.event,
          occurrenceKey,
          channel,
        }),
        recipientId,
        notificationId: String(record._id),
        channel,
        status: NotificationDeliveryStatus.PENDING,
      });
    }
    for (const suppression of resolution.suppressed) {
      deliveryOps.push({
        idempotencyKey: deliveryIdempotencyKey({
          recipientId,
          event: input.event,
          occurrenceKey,
          channel: suppression.channel,
        }),
        recipientId,
        notificationId: String(record._id),
        channel: suppression.channel,
        status: NotificationDeliveryStatus.SUPPRESSED,
        suppressionReason: suppression.reason,
      });
    }
  }

  if (deliveryOps.length) {
    await NotificationDelivery.bulkWrite(
      deliveryOps.map((entry) => ({
        updateOne: {
          filter: { idempotencyKey: entry.idempotencyKey },
          update: {
            $setOnInsert: {
              notificationId: new Types.ObjectId(entry.notificationId),
              recipientId: new Types.ObjectId(entry.recipientId),
              event: input.event,
              channel: entry.channel,
              status: entry.status,
              suppressionReason: entry.suppressionReason,
              attempts: 0,
              idempotencyKey: entry.idempotencyKey,
            },
          },
          upsert: true,
        },
      })),
      { session: input.session, ordered: false },
    );
  }

  const pendingKeys = deliveryOps
    .filter((entry) => entry.status === NotificationDeliveryStatus.PENDING)
    .map((entry) => entry.idempotencyKey);

  if (pendingKeys.length) {
    const pending = await NotificationDelivery.find({ idempotencyKey: { $in: pendingKeys } })
      .select('_id')
      .session(input.session ?? null)
      .lean();
    const delayMs = input.session ? TRANSACTIONAL_DISPATCH_DELAY_MS : 0;
    const jobQueue = notificationQueue();
    await Promise.all(
      pending.map((row) =>
        jobQueue.enqueue({ deliveryId: String(row._id) }, { jobId: String(row._id), delayMs }),
      ),
    );
  }

  return { notificationIds: stored.map((record) => String(record._id)) };
}

/**
 * Re-queues PENDING deliveries whose enqueue was lost to a crash or an
 * in-flight commit. Bounded by age so it never races the fast path.
 */
export async function sweepPendingDeliveries(now = new Date()) {
  const cutoff = new Date(now.getTime() - SWEEP_MIN_AGE_MS);
  const stale = await NotificationDelivery.find({
    status: NotificationDeliveryStatus.PENDING,
    createdAt: { $lte: cutoff },
    attempts: { $lt: 5 },
  })
    .select('_id')
    .limit(200)
    .lean();

  if (!stale.length) return 0;
  const jobQueue = notificationQueue();
  await Promise.all(stale.map((row) => jobQueue.enqueue({ deliveryId: String(row._id) })));
  return stale.length;
}

let sweeper: NodeJS.Timeout | null = null;

export function startNotificationSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    void sweepPendingDeliveries().catch((error) =>
      console.error('[notifications] sweep failed', error),
    );
  }, SWEEP_INTERVAL_MS);
  sweeper.unref?.();
}

export function stopNotificationSweeper() {
  if (!sweeper) return;
  clearInterval(sweeper);
  sweeper = null;
}
