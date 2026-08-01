import { NotificationEvent, UserRole } from '@medsupply/shared-types';
import { MedicineBatch } from '../models/MedicineBatch';
import { getOverdueReport } from './financeService';
import { notify } from './notificationService';
import { createJobQueue, type JobQueue } from './jobQueue';
import { shopOwnerIds, userIdsWithRoles, MANAGEMENT_ROLES } from './notificationAudience';
import { inventorySettings, localisationSettings, notificationSettings } from './settingsService';

const DAY_MS = 86_400_000;

/** Local date in the configured zone, so one calendar day produces one digest. */
async function localDateKey(at: Date) {
  const { timezone } = await localisationSettings();
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(at);
}

/**
 * One digest per shop per day for balances past their payment terms. The
 * occurrence key is the local calendar date, so a rerun on the same day is a
 * no-op. Disabling the digest in settings stops it without redeploying.
 */
export async function runOverdueDigest(at = new Date()) {
  if (!(await notificationSettings()).overdueDigestEnabled) {
    return { shops: 0, day: await localDateKey(at), skipped: true };
  }
  const report = await getOverdueReport(at);
  const dayKey = await localDateKey(at);
  const managers = await userIdsWithRoles(MANAGEMENT_ROLES);
  let sent = 0;

  for (const row of report.data) {
    const owners = await shopOwnerIds(row.shopId);
    if (!owners.length && !managers.length) continue;
    await notify({
      event: NotificationEvent.INVOICE_OVERDUE,
      recipientIds: [...owners, ...managers],
      context: {
        shopName: row.shopName,
        shopId: String(row.shopId),
        amountMinor: row.overdueMinor,
        count: 1,
      },
      entityType: 'Shop',
      entityId: row.shopId,
      occurrenceKey: `OVERDUE:${dayKey}`,
    });
    sent += 1;
  }

  return { shops: sent, day: dayKey, skipped: false };
}

/**
 * One digest per day listing batches inside the near-expiry window that can
 * still be sold. Blocked, quarantined and already-expired batches are excluded
 * because no action on them changes what is allocatable.
 */
export async function runNearExpiryDigest(at = new Date()) {
  if (!(await notificationSettings()).nearExpiryDigestEnabled) {
    return { batches: 0, day: await localDateKey(at), skipped: true };
  }
  const days = (await inventorySettings()).nearExpiryDays;
  const horizon = new Date(at.getTime() + days * DAY_MS);
  const count = await MedicineBatch.countDocuments({
    isBlocked: false,
    isQuarantined: false,
    expiryDate: { $gt: at, $lte: horizon },
    'quantities.available': { $gt: 0 },
  });

  if (!count) return { batches: 0, day: await localDateKey(at), skipped: false };

  const recipients = await userIdsWithRoles([...MANAGEMENT_ROLES, UserRole.STOREKEEPER]);
  const dayKey = await localDateKey(at);
  await notify({
    event: NotificationEvent.STOCK_NEAR_EXPIRY,
    recipientIds: recipients,
    context: { count },
    entityType: 'MedicineBatch',
    occurrenceKey: `NEAR_EXPIRY:${dayKey}`,
  });

  return { batches: count, day: dayKey, skipped: false };
}

type DigestJob = { digest: 'OVERDUE' | 'NEAR_EXPIRY' };

let digestQueue: JobQueue<DigestJob> | null = null;

/**
 * Registers the recurring digests. Both drivers honour `repeatEvery`, so this
 * behaves the same with or without Redis; only cross-instance deduplication
 * differs, which is why BullMQ is the documented production driver.
 */
export async function startNotificationSchedules() {
  if (digestQueue) return;
  const queue = createJobQueue<DigestJob>('notification-digests');
  queue.process(async (job) => {
    if (job.digest === 'OVERDUE') await runOverdueDigest();
    if (job.digest === 'NEAR_EXPIRY') await runNearExpiryDigest();
  });
  await queue.repeatEvery('overdue-digest', DAY_MS, { digest: 'OVERDUE' });
  await queue.repeatEvery('near-expiry-digest', DAY_MS, { digest: 'NEAR_EXPIRY' });
  digestQueue = queue;
}

export async function stopNotificationSchedules() {
  await digestQueue?.close();
  digestQueue = null;
}
