import { Types } from 'mongoose';
import {
  RealtimeEvent,
  SettingSource,
  SettingsGroup,
  UserRole,
  type BrandingSettings,
  type BusinessSettings,
  type DeliverySettings,
  type FinanceSettings,
  type InventorySettings,
  type LocalisationSettings,
  type NotificationSettings,
  type SecuritySettings,
  type SystemSettings,
} from '@medsupply/shared-types';
import {
  BusinessSettingsSchema,
  DeliverySettingsSchema,
  FinanceSettingsSchema,
  InventorySettingsSchema,
  LocalisationSettingsSchema,
  NotificationSettingsSchema,
  SecuritySettingsSchema,
} from '@medsupply/validation';
import { AuditLog } from '../models/AuditLog';
import { SystemSetting } from '../models/SystemSetting';
import {
  environmentSettings,
  groupHasEnvironmentOverride,
  SETTINGS_GROUPS,
} from './settingsDefaults';
import { emitToRoles } from './realtime';

export interface SettingsActor {
  _id: Types.ObjectId | string;
  role: UserRole;
  ipAddress?: string;
  userAgent?: string;
}

const GROUP_SCHEMAS = {
  [SettingsGroup.BUSINESS]: BusinessSettingsSchema,
  [SettingsGroup.FINANCE]: FinanceSettingsSchema,
  [SettingsGroup.INVENTORY]: InventorySettingsSchema,
  [SettingsGroup.DELIVERY]: DeliverySettingsSchema,
  [SettingsGroup.NOTIFICATIONS]: NotificationSettingsSchema,
  [SettingsGroup.LOCALISATION]: LocalisationSettingsSchema,
  [SettingsGroup.SECURITY]: SecuritySettingsSchema,
} as const;

export function settingsError(message: string, code: string, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode, code });
}

interface CachedSettings {
  settings: SystemSettings;
  sources: Record<SettingsGroup, SettingSource>;
  versions: Record<SettingsGroup, number>;
  expiresAt: number;
}

/**
 * Settings are read on nearly every invoice, approval and notification, so they
 * are cached in memory. A local write invalidates immediately; the short TTL is
 * what makes a second API instance converge, and it bounds how long a stale
 * value can be in force after another instance saves.
 */
const CACHE_TTL_MS = 30_000;
let cache: CachedSettings | null = null;

export function invalidateSettingsCache() {
  cache = null;
}

/** Persisted values may predate a schema change, so each group is merged field-wise. */
function mergeGroup<T extends object>(base: T, persisted: unknown): T {
  if (!persisted || typeof persisted !== 'object') return base;
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(persisted as Record<string, unknown>)) {
    if (value !== undefined && key in merged) merged[key] = value;
  }
  return merged as T;
}

async function loadSettings(): Promise<CachedSettings> {
  const fallback = environmentSettings();
  const documents = await SystemSetting.find().lean();
  const byGroup = new Map(documents.map((entry) => [entry.group as SettingsGroup, entry]));

  const settings = { ...fallback } as SystemSettings;
  const sources = {} as Record<SettingsGroup, SettingSource>;
  const versions = {} as Record<SettingsGroup, number>;

  for (const group of SETTINGS_GROUPS) {
    const stored = byGroup.get(group);
    versions[group] = (stored?.version as number | undefined) ?? 0;
    if (stored) {
      (settings as unknown as Record<string, unknown>)[group] = mergeGroup(
        fallback[group] as object,
        stored.values,
      );
      sources[group] = SettingSource.PERSISTED;
      continue;
    }
    sources[group] = groupHasEnvironmentOverride(group)
      ? SettingSource.ENVIRONMENT
      : SettingSource.DEFAULT;
  }

  return { settings, sources, versions, expiresAt: Date.now() + CACHE_TTL_MS };
}

async function currentCache(): Promise<CachedSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache;
  cache = await loadSettings();
  return cache;
}

export async function getSettings(): Promise<SystemSettings> {
  return (await currentCache()).settings;
}

export async function getSettingsWithMetadata() {
  const { settings, sources, versions } = await currentCache();
  return { settings, sources, versions };
}

export async function businessSettings(): Promise<BusinessSettings> {
  return (await getSettings()).business;
}
export async function financeSettings(): Promise<FinanceSettings> {
  return (await getSettings()).finance;
}
export async function inventorySettings(): Promise<InventorySettings> {
  return (await getSettings()).inventory;
}
export async function deliverySettings(): Promise<DeliverySettings> {
  return (await getSettings()).delivery;
}
export async function notificationSettings(): Promise<NotificationSettings> {
  return (await getSettings()).notifications;
}
export async function localisationSettings(): Promise<LocalisationSettings> {
  return (await getSettings()).localisation;
}
export async function securitySettings(): Promise<SecuritySettings> {
  return (await getSettings()).security;
}

export async function brandingSettings(): Promise<BrandingSettings> {
  const settings = await getSettings();
  return {
    name: settings.business.name,
    logoUrl: settings.business.logoUrl,
    locale: settings.localisation.locale,
    dateFormat: settings.localisation.dateFormat,
    currencyCode: settings.localisation.currencyCode,
    currencySymbol: settings.localisation.currencySymbol,
    timezone: settings.localisation.timezone,
  };
}

async function recordSettingsAudit(
  action: string,
  group: SettingsGroup,
  before: unknown,
  after: unknown,
  actor: SettingsActor,
) {
  await AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    action,
    entityType: 'SystemSetting',
    // Grouped settings have no ObjectId of their own; a deterministic id keeps
    // the audit query surface identical to every other entity.
    entityId: deterministicGroupId(group),
    before,
    after,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

/** Stable 24-hex id derived from the group name, so audit rows are queryable. */
export function deterministicGroupId(group: SettingsGroup): Types.ObjectId {
  const hex = Buffer.from(`settings:${group}`).toString('hex').padEnd(24, '0').slice(0, 24);
  return new Types.ObjectId(hex);
}

/**
 * Replaces one group in full. Partial writes are rejected by the group schema
 * so a removed field can never be silently retained, and the version check
 * stops a save that was composed against a stale read.
 */
export async function updateSettingsGroup(input: {
  group: SettingsGroup;
  values: unknown;
  version: number;
  actor: SettingsActor;
}) {
  const schema = GROUP_SCHEMAS[input.group];
  if (!schema) throw settingsError('Unknown settings group', 'UNKNOWN_GROUP', 400);

  const parsed = schema.parse(input.values);
  const { settings: before, versions } = await currentCache();
  const currentVersion = versions[input.group] ?? 0;
  if (currentVersion !== input.version) {
    throw settingsError(
      'These settings changed since they were loaded. Reload and reapply your change.',
      'STALE_SETTINGS',
    );
  }

  const existing = await SystemSetting.findOneAndUpdate(
    { group: input.group, version: input.version },
    {
      $set: { values: parsed, updatedBy: input.actor._id },
      $inc: { version: 1 },
      $setOnInsert: { group: input.group },
    },
    { new: true, upsert: currentVersion === 0 },
  ).catch((error: unknown) => {
    // A concurrent first write loses the upsert race on the unique group index.
    if ((error as { code?: number }).code === 11000) {
      throw settingsError(
        'These settings were saved by someone else. Reload and reapply your change.',
        'STALE_SETTINGS',
      );
    }
    throw error;
  });

  if (!existing) {
    throw settingsError(
      'These settings changed since they were loaded. Reload and reapply your change.',
      'STALE_SETTINGS',
    );
  }

  invalidateSettingsCache();
  await recordSettingsAudit(
    'SETTINGS_UPDATED',
    input.group,
    before[input.group],
    parsed,
    input.actor,
  );
  announceSettingsChange(input.group);

  const refreshed = await currentCache();
  return {
    group: input.group,
    values: refreshed.settings[input.group],
    version: refreshed.versions[input.group],
    source: refreshed.sources[input.group],
  };
}

/**
 * Removes the persisted document so the group falls back to the environment and
 * then to the code default. The previous values are kept in the audit record.
 */
export async function resetSettingsGroup(input: {
  group: SettingsGroup;
  version: number;
  reason: string;
  actor: SettingsActor;
}) {
  const { settings: before, versions } = await currentCache();
  const currentVersion = versions[input.group] ?? 0;
  if (currentVersion === 0) {
    throw settingsError('This group has no saved override to reset', 'NOTHING_TO_RESET', 400);
  }
  if (currentVersion !== input.version) {
    throw settingsError(
      'These settings changed since they were loaded. Reload and reapply your change.',
      'STALE_SETTINGS',
    );
  }

  const removed = await SystemSetting.findOneAndDelete({
    group: input.group,
    version: input.version,
  });
  if (!removed) {
    throw settingsError(
      'These settings changed since they were loaded. Reload and reapply your change.',
      'STALE_SETTINGS',
    );
  }

  invalidateSettingsCache();
  await recordSettingsAudit(
    'SETTINGS_RESET',
    input.group,
    { values: before[input.group], reason: input.reason },
    environmentSettings()[input.group],
    input.actor,
  );
  announceSettingsChange(input.group);

  const refreshed = await currentCache();
  return {
    group: input.group,
    values: refreshed.settings[input.group],
    version: refreshed.versions[input.group],
    source: refreshed.sources[input.group],
  };
}

/** Clients holding branding or formatting values refetch on this signal. */
function announceSettingsChange(group: SettingsGroup) {
  emitToRoles(Object.values(UserRole), RealtimeEvent.SETTINGS_UPDATED, {
    group,
    at: new Date().toISOString(),
  });
}
