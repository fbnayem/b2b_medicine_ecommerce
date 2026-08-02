import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { AuthRequest } from '../middlewares/auth';
import { User } from '../models/User';
import { AuditLog } from '../models/AuditLog';
import { CreateUserSchema } from '@medsupply/validation';
import { assertAdministrable } from '../services/userAdminService';
import { securitySettings } from '../services/settingsService';
import bcrypt from 'bcrypt';

export const getMe = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ data: req.user });
  } catch (error) {
    next(error);
  }
};

export const listUsers = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await User.find().select('-passwordHash');
    res.json({ data: users });
  } catch (error) {
    next(error);
  }
};

export const createUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = CreateUserSchema.parse(req.body);
    const policy = await securitySettings();

    if (data.password.length < policy.passwordMinLength) {
      return res.status(400).json({
        error: {
          code: 'PASSWORD_TOO_SHORT',
          message: `The password must be at least ${policy.passwordMinLength} characters`,
        },
      });
    }

    // The same privilege rules that govern edits govern creation, so an Admin
    // cannot create a Super Admin account as a way around them. There is no
    // target account yet, so none is passed — supplying the actor as their own
    // target made every creation look like a self-demotion.
    await assertAdministrable({
      actor: { _id: req.user!._id, role: req.user!.role as UserRole },
      nextRole: data.role as UserRole,
    });

    const existing = await User.findOne({ email: data.email });
    if (existing) {
      return res
        .status(400)
        .json({ error: { code: 'BAD_REQUEST', message: 'Email already exists' } });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await User.create({
      ...data,
      passwordHash,
      forcePasswordChange: policy.forcePasswordChangeOnCreate,
    });

    const userObj = user.toObject();
    delete (userObj as Record<string, unknown>).passwordHash;

    await AuditLog.create({
      actorId: req.user!._id,
      actorRole: req.user!.role,
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: user._id,
      after: userObj,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.status(201).json({ data: userObj });
  } catch (error) {
    next(error);
  }
};
