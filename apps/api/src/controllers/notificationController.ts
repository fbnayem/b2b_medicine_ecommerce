import { NextFunction, Response } from 'express';
import { Types } from 'mongoose';
import {
  NotificationChannel,
  NotificationEvent,
  OPTIONAL_NOTIFICATION_CHANNELS,
  PushPlatform,
  RealtimeEvent,
} from '@medsupply/shared-types';
import {
  NotificationIdsSchema,
  NotificationListQuerySchema,
  NotificationMarkAllReadSchema,
  NotificationPreferenceUpdateSchema,
  NotificationTestSendSchema,
  PushDeviceRegisterSchema,
  PushDeviceUnregisterSchema,
} from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import { Notification } from '../models/Notification';
import { NotificationDelivery } from '../models/NotificationDelivery';
import { NotificationPreference } from '../models/NotificationPreference';
import { PushDevice } from '../models/PushDevice';
import { allTemplates } from '../services/notificationCatalogue';
import { emitUnreadCount, notify } from '../services/notificationService';
import { emitToUsers } from '../services/realtime';

const viewerId = (req: AuthRequest) => new Types.ObjectId(String(req.user!._id));

export async function listNotifications(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = NotificationListQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { recipientId: viewerId(req) };
    if (query.category) filter.category = query.category;
    if (query.event) filter.event = query.event;
    if (query.unreadOnly) filter.readAt = { $exists: false };
    if (!query.includeArchived) filter.archivedAt = { $exists: false };

    const [items, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Notification.countDocuments(filter),
    ]);

    res.json({ data: items, meta: { total, page: query.page, limit: query.limit } });
  } catch (error) {
    next(error);
  }
}

export async function unreadCount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rows = await Notification.aggregate<{ _id: string | null; count: number }>([
      {
        $match: {
          recipientId: viewerId(req),
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
    res.json({ data: { total, byCategory } });
  } catch (error) {
    next(error);
  }
}

export async function markRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { notificationIds } = NotificationIdsSchema.parse(req.body);
    const result = await Notification.updateMany(
      // Scoped to the caller: one user can never mark another user's notifications.
      { _id: { $in: notificationIds }, recipientId: viewerId(req), readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );
    emitToUsers([viewerId(req)], RealtimeEvent.NOTIFICATION_UPDATED, {
      notificationIds,
      readAt: new Date().toISOString(),
    });
    await emitUnreadCount(viewerId(req));
    res.json({ data: { updated: result.modifiedCount } });
  } catch (error) {
    next(error);
  }
}

export async function markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = NotificationMarkAllReadSchema.parse(req.body ?? {});
    const filter: Record<string, unknown> = {
      recipientId: viewerId(req),
      readAt: { $exists: false },
    };
    if (input.category) filter.category = input.category;
    // Only marks what the client had already seen when it rendered the list.
    if (input.before) filter.createdAt = { $lte: input.before };

    const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
    await emitUnreadCount(viewerId(req));
    res.json({ data: { updated: result.modifiedCount } });
  } catch (error) {
    next(error);
  }
}

export async function archive(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { notificationIds } = NotificationIdsSchema.parse(req.body);
    const now = new Date();
    const result = await Notification.updateMany(
      { _id: { $in: notificationIds }, recipientId: viewerId(req), archivedAt: { $exists: false } },
      { $set: { archivedAt: now, readAt: now } },
    );
    await emitUnreadCount(viewerId(req));
    res.json({ data: { updated: result.modifiedCount } });
  } catch (error) {
    next(error);
  }
}

/** The event catalogue the preferences screen renders from. */
export async function catalogue(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      data: {
        channels: OPTIONAL_NOTIFICATION_CHANNELS,
        events: allTemplates().map((template) => ({
          event: template.event,
          category: template.category,
          priority: template.priority,
          defaultChannels: template.defaultChannels.filter(
            (channel) => channel !== NotificationChannel.IN_APP,
          ),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

const defaultPreference = (userId: Types.ObjectId) => ({
  userId: String(userId),
  defaultChannels: null,
  overrides: [],
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  mutedEvents: [],
});

export async function getPreferences(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const stored = await NotificationPreference.findOne({ userId: viewerId(req) }).lean();
    res.json({ data: stored ?? defaultPreference(viewerId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function updatePreferences(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = NotificationPreferenceUpdateSchema.parse(req.body);
    const update: Record<string, unknown> = {};
    if (input.defaultChannels) update.defaultChannels = input.defaultChannels;
    if (input.overrides) update.overrides = input.overrides;
    if (input.quietHours) update.quietHours = input.quietHours;
    if (input.mutedEvents) update.mutedEvents = input.mutedEvents;

    const saved = await NotificationPreference.findOneAndUpdate(
      { userId: viewerId(req) },
      { $set: update, $setOnInsert: { userId: viewerId(req) } },
      { new: true, upsert: true },
    ).lean();
    res.json({ data: saved });
  } catch (error) {
    next(error);
  }
}

export async function registerDevice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = PushDeviceRegisterSchema.parse(req.body);
    // The token moves to whoever signed in last on that device.
    const device = await PushDevice.findOneAndUpdate(
      { token: input.token },
      {
        $set: {
          userId: viewerId(req),
          platform: input.platform as PushPlatform,
          deviceName: input.deviceName,
          lastSeenAt: new Date(),
        },
        $unset: { disabledAt: 1, disabledReason: 1 },
      },
      { new: true, upsert: true },
    ).lean();
    res.status(201).json({ data: device });
  } catch (error) {
    next(error);
  }
}

export async function unregisterDevice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = PushDeviceUnregisterSchema.parse(req.body);
    const result = await PushDevice.deleteOne({ token: input.token, userId: viewerId(req) });
    res.json({ data: { removed: result.deletedCount } });
  } catch (error) {
    next(error);
  }
}

/** Channel attempt rows for one notification. Admin-only operational visibility. */
export async function deliveries(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rows = await NotificationDelivery.find({ notificationId: req.params.id })
      .sort({ createdAt: 1 })
      .lean();
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
}

/** Verifies a channel end to end without waiting for a business event. */
export async function testSend(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = NotificationTestSendSchema.parse(req.body);
    const result = await notify({
      event: input.event as NotificationEvent,
      recipientIds: [input.recipientId],
      context: { reference: 'TEST', note: input.note, reason: input.note },
      entityType: 'User',
      entityId: input.recipientId,
      occurrenceKey: `TEST:${Date.now()}`,
    });
    res.status(202).json({ data: { notificationIds: result.notificationIds } });
  } catch (error) {
    next(error);
  }
}
