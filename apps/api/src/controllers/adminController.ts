import { NextFunction, Response } from 'express';
import { Types } from 'mongoose';
import { UserRole, UserStatus } from '@medsupply/shared-types';
import {
  AdminPasswordResetSchema,
  AdminSessionRevokeSchema,
  AdminUserListQuerySchema,
  AdminUserUpdateSchema,
  AuditLogQuerySchema,
} from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import { AuditLog } from '../models/AuditLog';
import { Session } from '../models/Session';
import { User } from '../models/User';
import {
  listUsersPaged,
  resetPassword,
  revokeSessions,
  updateUser,
  type AdminActor,
} from '../services/userAdminService';

const actor = (req: AuthRequest): AdminActor => ({
  _id: req.user!._id,
  role: req.user!.role as UserRole,
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
});

export async function listUsers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = AdminUserListQuerySchema.parse(req.query);
    const result = await listUsersPaged({
      page: query.page,
      limit: query.limit,
      role: query.role as UserRole | undefined,
      status: query.status as UserStatus | undefined,
      q: query.q,
    });
    res.json({
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit },
    });
  } catch (error) {
    next(error);
  }
}

export async function getUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash').lean();
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    const sessions = await Session.countDocuments({
      userId: user._id,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });
    res.json({ data: { ...user, activeSessions: sessions } });
  } catch (error) {
    next(error);
  }
}

export async function patchUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const changes = AdminUserUpdateSchema.parse(req.body);
    const updated = await updateUser({
      userId: String(req.params.id),
      changes: {
        firstName: changes.firstName,
        lastName: changes.lastName,
        phone: changes.phone,
        role: changes.role as UserRole | undefined,
        status: changes.status as UserStatus | undefined,
      },
      actor: actor(req),
    });
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
}

export async function resetUserPassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = AdminPasswordResetSchema.parse(req.body);
    const updated = await resetPassword({
      userId: String(req.params.id),
      temporaryPassword: input.temporaryPassword,
      reason: input.reason,
      actor: actor(req),
    });
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
}

export async function revokeUserSessions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = AdminSessionRevokeSchema.parse(req.body);
    const result = await revokeSessions({
      userId: String(req.params.id),
      reason: input.reason,
      actor: actor(req),
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

/**
 * Read-only audit access. The log is append-only and has no write endpoint, so
 * this is the entire administrative surface over it.
 */
export async function listAuditLog(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = AuditLogQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (query.action) filter.action = query.action;
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = new Types.ObjectId(query.entityId);
    if (query.actorId) filter.actorId = new Types.ObjectId(query.actorId);
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range.$gte = query.from;
      if (query.to) range.$lte = query.to;
      filter.createdAt = range;
    }

    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('actorId', 'firstName lastName email role')
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      data: items,
      meta: { total, page: query.page, limit: query.limit },
    });
  } catch (error) {
    next(error);
  }
}

/** Distinct action names, so the viewer can offer a filter without a free-text guess. */
export async function auditActions(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const actions = await AuditLog.distinct('action');
    res.json({ data: (actions as string[]).sort() });
  } catch (error) {
    next(error);
  }
}
