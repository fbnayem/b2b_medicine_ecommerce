import { ClientSession, Types } from 'mongoose';
import {
  ActivityEntityType,
  NotificationCategory,
  RealtimeEvent,
  UserRole,
} from '@medsupply/shared-types';
import { ActivityEvent } from '../models/ActivityEvent';
import { Shop } from '../models/Shop';
import { activityDedupeKey } from './notificationRules';
import { emitToRoles, emitToShop } from './realtime';
import { MANAGEMENT_ROLES } from './notificationAudience';

/** Mongoose 9 does not re-export FilterQuery; a plain condition object is enough here. */
type QueryFilter = Record<string, unknown>;

export interface ActivityActor {
  _id: Types.ObjectId | string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
}

export interface RecordActivityInput {
  action: string;
  category: NotificationCategory;
  entityType: ActivityEntityType;
  entityId: Types.ObjectId | string;
  summary: string;
  detail?: string;
  orderId?: Types.ObjectId | string;
  shopId?: Types.ObjectId | string;
  actor?: ActivityActor | null;
  metadata?: Record<string, string | number | boolean>;
  /** Roles allowed to read the event. Defaults to every internal role. */
  visibleToRoles?: UserRole[];
  /** Whether owners of `shopId` may read it. Defaults to false. */
  visibleToShop?: boolean;
  occurrenceKey?: string;
  correlationId?: string;
  occurredAt?: Date;
  session?: ClientSession;
}

const INTERNAL_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STOREKEEPER,
  UserRole.DELIVERY_PERSON,
];

const actorName = (actor?: ActivityActor | null) =>
  actor
    ? [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim() || undefined
    : undefined;

/**
 * Appends one timeline entry. Idempotent through `dedupeKey`, so retried
 * transactions and the historical backfill cannot duplicate history.
 */
export async function recordActivity(input: RecordActivityInput) {
  const entityId = String(input.entityId);
  const dedupeKey = activityDedupeKey({
    action: input.action,
    entityType: input.entityType,
    entityId,
    occurrenceKey: input.occurrenceKey ?? String(input.occurredAt?.getTime() ?? Date.now()),
  });

  const occurredAt = input.occurredAt ?? new Date();
  const visibleToRoles = input.visibleToRoles ?? INTERNAL_ROLES;

  await ActivityEvent.updateOne(
    { dedupeKey },
    {
      $setOnInsert: {
        action: input.action,
        category: input.category,
        entityType: input.entityType,
        entityId: new Types.ObjectId(entityId),
        ...(input.orderId ? { orderId: new Types.ObjectId(String(input.orderId)) } : {}),
        ...(input.shopId ? { shopId: new Types.ObjectId(String(input.shopId)) } : {}),
        ...(input.actor ? { actorId: new Types.ObjectId(String(input.actor._id)) } : {}),
        actorName: actorName(input.actor),
        actorRole: input.actor?.role,
        summary: input.summary,
        detail: input.detail,
        metadata: input.metadata,
        visibleToRoles,
        visibleToShop: input.visibleToShop ?? false,
        correlationId: input.correlationId,
        occurredAt,
        dedupeKey,
      },
    },
    { upsert: true, session: input.session },
  );

  // Emitted optimistically; a rolled-back transaction leaves no readable row,
  // so a client that refetches sees the correct timeline.
  const payload = {
    action: input.action,
    category: input.category,
    entityType: input.entityType,
    entityId,
    orderId: input.orderId ? String(input.orderId) : undefined,
    shopId: input.shopId ? String(input.shopId) : undefined,
    summary: input.summary,
    occurredAt: occurredAt.toISOString(),
  };
  emitToRoles(visibleToRoles, RealtimeEvent.ACTIVITY_CREATED, payload);
  if (input.visibleToShop && input.shopId) {
    emitToShop(String(input.shopId), RealtimeEvent.ACTIVITY_CREATED, payload);
  }
}

export interface TimelineViewer {
  _id: Types.ObjectId | string;
  role: UserRole;
}

async function viewerShopIds(viewer: TimelineViewer): Promise<Types.ObjectId[]> {
  if (viewer.role !== UserRole.SHOP_OWNER) return [];
  const shops = await Shop.find({ ownerIds: viewer._id }).select('_id').lean();
  return shops.map((shop) => shop._id as Types.ObjectId);
}

/**
 * Restricts a query to what the viewer may read. Shop Owners see only
 * shop-visible events for shops they own; internal roles see events their role
 * is listed on.
 */
async function visibilityFilter(viewer: TimelineViewer): Promise<QueryFilter> {
  if (viewer.role === UserRole.SHOP_OWNER) {
    const shopIds = await viewerShopIds(viewer);
    if (!shopIds.length) return { _id: { $exists: false } };
    return { visibleToShop: true, shopId: { $in: shopIds } };
  }
  return { visibleToRoles: viewer.role };
}

function entityScopeFilter(entityType: ActivityEntityType, entityId: string): QueryFilter {
  const id = new Types.ObjectId(entityId);
  if (entityType === ActivityEntityType.ORDER) {
    // An order timeline absorbs its delivery, invoice and payment events.
    return { $or: [{ entityType, entityId: id }, { orderId: id }] };
  }
  if (entityType === ActivityEntityType.SHOP) {
    return { $or: [{ entityType, entityId: id }, { shopId: id }] };
  }
  return { entityType, entityId: id };
}

export interface TimelineQuery {
  entityType: ActivityEntityType;
  entityId: string;
  page: number;
  limit: number;
}

export async function entityTimeline(viewer: TimelineViewer, query: TimelineQuery) {
  const filter = {
    $and: [entityScopeFilter(query.entityType, query.entityId), await visibilityFilter(viewer)],
  };
  const [items, total] = await Promise.all([
    ActivityEvent.find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    ActivityEvent.countDocuments(filter),
  ]);
  return { items, total, page: query.page, limit: query.limit };
}

export interface FeedQuery {
  page: number;
  limit: number;
  category?: NotificationCategory;
  shopId?: string;
  from?: Date;
  to?: Date;
}

export async function activityFeed(viewer: TimelineViewer, query: FeedQuery) {
  const conditions: QueryFilter[] = [await visibilityFilter(viewer)];
  if (query.category) conditions.push({ category: query.category });
  if (query.shopId) conditions.push({ shopId: new Types.ObjectId(query.shopId) });
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = query.from;
    if (query.to) range.$lte = query.to;
    conditions.push({ occurredAt: range });
  }

  const filter = { $and: conditions };
  const [items, total] = await Promise.all([
    ActivityEvent.find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    ActivityEvent.countDocuments(filter),
  ]);
  return { items, total, page: query.page, limit: query.limit };
}

/** Shared visibility presets so call sites stay consistent. */
export const ActivityVisibility = {
  internal: INTERNAL_ROLES,
  management: MANAGEMENT_ROLES,
  fulfilment: [...MANAGEMENT_ROLES, UserRole.STOREKEEPER],
  delivery: [...MANAGEMENT_ROLES, UserRole.DELIVERY_PERSON, UserRole.STOREKEEPER],
  /** A return passes through collection and the warehouse before finance sees it. */
  returns: [...MANAGEMENT_ROLES, UserRole.STOREKEEPER, UserRole.DELIVERY_PERSON],
};
