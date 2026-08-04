import type { NextFunction, Response } from 'express';
import type { AuthRequest } from './auth';
import { UserRole } from '@medsupply/shared-types';
import { correlationId } from '../services/logger';

/**
 * A role guard that can say which roles it enforces.
 *
 * The guard is a closure, so the list it checks against was previously
 * unreadable from outside — which is why the OpenAPI document could claim one
 * set of roles while the router enforced another, twice, with nothing to catch
 * it. Publishing the list costs one assignment and lets
 * `routeCoverage.test.ts` reconcile the two.
 */
export interface RoleGuard {
  (req: AuthRequest, res: Response, next: NextFunction): void;
  readonly roles: readonly UserRole[];
}

export const requireRole = (roles: UserRole[]): RoleGuard => {
  const guard = (req: AuthRequest, res: Response, next: NextFunction) => {
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

  return Object.assign(guard, { roles: [...roles] as readonly UserRole[] });
};
