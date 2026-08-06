import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { Session } from '../models/Session';
import { Shop } from '../models/Shop';
import { ChangePasswordSchema, LoginSchema, RegisterShopSchema } from '@medsupply/validation';
import { ShopStatus, UserStatus, UserRole } from '@medsupply/shared-types';
import type { AuthRequest } from '../middlewares/auth';
import { AuditLog } from '../models/AuditLog';
import { securitySettings } from '../services/settingsService';
import { correlationId, logger } from '../services/logger';
import {
  clearRefreshCookie,
  hashRefreshToken,
  issueTokens,
  refreshTokenMatches,
  refreshTokenTtlMs,
  setRefreshCookie,
  verifyRefreshToken,
} from '../services/tokenService';

/**
 * AGENTS requires login to be audited. A failed attempt records the account it
 * targeted but never the submitted password, and an unknown email records no
 * actor at all rather than inventing one.
 */
async function auditAuth(
  req: Request,
  action: string,
  userId: mongoose.Types.ObjectId | undefined,
  role: UserRole | undefined,
  detail?: Record<string, unknown>,
) {
  if (!userId) return;
  await AuditLog.create({
    actorId: userId,
    actorRole: role ?? UserRole.SHOP_OWNER,
    action,
    entityType: 'User',
    entityId: userId,
    after: detail,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    correlationId: correlationId(),
  });
}

/**
 * A bcrypt comparison against a throwaway hash.
 *
 * Sign-in used to return immediately when the email was unknown and spend
 * roughly a tenth of a second hashing when it was not, so the response time
 * alone told an attacker which addresses have accounts. Every attempt now pays
 * the same cost.
 */
const DECOY_HASH = bcrypt.hashSync('password-that-is-never-correct', 10);

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);

    const user = await User.findOne({ email });
    if (!user) {
      await bcrypt.compare(password, DECOY_HASH);
      return res
        .status(401)
        .json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });
    }

    if (user.status !== UserStatus.ACTIVE) {
      await bcrypt.compare(password, DECOY_HASH);
      return res
        .status(403)
        .json({ error: { code: 'FORBIDDEN', message: 'Account is not active' } });
    }

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      await bcrypt.compare(password, DECOY_HASH);
      await auditAuth(req, 'LOGIN_BLOCKED', user._id, user.role as UserRole, {
        reason: 'Account locked',
        lockoutUntil: user.lockoutUntil,
      });
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Account locked due to too many failed attempts' },
      });
    }

    // Lockout thresholds come from System Settings so they can be tightened
    // without a redeploy; the environment remains the fallback.
    const policy = await securitySettings();
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      user.loginAttempts += 1;
      const locked = user.loginAttempts >= policy.maxLoginAttempts;
      if (locked) {
        user.lockoutUntil = new Date(Date.now() + policy.lockoutMinutes * 60 * 1000);
      }
      await user.save();
      await auditAuth(
        req,
        locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
        user._id,
        user.role as UserRole,
        {
          attempts: user.loginAttempts,
          maxAttempts: policy.maxLoginAttempts,
        },
      );
      return res
        .status(401)
        .json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });
    }

    user.loginAttempts = 0;
    user.lockoutUntil = undefined;
    user.lastLogin = new Date();
    await user.save();

    // The session identifier is needed to sign the tokens and the token hash is
    // needed to store the session, so the record is created first and completed
    // immediately. The placeholder can never authenticate: it is not a valid
    // HMAC and no token hashes to it.
    const session = await Session.create({
      userId: user._id,
      refreshTokenHash: 'pending',
      userAgent: req.get('user-agent'),
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + refreshTokenTtlMs),
      lastUsedAt: new Date(),
    });

    const { accessToken, refreshToken } = issueTokens(user.id, session.id);
    session.refreshTokenHash = hashRefreshToken(refreshToken);
    await session.save();

    setRefreshCookie(res, refreshToken);

    await auditAuth(req, 'LOGIN_SUCCEEDED', user._id, user.role as UserRole, {
      sessionId: session.id,
      forcePasswordChange: user.forcePasswordChange,
    });

    // `user` serialises through the model transform, which removes the password
    // hash and the lockout counters.
    res.json({ data: { user, accessToken, refreshToken } });
  } catch (error) {
    next(error);
  }
};

/**
 * A pharmacy registering itself, with nobody from the distributor involved.
 *
 * This was raised as inappropriate for a wholesale product — credit terms,
 * licence checks and price lists are staff decisions — and building it anyway
 * was the answer. Two facts from the existing code are what make it defensible
 * rather than merely possible, and both are load-bearing:
 *
 *   1. `orderController` refuses a submission unless the shop is `ACTIVE`, so a
 *      self-registered shop **must** be created `ACTIVE` or it can browse the
 *      catalogue and never buy anything — a worse outcome than not offering
 *      registration at all.
 *   2. **Credit is checked at approval, not at submission**
 *      (`approvalService.ts`). Every order this shop places still lands in a
 *      manager's queue, and with a credit limit of zero a credit order is
 *      refused there unless a manager overrides it with a written reason.
 *
 * So registration creates *work for a manager*, not financial exposure. The
 * shop can trade prepaid from the first minute and a human decides everything
 * else. Nothing in the request body can change that: the four commercial
 * fields are written from constants below and are not read from `data`.
 *
 * Both records are created in one transaction. A user with no shop can sign in
 * and reach a screen that says no shop is linked to the account, with no way to
 * fix it; a shop with no owner is invisible to everybody. Half of this is worse
 * than none of it.
 */
export const register = async (req: Request, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  try {
    const data = RegisterShopSchema.parse(req.body);

    const policy = await securitySettings();
    if (data.password.length < policy.passwordMinLength) {
      return res.status(400).json({
        error: {
          code: 'PASSWORD_TOO_SHORT',
          message: `The password must be at least ${policy.passwordMinLength} characters`,
        },
      });
    }

    /*
     * Which one is taken, not "something is taken".
     *
     * Both are unique indexes, so the database refuses a duplicate either way —
     * but a message that does not say *which* field leaves somebody retyping an
     * email address that was never the problem. The index remains the authority
     * against a race; this is here so the usual case reads properly.
     */
    if (await User.findOne({ email: data.email })) {
      return res.status(400).json({
        error: {
          code: 'EMAIL_IN_USE',
          message: 'An account already exists for this email address. Sign in instead.',
        },
      });
    }
    if (await Shop.findOne({ primaryPhone: data.primaryPhone })) {
      return res.status(400).json({
        error: {
          code: 'PHONE_IN_USE',
          message: 'A shop is already registered with this phone number.',
        },
      });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    let created: { userId: mongoose.Types.ObjectId; shop: InstanceType<typeof Shop> } | undefined;

    await session.withTransaction(async () => {
      const [user] = await User.create(
        [
          {
            email: data.email,
            passwordHash,
            firstName: data.firstName,
            lastName: data.lastName,
            role: UserRole.SHOP_OWNER,
            status: UserStatus.ACTIVE,
            /*
             * Not forced. `forcePasswordChangeOnCreate` exists because a member
             * of staff typing somebody else's first password means two people
             * know it. Here the person chose it themselves and nobody else has
             * ever seen it, so demanding they change it immediately would be a
             * ritual with no threat behind it.
             */
            forcePasswordChange: false,
          },
        ],
        { session },
      );

      const [shop] = await Shop.create(
        [
          {
            name: data.shopName,
            primaryPhone: data.primaryPhone,
            email: data.email,
            drugLicenceNumber: data.drugLicenceNumber,
            ownerIds: [user!._id],
            billingAddress: { ...data.address, isDefault: true },
            // The same address for both. A pharmacy registering from a phone
            // has one shop at one address, and asking twice on a small screen
            // is how a form gets abandoned. More can be added afterwards.
            deliveryAddresses: [{ ...data.address, isDefault: true }],
            status: ShopStatus.ACTIVE,
            // The four that are **not** read from the request. A customer does
            // not set their own commercial terms.
            creditLimit: 0,
            paymentTermsDays: 0,
            defaultDiscount: 0,
            priceListId: null,
            selfRegisteredAt: new Date(),
          },
        ],
        { session },
      );

      /*
       * Two records, and neither names an actor other than the person
       * themselves — because there was not one. `createdBy` is deliberately
       * left unset for the same reason: inventing an administrator here would
       * make the audit trail claim a decision nobody took.
       */
      await AuditLog.create(
        [
          {
            actorId: user!._id,
            actorRole: UserRole.SHOP_OWNER,
            action: 'USER_CREATED',
            entityType: 'User',
            entityId: user!._id,
            after: { email: data.email, role: UserRole.SHOP_OWNER, selfRegistered: true },
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            correlationId: correlationId(),
          },
          {
            actorId: user!._id,
            actorRole: UserRole.SHOP_OWNER,
            action: 'SHOP_SELF_REGISTERED',
            entityType: 'Shop',
            entityId: shop!._id,
            after: {
              name: shop!.name,
              reference: shop!.reference,
              primaryPhone: shop!.primaryPhone,
              drugLicenceNumber: shop!.drugLicenceNumber,
              // Written out rather than implied: this is the record that says
              // no member of staff agreed to any of it.
              creditLimit: 0,
              paymentTermsDays: 0,
              defaultDiscount: 0,
              priceListId: null,
            },
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            correlationId: correlationId(),
          },
        ],
        { session, ordered: true },
      );

      created = { userId: user!._id, shop: shop! };
    });

    /*
     * No session and no tokens. Registering is not signing in: the sign-in path
     * is where lockout, `forcePasswordChange` and the wrong-application refusal
     * live, and a second way in that skips all three is a second thing to keep
     * correct. The client sends them to the sign-in screen with the address
     * already typed.
     */
    res.status(201).json({
      data: {
        shop: { reference: created!.shop.reference, name: created!.shop.name },
        email: data.email,
      },
    });
  } catch (error) {
    // The unique indexes are the real authority, and a race between the checks
    // above and the insert lands here. `E11000` is a rejected request, not a
    // server fault, so it must not become a 500 with a correlation id.
    if ((error as { code?: number }).code === 11000) {
      const field = Object.keys(
        (error as { keyPattern?: Record<string, number> }).keyPattern ?? {},
      );
      return res.status(400).json({
        error: {
          code: field.includes('email') ? 'EMAIL_IN_USE' : 'PHONE_IN_USE',
          message: 'Those details are already registered. Sign in instead.',
        },
      });
    }
    next(error);
  } finally {
    await session.endSession();
  }
};

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No refresh token' } });
    }

    let claims;
    try {
      claims = verifyRefreshToken(refreshToken);
    } catch {
      return res
        .status(401)
        .json({ error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } });
    }

    const session = await Session.findById(claims.sessionId);
    if (!session) {
      clearRefreshCookie(res);
      return res
        .status(401)
        .json({ error: { code: 'UNAUTHORIZED', message: 'Session not found' } });
    }

    const matches = await refreshTokenMatches(refreshToken, session.refreshTokenHash);

    /**
     * Reuse detection.
     *
     * A token that carries this session's valid signature but does not match
     * the hash currently stored is a token that was already rotated away. There
     * are only two explanations: the legitimate holder lost the response that
     * carried the replacement, or somebody else is replaying a copy they should
     * not have. Both are handled the same way, because the system cannot tell
     * them apart and the cost of being wrong in one direction is a stolen
     * account while in the other it is a sign-in.
     *
     * Previously only an already-revoked session triggered this; a replayed
     * predecessor was answered with an error and left the live session running,
     * which is precisely the case reuse detection exists to catch.
     */
    if (session.revokedAt || !matches) {
      const reason = session.revokedAt ? 'revoked session' : 'rotated token replayed';
      await Session.updateMany(
        { userId: session.userId, revokedAt: null },
        { revokedAt: new Date(), revokedReason: 'TOKEN_REUSE' },
      );
      const user = await User.findById(session.userId).select('role');
      await auditAuth(req, 'REFRESH_TOKEN_REUSE_DETECTED', session.userId, user?.role as UserRole, {
        sessionId: String(session._id),
        reason,
      });
      logger.warn('Refresh token reuse detected; every session for the user was revoked', {
        reason,
      });
      clearRefreshCookie(res);
      return res.status(401).json({
        error: {
          code: 'TOKEN_REUSE_DETECTED',
          message: 'This sign-in was ended for safety. Sign in again.',
        },
      });
    }

    if (session.expiresAt <= new Date()) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
    }

    // An account disabled since the session began must not be able to keep
    // renewing its way past that decision.
    const user = await User.findById(session.userId).select('status role');
    if (!user || user.status !== UserStatus.ACTIVE) {
      session.revokedAt = new Date();
      session.revokedReason = 'REVOKED_BY_ADMIN';
      await session.save();
      clearRefreshCookie(res);
      return res
        .status(403)
        .json({ error: { code: 'FORBIDDEN', message: 'Account is not active' } });
    }

    const rotated = issueTokens(String(session.userId), session.id);
    session.refreshTokenHash = hashRefreshToken(rotated.refreshToken);
    session.lastUsedAt = new Date();
    await session.save();

    setRefreshCookie(res, rotated.refreshToken);
    res.json({ data: { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken } });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (refreshToken) {
      try {
        const claims = verifyRefreshToken(refreshToken);
        await Session.findByIdAndUpdate(claims.sessionId, {
          revokedAt: new Date(),
          revokedReason: 'SIGNED_OUT',
        });
      } catch {
        // A token that no longer verifies cannot identify a session; the
        // cookie is still cleared below so the browser stops presenting it.
      }
    } else if (req.sessionId) {
      // Mobile signs out with its access token and no cookie.
      await Session.findByIdAndUpdate(req.sessionId, {
        revokedAt: new Date(),
        revokedReason: 'SIGNED_OUT',
      });
    }
    clearRefreshCookie(res);
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
};

export const logoutAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await Session.updateMany(
      { userId: req.user!._id, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'SIGNED_OUT_EVERYWHERE' },
    );
    await auditAuth(req, 'SESSIONS_REVOKED_BY_OWNER', req.user!._id, req.user!.role as UserRole, {
      revoked: result.modifiedCount,
    });
    clearRefreshCookie(res);
    res.json({ data: { success: true, revoked: result.modifiedCount } });
  } catch (error) {
    next(error);
  }
};

/**
 * The signed-in user's own sessions.
 *
 * Session revocation existed for administrators from Phase 10, but a user could
 * neither see where their account was signed in nor end a session themselves —
 * so the answer to a lost phone was to ask an administrator. No token or hash
 * is returned; a session is identified by where and when it started.
 */
export const listOwnSessions = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sessions = await Session.find({ userId: req.user!._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('userAgent ipAddress createdAt lastUsedAt expiresAt revokedAt revokedReason')
      .lean();

    res.json({
      data: sessions.map((session) => ({
        _id: String(session._id),
        userAgent: session.userAgent ?? null,
        ipAddress: session.ipAddress ?? null,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt ?? null,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt ?? null,
        revokedReason: session.revokedReason ?? null,
        current: req.sessionId ? String(session._id) === req.sessionId : false,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const revokeOwnSession = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Unknown session' } });
    }
    // Scoped to the owner, so the identifier of somebody else's session is
    // simply not found rather than usable.
    const session = await Session.findOne({ _id: req.params.id, userId: req.user!._id });
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown session' } });
    }
    if (!session.revokedAt) {
      session.revokedAt = new Date();
      session.revokedReason = 'SIGNED_OUT';
      await session.save();
      await auditAuth(req, 'SESSION_REVOKED_BY_OWNER', req.user!._id, req.user!.role as UserRole, {
        sessionId: String(session._id),
      });
    }
    if (req.sessionId && String(session._id) === req.sessionId) clearRefreshCookie(res);
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
};

/**
 * Changing your own password.
 *
 * There was no way to do this. `forcePasswordChange` was set on account
 * creation and on an administrative reset, returned at sign-in, and rendered as
 * a line of advisory text — but it was never checked in the auth middleware or
 * in any client guard, and no endpoint existed to satisfy it. An
 * administrator-issued temporary password was therefore permanent, and the flag
 * was decoration on a security control.
 *
 * Every *other* session is revoked on success. Not this one: signing the user
 * out of the browser they just used would be punishing them for doing the right
 * thing. The reason to revoke the rest is that a password change is what
 * somebody does when they think their credential is known to another person,
 * and that person may be holding a live session.
 */
export const changePassword = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = ChangePasswordSchema.parse(req.body);
    const user = await User.findById(req.user!._id).select('+passwordHash');
    if (!user)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });

    const policy = await securitySettings();
    if (newPassword.length < policy.passwordMinLength) {
      return res.status(400).json({
        error: {
          code: 'PASSWORD_TOO_SHORT',
          message: `Choose a password of at least ${policy.passwordMinLength} characters.`,
        },
      });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({
        error: {
          code: 'PASSWORD_UNCHANGED',
          message: 'Choose a password you have not just been using.',
        },
      });
    }

    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      // Deliberately not "wrong password": this endpoint is reached only by
      // somebody already signed in, so there is nothing to enumerate, and a
      // vague message here would just make a typo hard to diagnose.
      return res.status(400).json({
        error: {
          code: 'CURRENT_PASSWORD_INCORRECT',
          message: 'That is not your current password.',
        },
      });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.forcePasswordChange = false;
    await user.save();

    const revoked = await Session.updateMany(
      { userId: user._id, revokedAt: null, _id: { $ne: req.sessionId } },
      { $set: { revokedAt: new Date() } },
    );

    await AuditLog.create({
      actorId: user._id,
      actorRole: user.role,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user._id,
      // The password itself is never recorded, in any form.
      after: { otherSessionsRevoked: revoked.modifiedCount },
      correlationId: correlationId(),
    });

    res.json({ data: { otherSessionsRevoked: revoked.modifiedCount } });
  } catch (error) {
    next(error);
  }
};
