import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { SettingsGroup } from '@medsupply/shared-types';
import { MigrationRun, MigrationRunMode, MigrationRunStatus } from '../src/models/MigrationRun';
import { SystemSetting } from '../src/models/SystemSetting';
import {
  environmentSettings,
  groupHasEnvironmentOverride,
  SETTINGS_GROUPS,
} from '../src/services/settingsDefaults';

const MIGRATION_ID = 'phase10-system-settings-v1';

type GroupScan = {
  group: SettingsGroup;
  persisted: boolean;
  environmentOverride: boolean;
  wouldSeed: boolean;
};

type Scan = {
  scannedAt: string;
  groups: GroupScan[];
  persistedCount: number;
  seedCandidates: number;
  effective: ReturnType<typeof environmentSettings>;
};

async function scan(): Promise<Scan> {
  const documents = await SystemSetting.find().select('group').lean();
  const persistedGroups = new Set(documents.map((entry) => entry.group as SettingsGroup));

  const groups: GroupScan[] = SETTINGS_GROUPS.map((group) => {
    const persisted = persistedGroups.has(group);
    const environmentOverride = groupHasEnvironmentOverride(group);
    return {
      group,
      persisted,
      environmentOverride,
      // Only a group actually configured through the environment is worth
      // seeding. Seeding pure defaults would freeze today's defaults forever.
      wouldSeed: !persisted && environmentOverride,
    };
  });

  return {
    scannedAt: new Date().toISOString(),
    groups,
    persistedCount: groups.filter((entry) => entry.persisted).length,
    seedCandidates: groups.filter((entry) => entry.wouldSeed).length,
    effective: environmentSettings(),
  };
}

/**
 * Seeds a persisted document for each group that the environment currently
 * configures, so the administration screen shows the values already in force
 * and an administrator can edit them without first retyping the deployment's
 * configuration. Groups left at code defaults are deliberately not seeded: they
 * keep tracking the defaults until someone chooses to override them.
 */
async function seedConfiguredGroups() {
  const fallback = environmentSettings();
  const seeded: SettingsGroup[] = [];
  const skipped: SettingsGroup[] = [];

  for (const group of SETTINGS_GROUPS) {
    const exists = await SystemSetting.exists({ group });
    if (exists || !groupHasEnvironmentOverride(group)) {
      skipped.push(group);
      continue;
    }
    await SystemSetting.create({
      group,
      values: fallback[group],
      version: 1,
    });
    seeded.push(group);
  }

  return { seeded, skipped };
}

function requestedMode() {
  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run');
  if (apply && dryRun) throw new Error('Choose either --dry-run or --apply, not both.');
  return apply ? MigrationRunMode.APPLY : MigrationRunMode.DRY_RUN;
}

export async function runPhase10SettingsMigration() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required.');
  const mode = requestedMode();
  await mongoose.connect(uri);

  if (mode === MigrationRunMode.DRY_RUN) {
    const before = await scan();
    process.stdout.write(
      `${JSON.stringify({ migrationId: MIGRATION_ID, mode, scan: before }, null, 2)}\n`,
    );
    return;
  }

  await MigrationRun.init();
  await SystemSetting.init();
  const migrationRun = await MigrationRun.create({
    migrationId: MIGRATION_ID,
    runId: randomUUID(),
    mode,
    status: MigrationRunStatus.RUNNING,
    startedAt: new Date(),
  });

  try {
    const before = await scan();
    const result = await seedConfiguredGroups();
    const after = await scan();

    migrationRun.status = MigrationRunStatus.COMPLETED;
    migrationRun.completedAt = new Date();
    migrationRun.set('stats', { before, result, after });
    await migrationRun.save();

    process.stdout.write(
      `${JSON.stringify({ migrationId: MIGRATION_ID, mode, before, result, after }, null, 2)}\n`,
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
  runPhase10SettingsMigration()
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
