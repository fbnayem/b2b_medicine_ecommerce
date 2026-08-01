import assert from 'node:assert/strict';
import test from 'node:test';
import { Types } from 'mongoose';
import { DeliveryProofType, SettingsGroup, UserRole, UserStatus } from '@medsupply/shared-types';
import {
  BusinessSettingsSchema,
  DeliverySettingsSchema,
  FinanceSettingsSchema,
  InventorySettingsSchema,
  LocalisationSettingsSchema,
  SecuritySettingsSchema,
} from '@medsupply/validation';
import {
  environmentSettings,
  GROUP_ENVIRONMENT_KEYS,
  groupHasEnvironmentOverride,
  SETTINGS_GROUPS,
} from './settingsDefaults';
import { assertAdministrable } from './userAdminService';

/** Restores the environment so one case cannot leak into the next. */
function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('every settings group declares the environment variables it falls back to', () => {
  assert.equal(SETTINGS_GROUPS.length, Object.keys(SettingsGroup).length);
  for (const group of SETTINGS_GROUPS) {
    const keys = GROUP_ENVIRONMENT_KEYS[group];
    assert.ok(Array.isArray(keys) && keys.length > 0, `${group} declares no environment keys`);
  }
});

test('code defaults apply when nothing is configured', () => {
  const cleared = Object.fromEntries(
    SETTINGS_GROUPS.flatMap((group) => GROUP_ENVIRONMENT_KEYS[group]).map((key) => [
      key,
      undefined,
    ]),
  );
  withEnvironment(cleared, () => {
    const settings = environmentSettings();
    assert.equal(settings.business.name, 'MedSupply B2B');
    assert.equal(settings.finance.taxBasisPoints, 0);
    assert.equal(settings.finance.customerAdvanceEnabled, true);
    assert.equal(settings.inventory.nearExpiryDays, 90);
    assert.deepEqual(settings.delivery.requiredProofs, [DeliveryProofType.OTP]);
    assert.equal(settings.delivery.otpExpiryMinutes, 10);
    assert.equal(settings.localisation.timezone, 'Asia/Dhaka');
    assert.equal(settings.localisation.currencySymbol, '৳');
    assert.equal(settings.security.maxLoginAttempts, 5);
  });
});

test('environment values override code defaults per field', () => {
  withEnvironment(
    {
      BUSINESS_NAME: 'Dhaka Distributors',
      INVOICE_TAX_BASIS_POINTS: '750',
      NEAR_EXPIRY_DAYS: '45',
      DELIVERY_REQUIRED_PROOFS: 'OTP,SIGNATURE',
      CUSTOMER_ADVANCE_ENABLED: 'false',
      MAX_LOGIN_ATTEMPTS: '3',
    },
    () => {
      const settings = environmentSettings();
      assert.equal(settings.business.name, 'Dhaka Distributors');
      assert.equal(settings.finance.taxBasisPoints, 750);
      assert.equal(settings.finance.customerAdvanceEnabled, false);
      assert.equal(settings.inventory.nearExpiryDays, 45);
      assert.deepEqual(settings.delivery.requiredProofs, [
        DeliveryProofType.OTP,
        DeliveryProofType.SIGNATURE,
      ]);
      assert.equal(settings.security.maxLoginAttempts, 3);
      // An untouched field in an overridden group keeps its code default.
      assert.equal(settings.finance.creditOverdueGraceDays, 0);
    },
  );
});

test('unusable environment values fall back instead of propagating', () => {
  withEnvironment(
    {
      INVOICE_TAX_BASIS_POINTS: 'not-a-number',
      NEAR_EXPIRY_DAYS: '9999',
      DELIVERY_REQUIRED_PROOFS: 'OTP,NOT_A_PROOF, signature ',
      CUSTOMER_ADVANCE_ENABLED: 'maybe',
      BUSINESS_NAME: '   ',
    },
    () => {
      const settings = environmentSettings();
      assert.equal(settings.finance.taxBasisPoints, 0);
      assert.equal(settings.inventory.nearExpiryDays, 90);
      // Unknown proof names are dropped; recognised ones are normalised.
      assert.deepEqual(settings.delivery.requiredProofs, [
        DeliveryProofType.OTP,
        DeliveryProofType.SIGNATURE,
      ]);
      assert.equal(settings.finance.customerAdvanceEnabled, true);
      assert.equal(settings.business.name, 'MedSupply B2B');
    },
  );
});

test('a group reports an environment override only when one is actually set', () => {
  withEnvironment(
    {
      INVOICE_TAX_BASIS_POINTS: undefined,
      DEFAULT_PAYMENT_TERMS_DAYS: undefined,
      CREDIT_BLOCK_ON_LIMIT_EXCEEDED: undefined,
      CREDIT_BLOCK_OVERDUE_THRESHOLD_MINOR: undefined,
      CREDIT_OVERDUE_GRACE_DAYS: undefined,
      CUSTOMER_ADVANCE_ENABLED: undefined,
      DELIVERY_COLLECTION_REQUIRES_VERIFICATION: undefined,
    },
    () => {
      assert.equal(groupHasEnvironmentOverride(SettingsGroup.FINANCE), false);
    },
  );
  withEnvironment({ INVOICE_TAX_BASIS_POINTS: '500' }, () => {
    assert.equal(groupHasEnvironmentOverride(SettingsGroup.FINANCE), true);
  });
  // An empty string is not a configuration decision.
  withEnvironment({ INVOICE_TAX_BASIS_POINTS: '   ' }, () => {
    assert.equal(groupHasEnvironmentOverride(SettingsGroup.FINANCE), false);
  });
});

test('group schemas reject values that would corrupt downstream arithmetic', () => {
  assert.throws(() =>
    FinanceSettingsSchema.parse({
      taxBasisPoints: 10_001,
      defaultPaymentTermsDays: 30,
      creditBlockOnLimitExceeded: true,
      creditBlockOverdueThresholdMinor: 0,
      creditOverdueGraceDays: 0,
      customerAdvanceEnabled: true,
      deliveryCollectionRequiresVerification: true,
    }),
  );
  assert.throws(() =>
    FinanceSettingsSchema.parse({
      taxBasisPoints: 7.5,
      defaultPaymentTermsDays: 30,
      creditBlockOnLimitExceeded: true,
      creditBlockOverdueThresholdMinor: 0,
      creditOverdueGraceDays: 0,
      customerAdvanceEnabled: true,
      deliveryCollectionRequiresVerification: true,
    }),
  );
  assert.throws(() => InventorySettingsSchema.parse({ nearExpiryDays: 0, lowStockThreshold: 10 }));
  assert.throws(() =>
    InventorySettingsSchema.parse({ nearExpiryDays: 400, lowStockThreshold: 10 }),
  );
  assert.throws(() =>
    DeliverySettingsSchema.parse({ requiredProofs: ['OTP'], otpExpiryMinutes: 0 }),
  );
  assert.throws(() =>
    SecuritySettingsSchema.parse({
      passwordMinLength: 4,
      maxLoginAttempts: 5,
      lockoutMinutes: 15,
      forcePasswordChangeOnCreate: true,
    }),
  );
  assert.throws(() =>
    BusinessSettingsSchema.parse({
      name: 'A',
      address: '',
      phone: '',
      email: '',
      invoiceFooter: '',
    }),
  );
});

test('an unknown time zone is rejected before it can break every date format', () => {
  const valid = LocalisationSettingsSchema.parse({
    timezone: 'Asia/Dhaka',
    locale: 'en',
    dateFormat: 'DD MMM YYYY',
    currencyCode: 'bdt',
    currencySymbol: '৳',
  });
  assert.equal(valid.currencyCode, 'BDT');
  assert.throws(() =>
    LocalisationSettingsSchema.parse({
      timezone: 'Mars/Olympus',
      locale: 'en',
      dateFormat: 'DD MMM YYYY',
      currencyCode: 'BDT',
      currencySymbol: '৳',
    }),
  );
  // Bangla is accepted now so enabling it later needs no schema migration.
  assert.doesNotThrow(() =>
    LocalisationSettingsSchema.parse({
      timezone: 'Asia/Dhaka',
      locale: 'bn',
      dateFormat: 'DD/MM/YYYY',
      currencyCode: 'BDT',
      currencySymbol: '৳',
    }),
  );
});

/* Administrative guard rails. These branches reject before any database read,
   so they are asserted here; the last-Super-Admin rule needs real users and is
   asserted in the integration suite. */

const objectId = () => new Types.ObjectId();

async function expectRejection(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: { code?: string }) => {
    assert.equal(error.code, code);
    return true;
  });
}

test('an Admin cannot administer or create privileged accounts', async () => {
  const actor = { _id: objectId(), role: UserRole.ADMIN };

  await expectRejection(
    assertAdministrable({
      actor,
      target: { _id: objectId(), role: UserRole.ADMIN, status: UserStatus.ACTIVE },
    }),
    'PRIVILEGED_TARGET',
  );

  await expectRejection(
    assertAdministrable({
      actor,
      target: { _id: objectId(), role: UserRole.MANAGER, status: UserStatus.ACTIVE },
      nextRole: UserRole.SUPER_ADMIN,
    }),
    'PRIVILEGED_ROLE',
  );

  // An ordinary account is still administrable.
  await assert.doesNotReject(
    assertAdministrable({
      actor,
      target: { _id: objectId(), role: UserRole.STOREKEEPER, status: UserStatus.ACTIVE },
      nextRole: UserRole.MANAGER,
    }),
  );
});

test('nobody can change or disable their own account', async () => {
  const id = objectId();
  const actor = { _id: id, role: UserRole.SUPER_ADMIN };

  await expectRejection(
    assertAdministrable({
      actor,
      target: { _id: id, role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE },
      nextRole: UserRole.MANAGER,
    }),
    'SELF_ROLE_CHANGE',
  );

  await expectRejection(
    assertAdministrable({
      actor,
      target: { _id: id, role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE },
      nextStatus: UserStatus.SUSPENDED,
    }),
    'SELF_STATUS_CHANGE',
  );

  // Editing your own name is not a privilege change.
  await assert.doesNotReject(
    assertAdministrable({
      actor,
      target: { _id: id, role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE },
      nextStatus: UserStatus.ACTIVE,
    }),
  );
});
