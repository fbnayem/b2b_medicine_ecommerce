import type { NextFunction, Response } from 'express';
import type { AuthRequest } from './auth';
import { UserRole } from '@medsupply/shared-types';
import { correlationId } from '../services/logger';

export const requireRole = (roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
          correlationId: correlationId(),
        },
      });
    }

    if (!roles.includes(req.user.role as UserRole)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
          correlationId: correlationId(),
        },
      });
    }

    next();
  };
};
