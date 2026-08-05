import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { UserRole, UserStatus } from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { Session } from '../models/Session';
import { User } from '../models/User';
import { securitySettings } from './settingsService';

export interface AdminActor {
  _id: Types.ObjectId | string;
  role: UserRole;
  ipAddress?: string;
  userAgent?: string;
}

export function adminError(message: string, code: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** Roles only a Super Admin may grant, revoke or edit. */
const PRIVILEGED_ROLES: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

const isPrivileged = (role: UserRole) => PRIVILEGED_ROLES.includes(role);

/**
 * The only accounts a Manager may bring into existence.
 *
 * Planning a round and assigning a delivery are `MANAGEMENT` operations, so the
 * person who needs a delivery person was precisely the person who could not
 * make one — `POST /users` was Admin and above, and the product had no screen
 * for it in any case.
 *
 * A storekeeper is included, which is wider than the rider case strictly needs
 * and is worth stating plainly: **a storekeeper can move stock, so this hands a
 * Manager the ability to create an account that changes inventory.** It is
 * defensible — a Manager already approves orders and posts stocktake variances,
 * both of which move more value than a warehouse account does — and the record
 * of who did it is written either way. What keeps it safe is that the set is
 * exactly these two: never MANAGER, never ADMIN, never SUPER_ADMIN, which are
 * the roles that could then create further accounts.
 */
const MANAGER_MAY_CREATE: UserRole[] = [UserRole.DELIVERY_PERSON, UserRole.STOREKEEPER];

/**
 * Central guard rails for every administrative change to an account.
 *
 * These exist because the failure modes are not recoverable from the product:
 * an Admin quietly promoting themselves to Super Admin, or the last Super Admin
 * locking everyone out of the system.
 */
export async function assertAdministrable(input: {
  actor: AdminActor;
  /**
   * The account being changed, or absent when one is being created. A creation
   * has no existing account to protect, so only the privilege rules apply — the
   * self-demotion and last-Super-Admin rules have nothing to act on.
   *
   * This was previously required, and `createUser` satisfied it by passing the
   * actor as their own target. That made `sameUser` true for every creation, so
   * any role other than the creator's own was rejected as an attempt to change
   * their own role: a Super Admin could only create Super Admins, and no
   * Manager, Storekeeper, Delivery Person or Shop Owner could be created at all.
   */
  target?: { _id: Types.ObjectId; role: UserRole; status: UserStatus };
  nextRole?: UserRole;
  nextStatus?: UserStatus;
}) {
  const { actor, target, nextRole, nextStatus } = input;
  const sameUser = target ? String(actor._id) === String(target._id) : false;

  /*
   * A Manager creating an account, which is the only administrative act they
   * have. `target` absent means creation; the branch below cannot express this
   * because it is about which roles are *privileged*, and every role a Manager
   * must be refused here — including MANAGER itself — is an ordinary one.
   */
  if (actor.role === UserRole.MANAGER && !target) {
    if (!nextRole || !MANAGER_MAY_CREATE.includes(nextRole)) {
      throw adminError(
        'A manager may only create a delivery person or a storekeeper',
        'ROLE_NOT_PERMITTED',
        403,
      );
    }
    return;
  }

  if (actor.role !== UserRole.SUPER_ADMIN) {
    if (target && isPrivileged(target.role)) {
      throw adminError(
        'Only a Super Admin may administer Admin and Super Admin accounts',
        'PRIVILEGED_TARGET',
        403,
      );
    }
    if (nextRole && isPrivileged(nextRole)) {
      throw adminError(
        'Only a Super Admin may grant the Admin or Super Admin role',
        'PRIVILEGED_ROLE',
        403,
      );
    }
  }

  // Self-service demotion or deactivation is how an administrator accidentally
  // locks themselves out mid-session; it must go through another administrator.
  if (sameUser && target && nextRole && nextRole !== target.role) {
    throw adminError('You cannot change your own role', 'SELF_ROLE_CHANGE', 403);
  }
  if (sameUser && nextStatus && nextStatus !== UserStatus.ACTIVE) {
    throw adminError(
      'You cannot deactivate or suspend your own account',
      'SELF_STATUS_CHANGE',
      403,
    );
  }

  const losesSuperAdmin =
    target?.role === UserRole.SUPER_ADMIN &&
    ((nextRole && nextRole !== UserRole.SUPER_ADMIN) ||
      (nextStatus && nextStatus !== UserStatus.ACTIVE));

  if (target && losesSuperAdmin) {
    const remaining = await User.countDocuments({
      _id: { $ne: target._id },
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    });
    if (remaining === 0) {
      throw adminError(
        'The last active Super Admin cannot be demoted or deactivated',
        'LAST_SUPER_ADMIN',
        409,
      );
    }
  }
}

async function audit(input: {
  actor: AdminActor;
  action: string;
  targetId: Types.ObjectId;
  before?: unknown;
  after?: unknown;
}) {
  await AuditLog.create({
    actorId: input.actor._id,
    actorRole: input.actor.role,
    action: input.action,
    entityType: 'User',
    entityId: input.targetId,
    before: input.before,
    after: input.after,
    ipAddress: input.actor.ipAddress,
    userAgent: input.actor.userAgent,
  });
}

/** Never let a password hash or reset artefact leave the service. */
function safeUser(user: InstanceType<typeof User>) {
  const plain = user.toObject();
  delete (plain as Record<string, unknown>).passwordHash;
  return plain;
}

export async function updateUser(input: {
  userId: string;
  changes: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    role?: UserRole;
    status?: UserStatus;
  };
  actor: AdminActor;
}) {
  const user = await User.findById(input.userId);
  if (!user) throw adminError('User not found', 'NOT_FOUND', 404);

  const target = {
    _id: user._id,
    role: user.role as UserRole,
    status: user.status as UserStatus,
  };
  await assertAdministrable({
    actor: input.actor,
    target,
    nextRole: input.changes.role,
    nextStatus: input.changes.status,
  });

  const before = safeUser(user);
  const roleChanged = input.changes.role !== undefined && input.changes.role !== user.role;
  const statusChanged = input.changes.status !== undefined && input.changes.status !== user.status;

  if (input.changes.firstName !== undefined) user.firstName = input.changes.firstName;
  if (input.changes.lastName !== undefined) user.lastName = input.changes.lastName;
  if (input.changes.phone !== undefined) {
    (user as unknown as { phone?: string }).phone = input.changes.phone || undefined;
  }
  if (input.changes.role !== undefined) user.role = input.changes.role;
  if (input.changes.status !== undefined) user.status = input.changes.status;
  await user.save();

  const after = safeUser(user);
  await audit({ actor: input.actor, action: 'USER_UPDATED', targetId: user._id, before, after });
  if (roleChanged) {
    await audit({
      actor: input.actor,
      action: 'USER_ROLE_CHANGED',
      targetId: user._id,
      before: { role: before.role },
      after: { role: after.role },
    });
  }
  if (statusChanged) {
    await audit({
      actor: input.actor,
      action: 'USER_STATUS_CHANGED',
      targetId: user._id,
      before: { status: before.status },
      after: { status: after.status },
    });
  }

  // A revoked role or a deactivated account must not keep an existing session.
  if (roleChanged || (statusChanged && user.status !== UserStatus.ACTIVE)) {
    await revokeSessions({
      userId: String(user._id),
      reason: roleChanged ? 'Role changed' : 'Account status changed',
      actor: input.actor,
    });
  }

  return after;
}

export async function resetPassword(input: {
  userId: string;
  temporaryPassword: string;
  reason: string;
  actor: AdminActor;
}) {
  const user = await User.findById(input.userId);
  if (!user) throw adminError('User not found', 'NOT_FOUND', 404);
  await assertAdministrable({
    actor: input.actor,
    target: { _id: user._id, role: user.role as UserRole, status: user.status as UserStatus },
  });

  const { passwordMinLength } = await securitySettings();
  if (input.temporaryPassword.length < passwordMinLength) {
    throw adminError(
      `The temporary password must be at least ${passwordMinLength} characters`,
      'PASSWORD_TOO_SHORT',
    );
  }

  user.passwordHash = await bcrypt.hash(input.temporaryPassword, 10);
  user.forcePasswordChange = true;
  user.loginAttempts = 0;
  user.lockoutUntil = undefined;
  await user.save();

  // The password itself is never audited; only that a reset happened and why.
  await audit({
    actor: input.actor,
    action: 'USER_PASSWORD_RESET',
    targetId: user._id,
    after: { reason: input.reason, forcePasswordChange: true },
  });

  await revokeSessions({
    userId: String(user._id),
    reason: 'Password reset by an administrator',
    actor: input.actor,
    skipAudit: true,
  });

  return safeUser(user);
}

export async function revokeSessions(input: {
  userId: string;
  reason: string;
  actor: AdminActor;
  skipAudit?: boolean;
}) {
  const result = await Session.updateMany(
    { userId: input.userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  if (!input.skipAudit) {
    await audit({
      actor: input.actor,
      action: 'USER_SESSIONS_REVOKED',
      targetId: new Types.ObjectId(input.userId),
      after: { revoked: result.modifiedCount, reason: input.reason },
    });
  }
  return { revoked: result.modifiedCount };
}

export async function listUsersPaged(query: {
  page: number;
  limit: number;
  role?: UserRole;
  status?: UserStatus;
  q?: string;
}) {
  const filter: Record<string, unknown> = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.q) {
    // Escaped so a search term cannot become a regular expression.
    const safe = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(safe, 'i');
    filter.$or = [{ email: pattern }, { firstName: pattern }, { lastName: pattern }];
  }

  const [items, total] = await Promise.all([
    User.find(filter)
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return { items, total, page: query.page, limit: query.limit };
}
