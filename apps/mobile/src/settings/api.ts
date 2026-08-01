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

const LABELS: Record<string, string> = {
  name: 'Display name',
  legalName: 'Legal name',
  logoUrl: 'Logo URL',
  address: 'Address',
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
  tradeLicenceNumber: 'Trade licence',
  drugLicenceNumber: 'Drug licence',
  invoiceFooter: 'Invoice footer',
  taxBasisPoints: 'Tax (basis points)',
  defaultPaymentTermsDays: 'Default payment terms (days)',
  creditBlockOnLimitExceeded: 'Block over credit limit',
  creditBlockOverdueThresholdMinor: 'Overdue block threshold (poisha)',
  creditOverdueGraceDays: 'Overdue grace (days)',
  customerAdvanceEnabled: 'Customer advances',
  deliveryCollectionRequiresVerification: 'Collections need verification',
  nearExpiryDays: 'Near-expiry window (days)',
  lowStockThreshold: 'Low-stock threshold',
  requiredProofs: 'Required delivery proofs',
  otpExpiryMinutes: 'OTP lifetime (minutes)',
  defaultQuietHours: 'Default quiet hours',
  overdueDigestEnabled: 'Overdue digest',
  nearExpiryDigestEnabled: 'Near-expiry digest',
  timezone: 'Time zone',
  locale: 'Locale',
  dateFormat: 'Date format',
  currencyCode: 'Currency code',
  currencySymbol: 'Currency symbol',
  passwordMinLength: 'Minimum password length',
  maxLoginAttempts: 'Attempts before lockout',
  lockoutMinutes: 'Lockout duration (minutes)',
  forcePasswordChangeOnCreate: 'Force change on first sign-in',
};

/**
 * Flattens one settings group into display rows. Values are rendered as the
 * operator would read them, so an empty optional field reads "Not set" rather
 * than disappearing and looking like a missing feature.
 */
export function toRows(group: Record<string, unknown>): SettingsRow[] {
  return Object.entries(group).map(([key, value]) => ({
    label: LABELS[key] ?? key,
    value: formatValue(value),
  }));
}

export function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  if (typeof value === 'object') {
    const quiet = value as { enabled?: boolean; start?: string; end?: string };
    if (typeof quiet.enabled === 'boolean') {
      return quiet.enabled ? `${quiet.start} to ${quiet.end}` : 'Disabled';
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export const SOURCE_LABELS: Record<string, string> = {
  PERSISTED: 'Saved in system settings',
  ENVIRONMENT: 'From the deployment environment',
  DEFAULT: 'Built-in default',
};
