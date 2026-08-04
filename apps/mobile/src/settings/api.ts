import type { BrandingSettings, SettingSource, SystemSettings } from '@medsupply/shared-types';
import { apiClient } from '../api/client';

export interface EffectiveSettings {
  settings: SystemSettings;
  sources: Record<string, SettingSource>;
  versions: Record<string, number>;
  descriptions: Record<string, string>;
}

export async function fetchBranding(): Promise<BrandingSettings> {
  const response = await apiClient.get('/settings/branding');
  return response.data.data;
}

export async function fetchEffectiveSettings(): Promise<EffectiveSettings> {
  const response = await apiClient.get('/settings');
  return response.data.data;
}

export interface SettingsRow {
  label: string;
  value: string;
}

type Translate = (path: string, values?: Record<string, string | number>) => string;

/** The seven groups the server returns, in the order an operator reads them. */
export const SETTING_GROUPS = [
  'business',
  'finance',
  'inventory',
  'delivery',
  'notifications',
  'localisation',
  'security',
] as const;

export function groupLabel(t: Translate, group: string): string {
  return t(`settings.group${group.charAt(0).toUpperCase()}${group.slice(1)}`);
}

export function sourceLabel(t: Translate, source: string): string {
  const label = t(`settings.source${source}`);
  return label.startsWith('settings.') ? source : label;
}

/**
 * Flattens one settings group into display rows.
 *
 * The labels used to live here, in English, and two of them said things
 * `AGENTS.md` bans outright: "Overdue block threshold (poisha)" and "Tax (basis
 * points)". The catalogue already carries these — the web settings screen uses
 * them — and its wording explains the number rather than naming the unit:
 * "Tax rate, in hundredths of a percent (750 = 7.50%)".
 *
 * An empty optional field reads "Not set" rather than disappearing, which would
 * look like a missing feature rather than an unset value.
 */
export function toRows(t: Translate, group: Record<string, unknown>): SettingsRow[] {
  return Object.entries(group).map(([key, value]) => {
    const label = t(`settings.field${key.charAt(0).toUpperCase()}${key.slice(1)}`);
    return {
      label: label.startsWith('settings.') ? key : label,
      value: formatValue(t, value),
    };
  });
}

export function formatValue(t: Translate, value: unknown): string {
  if (value === undefined || value === null || value === '') return t('common.notSet');
  if (typeof value === 'boolean') return value ? t('common.on') : t('common.off');
  if (Array.isArray(value)) return value.length ? value.join(', ') : t('common.nothing');
  if (typeof value === 'object') {
    const quiet = value as { enabled?: boolean; start?: string; end?: string };
    if (typeof quiet.enabled === 'boolean') {
      return quiet.enabled
        ? t('common.between', { from: quiet.start ?? '', to: quiet.end ?? '' })
        : t('common.off');
    }
    return JSON.stringify(value);
  }
  return String(value);
}
