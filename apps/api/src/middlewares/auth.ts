import type { NextFunction, Request, Response } from 'express';
import { UserStatus } from '@medsupply/shared-types';
import { User } from '../models/User';
import { Session } from '../models/Session';
import { correlationId, currentContext } from '../services/logger';
import { verifyAccessToken } from '../services/tokenService';

export type AuthenticatedUser = InstanceType<typeof User>;

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
  /** Session the presented access token was issued by, when it names one. */
  sessionId?: string;
}

/**
 * Refusals raised inside middleware never reach the error handler, so they
 * attach the correlation identifier themselves. A caller told only "signed out"
 * has nothing to quote when they report it.
 */
const unauthorised = (res: Response, message: string) =>
  res
    .status(401)
    .json({ error: { code: 'UNAUTHORIZED', message, correlationId: correlationId() } });

/**
 * Authenticates a bearer token.
 *
 * Beyond verifying the signature this now checks that the session behind the
 * token is still live. Without that, revoking a session — whether an
 * administrator disabling a departing employee or a user signing out a lost
 * phone — left the existing access token working until it expired. The extra
 * lookup runs alongside the user lookup, both by primary key.
 */
export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return unauthorised(res, 'No token provided');
  }

  let claims;
  try {
    claims = verifyAccessToken(authHeader.slice('Bearer '.length).trim());
  } catch {
    return unauthorised(res, 'Invalid or expired token');
  }

  try {
    const [user, session] = await Promise.all([
      User.findById(claims.userId).select('-passwordHash'),
      // Tokens issued before this phase carry no session identifier. They are
      // accepted until they expire, which is at most one access-token lifetime
      // after a deployment, rather than signing every user out on release.
      claims.sid ? Session.findById(claims.sid).select('revokedAt expiresAt userId') : null,
    ]);

    if (!user) return unauthorised(res, 'User not found');

    if (claims.sid) {
      const now = new Date();
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= now ||
        String(session.userId) !== String(user._id)
      ) {
        return unauthorised(res, 'This session has been signed out');
      }
      req.sessionId = String(session._id);
    }

    if (user.status !== UserStatus.ACTIVE) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Account is not active',
          correlationId: correlationId(),
        },
      });
    }

    req.user = user;

    // Attributing the rest of this request's log lines to the actor.
    const context = currentContext();
    if (context) {
      context.userId = String(user._id);
      context.role = String(user.role);
    }

    /*
     * Checked here rather than as a separate mount-level middleware, because a
     * mount-level one runs *before* this and therefore sees no `req.user` at
     * all — it passed every request, silently, which is exactly the shape of
     * defect this whole plan is about. Every authenticated route runs through
     * this function, so there is nowhere for a new endpoint to hide.
     */
    if (user.forcePasswordChange && !passwordChangeExempt(req)) {
      return res.status(403).json({
        error: {
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Choose a new password before continuing.',
          correlationId: correlationId(),
        },
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * The endpoints a user carrying `forcePasswordChange` may still reach.
 *
 * Deliberately tiny, and deliberately an allow-list rather than a deny-list: a
 * new endpoint should be closed to a user who has not yet chosen a password,
 * not open by omission.
 */
const PERMITTED_WHILE_FORCED = new Set([
  'POST /api/v1/auth/change-password',
  'GET /api/v1/users/me',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/logout-all',
  'POST /api/v1/auth/refresh',
]);

/**
 * Whether this request is one of the few a forced user may make.
 *
 * Matched on `originalUrl` rather than on `baseUrl + path`: inside a
 * `router.use` those two do not reconstruct the request line — `req.path` is
 * "/" for a request to the mount root — and a guard that silently matches
 * nothing is a guard that permits everything.
 */
function passwordChangeExempt(req: Request): boolean {
  const path = req.originalUrl.split('?')[0].replace(/\/$/, '');
  return PERMITTED_WHILE_FORCED.has(`${req.method} ${path}`);
}
