import {
  DeliveryProofType,
  SettingsGroup,
  type BusinessSettings,
  type DeliverySettings,
  type FinanceSettings,
  type InventorySettings,
  type LocalisationSettings,
  type NotificationSettings,
  type SecuritySettings,
  type SystemSettings,
} from '@medsupply/shared-types';

/**
 * Code defaults and the environment variables each group falls back to.
 *
 * Precedence is persisted value -> environment variable -> code default, and it
 * is applied per field, not per group. That is what lets a deployment keep its
 * existing `.env` behaviour after the upgrade, and lets an administrator
 * override one field without having to restate the rest.
 *
 * Infrastructure configuration (database, Redis, JWT, CORS, provider webhooks)
 * deliberately stays in the environment: it is a deployment concern, it is
 * needed before the database is reachable, and it must not be editable through
 * an authenticated web form.
 */

const text = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
};

const optionalText = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const integer = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const boolean = (value: string | undefined, fallback: boolean) => {
  const normalised = value?.trim().toLowerCase();
  if (normalised === 'true') return true;
  if (normalised === 'false') return false;
  return fallback;
};

function businessFromEnvironment(): BusinessSettings {
  return {
    name: text(process.env.BUSINESS_NAME, 'MedSupply B2B'),
    legalName: optionalText(process.env.BUSINESS_LEGAL_NAME),
    logoUrl: optionalText(process.env.BUSINESS_LOGO_URL),
    address: text(process.env.BUSINESS_ADDRESS, ''),
    phone: text(process.env.BUSINESS_PHONE, ''),
    email: text(process.env.BUSINESS_EMAIL, ''),
    website: optionalText(process.env.BUSINESS_WEBSITE),
    tradeLicenceNumber: optionalText(process.env.BUSINESS_TRADE_LICENCE),
    drugLicenceNumber: optionalText(process.env.BUSINESS_DRUG_LICENCE),
    invoiceFooter: text(process.env.INVOICE_FOOTER, ''),
  };
}

function financeFromEnvironment(): FinanceSettings {
  return {
    taxBasisPoints: integer(process.env.INVOICE_TAX_BASIS_POINTS, 0),
    defaultPaymentTermsDays: integer(process.env.DEFAULT_PAYMENT_TERMS_DAYS, 30),
    creditBlockOnLimitExceeded: boolean(process.env.CREDIT_BLOCK_ON_LIMIT_EXCEEDED, true),
    creditBlockOverdueThresholdMinor: integer(process.env.CREDIT_BLOCK_OVERDUE_THRESHOLD_MINOR, 0),
    creditOverdueGraceDays: integer(process.env.CREDIT_OVERDUE_GRACE_DAYS, 0),
    customerAdvanceEnabled: boolean(process.env.CUSTOMER_ADVANCE_ENABLED, true),
    deliveryCollectionRequiresVerification: boolean(
      process.env.DELIVERY_COLLECTION_REQUIRES_VERIFICATION,
      true,
    ),
  };
}

function inventoryFromEnvironment(): InventorySettings {
  const days = integer(process.env.NEAR_EXPIRY_DAYS, 90);
  return {
    nearExpiryDays: days >= 1 && days <= 365 ? days : 90,
    lowStockThreshold: integer(process.env.LOW_STOCK_THRESHOLD, 10),
  };
}

const PROOF_VALUES = Object.values(DeliveryProofType) as string[];

function deliveryFromEnvironment(): DeliverySettings {
  const configured = text(process.env.DELIVERY_REQUIRED_PROOFS, DeliveryProofType.OTP)
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => PROOF_VALUES.includes(entry)) as DeliveryProofType[];
  return {
    requiredProofs: [...new Set(configured)],
    otpExpiryMinutes: integer(process.env.DELIVERY_OTP_EXPIRY_MINUTES, 10),
  };
}

function notificationsFromEnvironment(): NotificationSettings {
  return {
    defaultQuietHours: {
      enabled: boolean(process.env.NOTIFICATION_QUIET_HOURS_ENABLED, false),
      start: text(process.env.NOTIFICATION_QUIET_HOURS_START, '22:00'),
      end: text(process.env.NOTIFICATION_QUIET_HOURS_END, '07:00'),
    },
    overdueDigestEnabled: boolean(process.env.OVERDUE_DIGEST_ENABLED, true),
    nearExpiryDigestEnabled: boolean(process.env.NEAR_EXPIRY_DIGEST_ENABLED, true),
  };
}

function localisationFromEnvironment(): LocalisationSettings {
  return {
    timezone: text(process.env.PRIMARY_TIMEZONE, 'Asia/Dhaka'),
    // English only for now; the schema accepts 'bn' so the switch needs no migration.
    locale: text(process.env.PRIMARY_LOCALE, 'en'),
    dateFormat: text(process.env.PRIMARY_DATE_FORMAT, 'DD MMM YYYY'),
    currencyCode: text(process.env.PRIMARY_CURRENCY, 'BDT'),
    currencySymbol: text(process.env.PRIMARY_CURRENCY_SYMBOL, '৳'),
  };
}

function securityFromEnvironment(): SecuritySettings {
  return {
    passwordMinLength: integer(process.env.PASSWORD_MIN_LENGTH, 8),
    maxLoginAttempts: integer(process.env.MAX_LOGIN_ATTEMPTS, 5),
    lockoutMinutes: integer(process.env.LOCKOUT_MINUTES, 15),
    forcePasswordChangeOnCreate: boolean(process.env.FORCE_PASSWORD_CHANGE_ON_CREATE, true),
  };
}

/**
 * Rebuilt on each call rather than cached at module load, so a test or a
 * process that changes an environment variable sees the change.
 */
export function environmentSettings(): SystemSettings {
  return {
    business: businessFromEnvironment(),
    finance: financeFromEnvironment(),
    inventory: inventoryFromEnvironment(),
    delivery: deliveryFromEnvironment(),
    notifications: notificationsFromEnvironment(),
    localisation: localisationFromEnvironment(),
    security: securityFromEnvironment(),
  };
}

export const SETTINGS_GROUPS = Object.values(SettingsGroup);

/**
 * Environment variables each group reads. Used to report whether an effective
 * value came from the environment or from the code default, so an administrator
 * can see why a field looks the way it does before changing it.
 */
export const GROUP_ENVIRONMENT_KEYS: Record<SettingsGroup, string[]> = {
  [SettingsGroup.BUSINESS]: [
    'BUSINESS_NAME',
    'BUSINESS_LEGAL_NAME',
    'BUSINESS_LOGO_URL',
    'BUSINESS_ADDRESS',
    'BUSINESS_PHONE',
    'BUSINESS_EMAIL',
    'BUSINESS_WEBSITE',
    'BUSINESS_TRADE_LICENCE',
    'BUSINESS_DRUG_LICENCE',
    'INVOICE_FOOTER',
  ],
  [SettingsGroup.FINANCE]: [
    'INVOICE_TAX_BASIS_POINTS',
    'DEFAULT_PAYMENT_TERMS_DAYS',
    'CREDIT_BLOCK_ON_LIMIT_EXCEEDED',
    'CREDIT_BLOCK_OVERDUE_THRESHOLD_MINOR',
    'CREDIT_OVERDUE_GRACE_DAYS',
    'CUSTOMER_ADVANCE_ENABLED',
    'DELIVERY_COLLECTION_REQUIRES_VERIFICATION',
  ],
  [SettingsGroup.INVENTORY]: ['NEAR_EXPIRY_DAYS', 'LOW_STOCK_THRESHOLD'],
  [SettingsGroup.DELIVERY]: ['DELIVERY_REQUIRED_PROOFS', 'DELIVERY_OTP_EXPIRY_MINUTES'],
  [SettingsGroup.NOTIFICATIONS]: [
    'NOTIFICATION_QUIET_HOURS_ENABLED',
    'NOTIFICATION_QUIET_HOURS_START',
    'NOTIFICATION_QUIET_HOURS_END',
    'OVERDUE_DIGEST_ENABLED',
    'NEAR_EXPIRY_DIGEST_ENABLED',
  ],
  [SettingsGroup.LOCALISATION]: [
    'PRIMARY_TIMEZONE',
    'PRIMARY_LOCALE',
    'PRIMARY_DATE_FORMAT',
    'PRIMARY_CURRENCY',
    'PRIMARY_CURRENCY_SYMBOL',
  ],
  [SettingsGroup.SECURITY]: [
    'PASSWORD_MIN_LENGTH',
    'MAX_LOGIN_ATTEMPTS',
    'LOCKOUT_MINUTES',
    'FORCE_PASSWORD_CHANGE_ON_CREATE',
  ],
};

export function groupHasEnvironmentOverride(group: SettingsGroup): boolean {
  return GROUP_ENVIRONMENT_KEYS[group].some((key) => {
    const value = process.env[key];
    return typeof value === 'string' && value.trim() !== '';
  });
}

/** Human-readable descriptions rendered by the administration screens. */
export const GROUP_DESCRIPTIONS: Record<SettingsGroup, string> = {
  [SettingsGroup.BUSINESS]:
    'Identity printed on invoices, receipts, statements and package labels. Existing documents keep the snapshot taken when they were issued.',
  [SettingsGroup.FINANCE]:
    'Tax, payment terms and credit control. Changes apply to future invoices and approvals; posted journals are never rewritten.',
  [SettingsGroup.INVENTORY]: 'Near-expiry and low-stock thresholds used by warnings and digests.',
  [SettingsGroup.DELIVERY]: 'Proof requirements and receiver OTP lifetime for new deliveries.',
  [SettingsGroup.NOTIFICATIONS]:
    'Default quiet hours for users who have saved none, and the scheduled digests.',
  [SettingsGroup.LOCALISATION]:
    'Time zone used by notification quiet hours and digests, plus client display formatting.',
  [SettingsGroup.SECURITY]: 'Password length, sign-in lockout and new-account password policy.',
};
