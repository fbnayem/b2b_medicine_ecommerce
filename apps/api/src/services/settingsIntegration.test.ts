import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  DeliveryProofType,
  SettingSource,
  SettingsGroup,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { AuditLog } from '../models/AuditLog';
import { Session } from '../models/Session';
import { SystemSetting } from '../models/SystemSetting';
import { User } from '../models/User';
import {
  deliverySettings,
  financeSettings,
  getSettingsWithMetadata,
  invalidateSettingsCache,
} from './settingsService';
import { configuredProofRequirements } from './deliveryService';

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

function authorization(userId: Types.ObjectId) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`,
  };
}

async function createUser(overrides: Record<string, unknown>) {
  return User.create({
    passwordHash: await bcrypt.hash('OriginalPassword1', 10),
    firstName: 'Test',
    lastName: 'User',
    status: UserStatus.ACTIVE,
    ...overrides,
  });
}

async function readSettings(actorId: Types.ObjectId) {
  const response = await fetch(`${base}/api/v1/settings`, { headers: authorization(actorId) });
  return {
    status: response.status,
    body: (await response.json()) as {
      data: {
        settings: Record<string, Record<string, unknown>>;
        sources: Record<string, string>;
        versions: Record<string, number>;
      };
    },
  };
}

before(async () => {
  const uri = process.env.MONGODB_TEST_URI
    ? process.env.MONGODB_TEST_URI
    : await (async () => {
        memoryReplica = await MongoMemoryReplSet.create({
          replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
        });
        return memoryReplica.getUri('medsupply_settings');
      })();
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([AuditLog.init(), Session.init(), SystemSetting.init(), User.init()]);

  await new Promise<void>((resolve) => {
    const runningServer = app.listen(0, '127.0.0.1', () => {
      const address = runningServer.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server = runningServer;
  });
});

beforeEach(() => {
  invalidateSettingsCache();
});

after(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  await mongoose.disconnect();
  await memoryReplica?.stop();
});

test('settings read reports effective values, provenance and versions', async () => {
  const admin = await createUser({ email: 'settings-read@test.local', role: UserRole.ADMIN });
  const { status, body } = await readSettings(admin._id);

  assert.equal(status, 200);
  assert.equal(body.data.settings.business.name, 'MedSupply B2B');
  // Nothing is persisted yet, so every group reports its fallback source.
  for (const group of Object.values(SettingsGroup)) {
    const fallbackSources: string[] = [SettingSource.ENVIRONMENT, SettingSource.DEFAULT];
    assert.ok(fallbackSources.includes(body.data.sources[group]));
    assert.equal(body.data.versions[group], 0);
  }
});

test('a saved group becomes the effective value and is reported as persisted', async () => {
  const admin = await createUser({ email: 'settings-save@test.local', role: UserRole.ADMIN });
  const before = await readSettings(admin._id);

  const response = await fetch(`${base}/api/v1/settings/business`, {
    method: 'PUT',
    headers: authorization(admin._id),
    body: JSON.stringify({
      version: before.body.data.versions.business,
      values: {
        name: 'Dhaka Medical Supply',
        address: '12 Bijoy Sarani, Dhaka',
        phone: '+8801712345678',
        email: 'accounts@dhakamedical.test',
        invoiceFooter: 'Thank you for your business.',
      },
    }),
  });
  assert.equal(response.status, 200);

  const after = await readSettings(admin._id);
  assert.equal(after.body.data.settings.business.name, 'Dhaka Medical Supply');
  assert.equal(after.body.data.sources.business, SettingSource.PERSISTED);
  assert.equal(after.body.data.versions.business, 1);

  const audit = await AuditLog.findOne({ action: 'SETTINGS_UPDATED' })
    .sort({ createdAt: -1 })
    .lean();
  assert.ok(audit, 'a settings change must be audited');
  assert.equal((audit?.before as { name?: string })?.name, 'MedSupply B2B');
  assert.equal((audit?.after as { name?: string })?.name, 'Dhaka Medical Supply');
});

test('a stale version is rejected so a concurrent save cannot be overwritten', async () => {
  const admin = await createUser({ email: 'settings-stale@test.local', role: UserRole.ADMIN });
  const snapshot = await readSettings(admin._id);
  const staleVersion = snapshot.body.data.versions.inventory;

  const payload = (nearExpiryDays: number) =>
    JSON.stringify({
      version: staleVersion,
      values: { nearExpiryDays, lowStockThreshold: 10 },
    });

  const first = await fetch(`${base}/api/v1/settings/inventory`, {
    method: 'PUT',
    headers: authorization(admin._id),
    body: payload(30),
  });
  assert.equal(first.status, 200);

  // Second save still believes it is at the original version.
  const second = await fetch(`${base}/api/v1/settings/inventory`, {
    method: 'PUT',
    headers: authorization(admin._id),
    body: payload(60),
  });
  assert.equal(second.status, 409);
  assert.equal(((await second.json()) as { error: { code: string } }).error.code, 'STALE_SETTINGS');

  const current = await readSettings(admin._id);
  assert.equal(current.body.data.settings.inventory.nearExpiryDays, 30);
});

test('invalid settings are rejected before they can reach the domain', async () => {
  const admin = await createUser({ email: 'settings-invalid@test.local', role: UserRole.ADMIN });
  const snapshot = await readSettings(admin._id);

  const response = await fetch(`${base}/api/v1/settings/finance`, {
    method: 'PUT',
    headers: authorization(admin._id),
    body: JSON.stringify({
      version: snapshot.body.data.versions.finance,
      values: {
        taxBasisPoints: 12_000,
        defaultPaymentTermsDays: 30,
        creditBlockOnLimitExceeded: true,
        creditBlockOverdueThresholdMinor: 0,
        creditOverdueGraceDays: 0,
        customerAdvanceEnabled: true,
        deliveryCollectionRequiresVerification: true,
      },
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(await SystemSetting.countDocuments({ group: SettingsGroup.FINANCE }), 0);
});

test('saved settings change domain behaviour without a restart', async () => {
  const admin = await createUser({ email: 'settings-domain@test.local', role: UserRole.ADMIN });
  const snapshot = await readSettings(admin._id);

  assert.deepEqual(await configuredProofRequirements(), [DeliveryProofType.OTP]);
  assert.equal((await financeSettings()).customerAdvanceEnabled, true);

  const deliveryResponse = await fetch(`${base}/api/v1/settings/delivery`, {
    method: 'PUT',
    headers: authorization(admin._id),
    body: JSON.stringify({
      version: snapshot.body.data.versions.delivery,
      values: {
        requiredProofs: [DeliveryProofType.OTP, DeliveryProofType.PHOTOGRAPH],
        otpExpiryMinutes: 5,
      },
    }),
  });
  assert.equal(deliveryResponse.status, 200);

  // The service reads through the same cache the API just invalidated.
  assert.deepEqual(await configuredProofRequirements(), [
    DeliveryProofType.OTP,
    DeliveryProofType.PHOTOGRAPH,
  ]);
  assert.equal((await deliverySettings()).otpExpiryMinutes, 5);
});

test('resetting a group restores the fallback and keeps the previous values in the audit', async () => {
  const admin = await createUser({ email: 'settings-reset@test.local', role: UserRole.ADMIN });
  const snapshot = await readSettings(admin._id);

  await fetch(`${base}/api/v1/settings/security`, {
    method: 'PUT',
    headers: authorization(admin._id),
    body: JSON.stringify({
      version: snapshot.body.data.versions.security,
      values: {
        passwordMinLength: 16,
        maxLoginAttempts: 3,
        lockoutMinutes: 60,
        forcePasswordChangeOnCreate: true,
      },
    }),
  });

  const saved = await readSettings(admin._id);
  assert.equal(saved.body.data.settings.security.passwordMinLength, 16);

  const reset = await fetch(`${base}/api/v1/settings/security/reset`, {
    method: 'POST',
    headers: authorization(admin._id),
    body: JSON.stringify({
      version: saved.body.data.versions.security,
      reason: 'Reverting an experiment',
    }),
  });
  assert.equal(reset.status, 200);

  const restored = await readSettings(admin._id);
  assert.equal(restored.body.data.settings.security.passwordMinLength, 8);
  assert.notEqual(restored.body.data.sources.security, SettingSource.PERSISTED);

  const audit = await AuditLog.findOne({ action: 'SETTINGS_RESET' }).sort({ createdAt: -1 }).lean();
  assert.equal(
    (audit?.before as { values?: { passwordMinLength?: number } })?.values?.passwordMinLength,
    16,
  );
});

test('settings administration is closed to managers and below', async () => {
  const manager = await createUser({
    email: 'settings-manager@test.local',
    role: UserRole.MANAGER,
  });
  const owner = await createUser({ email: 'settings-owner@test.local', role: UserRole.SHOP_OWNER });

  const read = await fetch(`${base}/api/v1/settings`, { headers: authorization(manager._id) });
  assert.equal(read.status, 403);

  const write = await fetch(`${base}/api/v1/settings/inventory`, {
    method: 'PUT',
    headers: authorization(manager._id),
    body: JSON.stringify({ version: 0, values: { nearExpiryDays: 5, lowStockThreshold: 1 } }),
  });
  assert.equal(write.status, 403);

  // Branding is safe for every signed-in role and carries no policy fields.
  const branding = await fetch(`${base}/api/v1/settings/branding`, {
    headers: authorization(owner._id),
  });
  assert.equal(branding.status, 200);
  const payload = (await branding.json()) as { data: Record<string, unknown> };
  assert.ok(payload.data.name);
  assert.equal(payload.data.taxBasisPoints, undefined);
  assert.equal(payload.data.maxLoginAttempts, undefined);
});

test('an Admin cannot administer a Super Admin or grant privileged roles', async () => {
  const admin = await createUser({ email: 'admin-tier@test.local', role: UserRole.ADMIN });
  const superAdmin = await createUser({
    email: 'super-tier@test.local',
    role: UserRole.SUPER_ADMIN,
  });
  const storekeeper = await createUser({
    email: 'store-tier@test.local',
    role: UserRole.STOREKEEPER,
  });

  const againstSuperAdmin = await fetch(`${base}/api/v1/admin/users/${superAdmin._id}`, {
    method: 'PATCH',
    headers: authorization(admin._id),
    body: JSON.stringify({ status: UserStatus.SUSPENDED }),
  });
  assert.equal(againstSuperAdmin.status, 403);

  const promotion = await fetch(`${base}/api/v1/admin/users/${storekeeper._id}`, {
    method: 'PATCH',
    headers: authorization(admin._id),
    body: JSON.stringify({ role: UserRole.ADMIN }),
  });
  assert.equal(promotion.status, 403);

  const allowed = await fetch(`${base}/api/v1/admin/users/${storekeeper._id}`, {
    method: 'PATCH',
    headers: authorization(admin._id),
    body: JSON.stringify({ role: UserRole.MANAGER }),
  });
  assert.equal(allowed.status, 200);
  assert.equal((await User.findById(storekeeper._id).lean())?.role, UserRole.MANAGER);
});

test('the last active Super Admin cannot be demoted or deactivated', async () => {
  await User.deleteMany({ role: UserRole.SUPER_ADMIN });
  const only = await createUser({ email: 'last-super@test.local', role: UserRole.SUPER_ADMIN });
  const other = await createUser({ email: 'other-super@test.local', role: UserRole.SUPER_ADMIN });

  // With two Super Admins the demotion is allowed.
  const first = await fetch(`${base}/api/v1/admin/users/${other._id}`, {
    method: 'PATCH',
    headers: authorization(only._id),
    body: JSON.stringify({ role: UserRole.MANAGER }),
  });
  assert.equal(first.status, 200);

  // Now `only` is the last one; another Super Admin would be needed to act, so
  // the rule is exercised through a second account that cannot be created.
  const selfDemotion = await fetch(`${base}/api/v1/admin/users/${only._id}`, {
    method: 'PATCH',
    headers: authorization(only._id),
    body: JSON.stringify({ role: UserRole.MANAGER }),
  });
  assert.equal(selfDemotion.status, 403);
  assert.equal(
    ((await selfDemotion.json()) as { error: { code: string } }).error.code,
    'SELF_ROLE_CHANGE',
  );

  const restored = await createUser({
    email: 'restored-super@test.local',
    role: UserRole.SUPER_ADMIN,
  });
  const lastOne = await fetch(`${base}/api/v1/admin/users/${only._id}`, {
    method: 'PATCH',
    headers: authorization(restored._id),
    body: JSON.stringify({ status: UserStatus.INACTIVE }),
  });
  assert.equal(lastOne.status, 200);

  // `restored` is now the only active Super Admin left.
  await User.updateOne({ _id: only._id }, { $set: { status: UserStatus.INACTIVE } });
  const admin = await createUser({
    email: 'blocking-admin@test.local',
    role: UserRole.SUPER_ADMIN,
  });
  await User.updateOne({ _id: admin._id }, { $set: { status: UserStatus.INACTIVE } });

  const blocked = await fetch(`${base}/api/v1/admin/users/${restored._id}`, {
    method: 'PATCH',
    headers: authorization(restored._id),
    body: JSON.stringify({ status: UserStatus.INACTIVE }),
  });
  assert.equal(blocked.status, 403);
});

test('a role change revokes existing sessions and is audited', async () => {
  const admin = await createUser({ email: 'session-admin@test.local', role: UserRole.SUPER_ADMIN });
  const target = await createUser({
    email: 'session-target@test.local',
    role: UserRole.STOREKEEPER,
  });
  await Session.create({
    userId: target._id,
    refreshTokenHash: 'hash',
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  const response = await fetch(`${base}/api/v1/admin/users/${target._id}`, {
    method: 'PATCH',
    headers: authorization(admin._id),
    body: JSON.stringify({ role: UserRole.MANAGER }),
  });
  assert.equal(response.status, 200);

  const live = await Session.countDocuments({
    userId: target._id,
    revokedAt: { $exists: false },
  });
  assert.equal(live, 0);

  const roleAudit = await AuditLog.findOne({
    action: 'USER_ROLE_CHANGED',
    entityId: target._id,
  }).lean();
  assert.equal((roleAudit?.after as { role?: string })?.role, UserRole.MANAGER);
});

test('an administrative password reset forces a change and never records the password', async () => {
  const admin = await createUser({ email: 'reset-admin@test.local', role: UserRole.ADMIN });
  const target = await createUser({ email: 'reset-target@test.local', role: UserRole.MANAGER });
  await Session.create({
    userId: target._id,
    refreshTokenHash: 'hash',
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  const response = await fetch(`${base}/api/v1/admin/users/${target._id}/reset-password`, {
    method: 'POST',
    headers: authorization(admin._id),
    body: JSON.stringify({
      temporaryPassword: 'TemporaryPass99',
      reason: 'Lost device',
    }),
  });
  assert.equal(response.status, 200);

  const updated = await User.findById(target._id);
  assert.equal(updated?.forcePasswordChange, true);
  assert.ok(await bcrypt.compare('TemporaryPass99', updated!.passwordHash));
  assert.equal(
    await Session.countDocuments({ userId: target._id, revokedAt: { $exists: false } }),
    0,
  );

  const audit = await AuditLog.findOne({
    action: 'USER_PASSWORD_RESET',
    entityId: target._id,
  }).lean();
  assert.equal((audit?.after as { reason?: string })?.reason, 'Lost device');
  assert.ok(!JSON.stringify(audit).includes('TemporaryPass99'));
});

test('a short temporary password is rejected against the configured minimum', async () => {
  const admin = await createUser({ email: 'short-admin@test.local', role: UserRole.ADMIN });
  const target = await createUser({ email: 'short-target@test.local', role: UserRole.MANAGER });
  const snapshot = await readSettings(admin._id);

  await fetch(`${base}/api/v1/settings/security`, {
    method: 'PUT',
    headers: authorization(admin._id),
    body: JSON.stringify({
      version: snapshot.body.data.versions.security,
      values: {
        passwordMinLength: 14,
        maxLoginAttempts: 5,
        lockoutMinutes: 15,
        forcePasswordChangeOnCreate: true,
      },
    }),
  });

  const response = await fetch(`${base}/api/v1/admin/users/${target._id}/reset-password`, {
    method: 'POST',
    headers: authorization(admin._id),
    body: JSON.stringify({ temporaryPassword: 'TwelveChars1', reason: 'Policy check' }),
  });
  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    'PASSWORD_TOO_SHORT',
  );
});

test('sign-in outcomes are audited and lockout follows the configured policy', async () => {
  const admin = await createUser({ email: 'audit-admin@test.local', role: UserRole.ADMIN });
  const snapshot = await getSettingsWithMetadata();
  const policyResponse = await fetch(`${base}/api/v1/settings/security`, {
    method: 'PUT',
    headers: authorization(admin._id),
    body: JSON.stringify({
      version: snapshot.versions.security,
      values: {
        passwordMinLength: 8,
        maxLoginAttempts: 3,
        lockoutMinutes: 15,
        forcePasswordChangeOnCreate: true,
      },
    }),
  });
  assert.equal(policyResponse.status, 200, await policyResponse.clone().text());

  const target = await createUser({ email: 'signin@test.local', role: UserRole.MANAGER });
  const attempt = (password: string) =>
    fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'signin@test.local', password }),
    });

  assert.equal((await attempt('WrongPassword1')).status, 401);
  assert.equal((await attempt('WrongPassword2')).status, 401);
  assert.equal((await attempt('WrongPassword3')).status, 401);
  // The configured limit of three attempts is now reached, so even the correct
  // password is refused until the lockout expires.
  assert.equal((await attempt('OriginalPassword1')).status, 403);

  const failed = await AuditLog.countDocuments({ action: 'LOGIN_FAILED', entityId: target._id });
  const locked = await AuditLog.countDocuments({ action: 'LOGIN_LOCKED', entityId: target._id });
  const blocked = await AuditLog.countDocuments({ action: 'LOGIN_BLOCKED', entityId: target._id });
  assert.equal(failed, 2);
  assert.equal(locked, 1);
  assert.equal(blocked, 1);

  const audits = await AuditLog.find({ entityId: target._id }).lean();
  assert.ok(!JSON.stringify(audits).includes('WrongPassword1'));
});

test('the audit log is readable by administrators, filterable and closed to managers', async () => {
  const admin = await createUser({ email: 'audit-view@test.local', role: UserRole.ADMIN });
  const manager = await createUser({ email: 'audit-manager@test.local', role: UserRole.MANAGER });

  const denied = await fetch(`${base}/api/v1/admin/audit`, { headers: authorization(manager._id) });
  assert.equal(denied.status, 403);

  const all = await fetch(`${base}/api/v1/admin/audit?limit=5`, {
    headers: authorization(admin._id),
  });
  assert.equal(all.status, 200);
  const page = (await all.json()) as { data: unknown[]; meta: { total: number } };
  assert.ok(page.meta.total > 0);
  assert.ok(page.data.length <= 5);

  const filtered = await fetch(`${base}/api/v1/admin/audit?action=SETTINGS_UPDATED`, {
    headers: authorization(admin._id),
  });
  const filteredPage = (await filtered.json()) as { data: Array<{ action: string }> };
  assert.ok(filteredPage.data.length > 0);
  assert.ok(filteredPage.data.every((entry) => entry.action === 'SETTINGS_UPDATED'));

  const actions = await fetch(`${base}/api/v1/admin/audit/actions`, {
    headers: authorization(admin._id),
  });
  const actionList = ((await actions.json()) as { data: string[] }).data;
  assert.ok(actionList.includes('SETTINGS_UPDATED'));
});

test('the user directory is searchable and never returns a password hash', async () => {
  const admin = await createUser({ email: 'directory@test.local', role: UserRole.ADMIN });
  await createUser({
    email: 'searchable.person@test.local',
    firstName: 'Nusrat',
    lastName: 'Jahan',
    role: UserRole.STOREKEEPER,
  });

  const response = await fetch(`${base}/api/v1/admin/users?q=Nusrat&limit=10`, {
    headers: authorization(admin._id),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: Array<{ email: string; passwordHash?: string }>;
  };
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].email, 'searchable.person@test.local');
  assert.equal(body.data[0].passwordHash, undefined);

  // A regular-expression metacharacter is treated as literal text, not a pattern.
  const escaped = await fetch(`${base}/api/v1/admin/users?q=${encodeURIComponent('.*')}`, {
    headers: authorization(admin._id),
  });
  assert.equal(((await escaped.json()) as { meta: { total: number } }).meta.total, 0);
});
