import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import mongoose from 'mongoose';
import { env } from '../src/env';
import { ActivityEvent } from '../src/models/ActivityEvent';
import { AuditLog } from '../src/models/AuditLog';
import { Notification } from '../src/models/Notification';
import { NotificationDelivery } from '../src/models/NotificationDelivery';

/**
 * Retention, for a regulated operation.
 *
 * Four collections grow without limit: `auditlogs`, `notifications`,
 * `notificationdeliveries` and `activityevents`. For an ordinary product that
 * is a disk question. Here it is a **minimum-retention** question first and a
 * disk question second, and the two collections are treated differently
 * because they are different things.
 *
 * **`auditlogs` is archived, never deleted.** It is the record of who did what
 * to whose money, and an inspector may ask for a year nobody has looked at
 * since. Each run exports the window to a JSON file, writes a SHA-256 digest
 * beside it, and **verifies the digest by reading the file back** before
 * deleting anything. If any step fails, nothing is pruned — the archive is the
 * precondition for the prune, not a nicety alongside it.
 *
 * The other three are operational noise. A notification from eighteen months
 * ago tells nobody anything, and their windows are configurable.
 *
 *   node dist-scripts/scripts/retention.js --archive-dir /var/backups/medsupply
 *   node dist-scripts/scripts/retention.js --dry-run
 */

interface Options {
  dryRun: boolean;
  archiveDir: string;
  auditRetentionDays: number;
  notificationRetentionDays: number;
  activityRetentionDays: number;
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const days = (flag: string, fallback: number) => {
    const raw =
      value(flag) ?? process.env[flag.replace(/^--/, '').replace(/-/g, '_').toUpperCase()];
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    dryRun: argv.includes('--dry-run'),
    archiveDir: value('--archive-dir') ?? process.env.AUDIT_ARCHIVE_DIR ?? './audit-archive',
    /*
     * Two years before an audit record is even a candidate for archiving.
     * Bangladesh's DGDA inspects on a multi-year cycle and a dispute over a
     * delivery can surface long after the invoice was settled; the cost of
     * keeping these is a few megabytes a year.
     */
    auditRetentionDays: days('--audit-days', 730),
    notificationRetentionDays: days('--notification-days', 180),
    activityRetentionDays: days('--activity-days', 365),
  };
}

function cutoff(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

async function archiveAuditLog(options: Options): Promise<number> {
  const before = cutoff(options.auditRetentionDays);
  const count = await AuditLog.countDocuments({ createdAt: { $lt: before } });
  if (count === 0) {
    process.stdout.write('  audit log: nothing older than the retention window\n');
    return 0;
  }

  if (options.dryRun) {
    process.stdout.write(`  audit log: ${count} records would be archived and pruned\n`);
    return 0;
  }

  const records = await AuditLog.find({ createdAt: { $lt: before } })
    .sort({ createdAt: 1 })
    .lean();

  const stamp = before.toISOString().slice(0, 10);
  const path = resolve(options.archiveDir, `auditlog-before-${stamp}.json`);
  mkdirSync(dirname(path), { recursive: true });

  const payload = JSON.stringify(
    { exportedBefore: before.toISOString(), count: records.length, records },
    null,
    2,
  );
  const digest = createHash('sha256').update(payload).digest('hex');

  writeFileSync(path, payload, 'utf8');
  writeFileSync(`${path}.sha256`, `${digest}  ${path.split(/[\\/]/).pop()}\n`, 'utf8');

  /*
   * Read it back and check the digest before deleting anything.
   *
   * A write that reported success and produced a truncated file is exactly the
   * failure that would only be discovered by an inspector, years later, asking
   * for the year this run deleted.
   */
  const { readFileSync } = await import('node:fs');
  const written = readFileSync(path, 'utf8');
  if (createHash('sha256').update(written).digest('hex') !== digest) {
    throw new Error(
      `The archive at ${path} does not match its digest. Nothing has been deleted. ` +
        `Investigate the destination before running this again.`,
    );
  }

  const result = await AuditLog.deleteMany({ createdAt: { $lt: before } });
  process.stdout.write(
    `  audit log: ${records.length} records archived to ${path}\n` +
      `             digest ${digest.slice(0, 16)}…, ${result.deletedCount} pruned\n`,
  );
  return result.deletedCount ?? 0;
}

async function pruneOperational(options: Options): Promise<number> {
  let total = 0;

  /**
   * Typed loosely on purpose: these three models have unrelated document types
   * and the only thing this loop needs from each is a date field and a
   * collection to delete from. A union of the three would be more type than
   * meaning.
   */
  type Prunable = {
    countDocuments(filter: Record<string, unknown>): Promise<number>;
    deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
  };

  const jobs: Array<[string, Prunable, Date, string]> = [
    [
      'notifications',
      Notification as unknown as Prunable,
      cutoff(options.notificationRetentionDays),
      'createdAt',
    ],
    [
      'notification deliveries',
      NotificationDelivery as unknown as Prunable,
      cutoff(options.notificationRetentionDays),
      'createdAt',
    ],
    [
      'activity events',
      ActivityEvent as unknown as Prunable,
      cutoff(options.activityRetentionDays),
      'occurredAt',
    ],
  ];

  for (const [label, model, before, field] of jobs) {
    const filter = { [field]: { $lt: before } };
    const count = await model.countDocuments(filter);
    if (options.dryRun) {
      process.stdout.write(`  ${label}: ${count} would be removed\n`);
      continue;
    }
    const result = await model.deleteMany(filter);
    total += result.deletedCount ?? 0;
    process.stdout.write(`  ${label}: ${result.deletedCount} removed\n`);
  }

  return total;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));

  await mongoose.connect(env.MONGODB_URI);
  process.stdout.write(
    `Retention on ${mongoose.connection.name}${options.dryRun ? ' (dry run)' : ''}\n` +
      `  audit ${options.auditRetentionDays}d · notifications ` +
      `${options.notificationRetentionDays}d · activity ${options.activityRetentionDays}d\n\n`,
  );

  // The archive runs first. If it throws, nothing else has deleted anything.
  await archiveAuditLog(options);
  await pruneOperational(options);

  process.stdout.write('\nDone.\n');
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`\nRetention failed: ${(error as Error).message}\n`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
