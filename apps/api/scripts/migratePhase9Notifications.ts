import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
  ActivityEntityType,
  NotificationCategory,
  NotificationEvent,
  UserRole,
} from '@medsupply/shared-types';
import { MigrationRun, MigrationRunMode, MigrationRunStatus } from '../src/models/MigrationRun';
import { ActivityEvent } from '../src/models/ActivityEvent';
import { AuditLog } from '../src/models/AuditLog';
import { Notification } from '../src/models/Notification';
import { templateFor } from '../src/services/notificationCatalogue';
import { activityDedupeKey } from '../src/services/notificationRules';

const MIGRATION_ID = 'phase9-notifications-activity-v1';
const KNOWN_ROLES = new Set<UserRole>(Object.values(UserRole));

const AUDIT_BATCH_SIZE = 500;

/**
 * Audit actions that describe a business milestone worth showing on a timeline.
 * Anything absent stays audit-only: the forensic log is not a user-facing feed.
 */
const AUDIT_PROJECTIONS: Record<
  string,
  { category: NotificationCategory; entityType: ActivityEntityType; visibleToShop: boolean }
> = {
  ORDER_SUBMITTED: {
    category: NotificationCategory.ORDER,
    entityType: ActivityEntityType.ORDER,
    visibleToShop: true,
  },
  ORDER_UNDER_REVIEW: {
    category: NotificationCategory.APPROVAL,
    entityType: ActivityEntityType.ORDER,
    visibleToShop: true,
  },
  ORDER_ON_HOLD: {
    category: NotificationCategory.APPROVAL,
    entityType: ActivityEntityType.ORDER,
    visibleToShop: true,
  },
  ORDER_REJECTED: {
    category: NotificationCategory.APPROVAL,
    entityType: ActivityEntityType.ORDER,
    visibleToShop: true,
  },
  ORDER_APPROVED: {
    category: NotificationCategory.APPROVAL,
    entityType: ActivityEntityType.ORDER,
    visibleToShop: true,
  },
  ORDER_CANCELLATION_REQUESTED: {
    category: NotificationCategory.ORDER,
    entityType: ActivityEntityType.ORDER,
    visibleToShop: true,
  },
  PICKING_STARTED: {
    category: NotificationCategory.FULFILMENT,
    entityType: ActivityEntityType.PICKING_LIST,
    visibleToShop: false,
  },
  PICKING_DISCREPANCY_REPORTED: {
    category: NotificationCategory.FULFILMENT,
    entityType: ActivityEntityType.PICKING_LIST,
    visibleToShop: false,
  },
  PICKING_DISCREPANCY_RESOLVED: {
    category: NotificationCategory.FULFILMENT,
    entityType: ActivityEntityType.PICKING_LIST,
    visibleToShop: false,
  },
  PACKING_CONFIRMED_AND_INVOICE_ISSUED: {
    category: NotificationCategory.FINANCE,
    entityType: ActivityEntityType.ORDER,
    visibleToShop: true,
  },
  DELIVERY_ASSIGNED: {
    category: NotificationCategory.DELIVERY,
    entityType: ActivityEntityType.DELIVERY,
    visibleToShop: false,
  },
  DELIVERY_HANDED_OVER: {
    category: NotificationCategory.DELIVERY,
    entityType: ActivityEntityType.DELIVERY,
    visibleToShop: false,
  },
  DELIVERY_PICKED_UP: {
    category: NotificationCategory.DELIVERY,
    entityType: ActivityEntityType.DELIVERY,
    visibleToShop: true,
  },
  DELIVERY_STARTED: {
    category: NotificationCategory.DELIVERY,
    entityType: ActivityEntityType.DELIVERY,
    visibleToShop: true,
  },
  DELIVERY_COMPLETED: {
    category: NotificationCategory.DELIVERY,
    entityType: ActivityEntityType.DELIVERY,
    visibleToShop: true,
  },
  DELIVERY_FAILED: {
    category: NotificationCategory.DELIVERY,
    entityType: ActivityEntityType.DELIVERY,
    visibleToShop: true,
  },
  DELIVERY_RETURNED_TO_STORE: {
    category: NotificationCategory.DELIVERY,
    entityType: ActivityEntityType.DELIVERY,
    visibleToShop: false,
  },
  DELIVERY_CANCELLED: {
    category: NotificationCategory.DELIVERY,
    entityType: ActivityEntityType.DELIVERY,
    visibleToShop: true,
  },
  PAYMENT_POSTED: {
    category: NotificationCategory.FINANCE,
    entityType: ActivityEntityType.PAYMENT,
    visibleToShop: true,
  },
  PAYMENT_FAILED: {
    category: NotificationCategory.FINANCE,
    entityType: ActivityEntityType.PAYMENT,
    visibleToShop: true,
  },
  PAYMENT_REVERSED: {
    category: NotificationCategory.FINANCE,
    entityType: ActivityEntityType.PAYMENT,
    visibleToShop: true,
  },
};

const INTERNAL_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STOREKEEPER,
  UserRole.DELIVERY_PERSON,
];

const isKnownEvent = (value: string): value is NotificationEvent =>
  Object.prototype.hasOwnProperty.call(NotificationEvent, value);

type Scan = {
  scannedAt: string;
  notificationsTotal: number;
  notificationsMissingEvent: number;
  notificationsWithUnknownType: number;
  notificationsMissingDedupeKey: number;
  auditLogsTotal: number;
  auditLogsProjectable: number;
  activityEventsExisting: number;
  unknownNotificationTypes: string[];
};

async function scan(): Promise<Scan> {
  const [
    notificationsTotal,
    notificationsMissingEvent,
    notificationsMissingDedupeKey,
    auditLogsTotal,
    auditLogsProjectable,
    activityEventsExisting,
    distinctTypes,
  ] = await Promise.all([
    Notification.countDocuments({}),
    Notification.countDocuments({ event: { $exists: false } }),
    Notification.countDocuments({ dedupeKey: { $exists: false } }),
    AuditLog.countDocuments({}),
    AuditLog.countDocuments({ action: { $in: Object.keys(AUDIT_PROJECTIONS) } }),
    ActivityEvent.countDocuments({}),
    Notification.distinct('type'),
  ]);

  const unknownNotificationTypes = (distinctTypes as string[]).filter(
    (value) => !isKnownEvent(value),
  );
  const notificationsWithUnknownType = unknownNotificationTypes.length
    ? await Notification.countDocuments({ type: { $in: unknownNotificationTypes } })
    : 0;

  return {
    scannedAt: new Date().toISOString(),
    notificationsTotal,
    notificationsMissingEvent,
    notificationsWithUnknownType,
    notificationsMissingDedupeKey,
    auditLogsTotal,
    auditLogsProjectable,
    activityEventsExisting,
    unknownNotificationTypes,
  };
}

/**
 * Fills `event`, `category` and `priority` on notifications written before
 * Phase 9. Records whose `type` is not in the catalogue are left untouched and
 * reported, never guessed into a category.
 */
async function backfillNotifications() {
  let updated = 0;
  let skipped = 0;

  for (const value of Object.values(NotificationEvent)) {
    const template = templateFor(value);
    const result = await Notification.updateMany(
      { type: value, event: { $exists: false } },
      {
        $set: {
          event: template.event,
          category: template.category,
          priority: template.priority,
        },
      },
    );
    updated += result.modifiedCount;
  }

  skipped = await Notification.countDocuments({ event: { $exists: false } });
  return { updated, skipped };
}

function summaryFor(action: string, log: Record<string, unknown>) {
  const after = (log.after ?? {}) as Record<string, unknown>;
  const reference = after.reference ?? after.orderReference ?? after.invoiceReference;
  const readable = action.replaceAll('_', ' ').toLowerCase();
  return reference ? `${String(reference)}: ${readable}` : readable;
}

/**
 * Projects historical audit records into the timeline. `dedupeKey` is derived
 * from the audit id, so re-running the migration is a no-op rather than a
 * duplicate history.
 */
async function projectAuditHistory(apply: boolean) {
  const filter = { action: { $in: Object.keys(AUDIT_PROJECTIONS) } };
  const total = await AuditLog.countDocuments(filter);
  if (!apply) return { candidates: total, inserted: 0 };

  let inserted = 0;
  let processed = 0;

  while (processed < total) {
    const batch = await AuditLog.find(filter)
      .sort({ _id: 1 })
      .skip(processed)
      .limit(AUDIT_BATCH_SIZE)
      .lean();
    if (!batch.length) break;

    const operations = batch.map((log) => {
      const projection = AUDIT_PROJECTIONS[log.action as string];
      const entityId = log.entityId as mongoose.Types.ObjectId;
      const dedupeKey = activityDedupeKey({
        action: log.action as string,
        entityType: projection.entityType,
        entityId: String(entityId),
        // The audit id is unique, so one audit row yields exactly one timeline row.
        occurrenceKey: `audit:${String(log._id)}`,
      });
      return {
        updateOne: {
          filter: { dedupeKey },
          update: {
            $setOnInsert: {
              action: log.action,
              category: projection.category,
              entityType: projection.entityType,
              entityId,
              ...(projection.entityType === ActivityEntityType.ORDER ? { orderId: entityId } : {}),
              actorId: log.actorId,
              // AuditLog stores the role as a free string; ActivityEvent
              // constrains it to the role enum. The migration reads historical
              // records, so an unrecognised value is possible and is written as
              // absent rather than as an invalid role.
              actorRole: KNOWN_ROLES.has(log.actorRole as UserRole)
                ? (log.actorRole as UserRole)
                : undefined,
              summary: summaryFor(log.action as string, log),
              detail: 'Backfilled from the audit log by the Phase 9 migration.',
              visibleToRoles: INTERNAL_ROLES,
              visibleToShop: projection.visibleToShop,
              correlationId: log.correlationId,
              occurredAt: log.createdAt ?? new Date(),
              dedupeKey,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await ActivityEvent.bulkWrite(operations, { ordered: false });
    inserted += result.upsertedCount;
    processed += batch.length;
  }

  return { candidates: total, inserted };
}

function requestedMode() {
  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run');
  if (apply && dryRun) throw new Error('Choose either --dry-run or --apply, not both.');
  return apply ? MigrationRunMode.APPLY : MigrationRunMode.DRY_RUN;
}

export async function runPhase9NotificationMigration() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required.');
  const mode = requestedMode();
  await mongoose.connect(uri);

  if (mode === MigrationRunMode.DRY_RUN) {
    const before = await scan();
    const projection = await projectAuditHistory(false);
    process.stdout.write(
      `${JSON.stringify({ migrationId: MIGRATION_ID, mode, scan: before, projection }, null, 2)}\n`,
    );
    return;
  }

  await MigrationRun.init();
  const migrationRun = await MigrationRun.create({
    migrationId: MIGRATION_ID,
    runId: randomUUID(),
    mode,
    status: MigrationRunStatus.RUNNING,
    startedAt: new Date(),
  });

  try {
    const before = await scan();
    const notifications = await backfillNotifications();
    const projection = await projectAuditHistory(true);
    const after = await scan();

    migrationRun.status = MigrationRunStatus.COMPLETED;
    migrationRun.completedAt = new Date();
    migrationRun.set('stats', { before, notifications, projection, after });
    await migrationRun.save();

    process.stdout.write(
      `${JSON.stringify(
        { migrationId: MIGRATION_ID, mode, before, notifications, projection, after },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    migrationRun.status = MigrationRunStatus.FAILED;
    migrationRun.completedAt = new Date();
    migrationRun.error = error instanceof Error ? error.message : String(error);
    await migrationRun.save();
    throw error;
  }
}

if (require.main === module) {
  runPhase9NotificationMigration()
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
