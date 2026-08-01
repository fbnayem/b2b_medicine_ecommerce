import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env, isProduction, refreshSecret } from '../env';

/**
 * Token issue, storage and verification.
 *
 * Three things changed in this phase.
 *
 * A refresh token is stored as an HMAC of its value rather than a bcrypt hash.
 * bcrypt exists to make a *low-entropy* secret expensive to guess; a refresh
 * token is 256 bits of randomness inside a signed JWT, so there is nothing to
 * guess, and the deliberate cost was being paid twice on every rotation — once
 * to verify and once to hash the replacement. An HMAC keyed on the refresh
 * secret gives the same protection against a stolen database dump at a
 * thousandth of the cost. Sessions written before this phase still hold bcrypt
 * hashes and are verified with bcrypt until they rotate, so nobody is signed
 * out by the change.
 *
 * An access token now names the session that issued it. Revoking a session used
 * to leave its access token working until it expired, which meant "sign out
 * everywhere" was a promise the system did not keep for another quarter of an
 * hour.
 *
 * The refresh cookie is scoped to the auth routes, so it stops riding along on
 * every request to every other endpoint.
 */

export const REFRESH_COOKIE = 'refreshToken';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface AccessTokenClaims {
  userId: string;
  /** Session identifier. Absent on tokens issued before this phase. */
  sid?: string;
  type?: 'access';
}

export interface RefreshTokenClaims {
  userId: string;
  sessionId: string;
  type?: 'refresh';
}

export const accessTokenTtlSeconds = env.ACCESS_TOKEN_TTL_MINUTES * 60;
export const refreshTokenTtlMs = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * The value stored against a session.
 *
 * Prefixed so the verifier can tell an HMAC from a legacy bcrypt hash without
 * guessing from its shape.
 */
const HMAC_PREFIX = 'hmac:';

export function hashRefreshToken(token: string): string {
  return HMAC_PREFIX + createHmac('sha256', refreshSecret).update(token).digest('hex');
}

/**
 * Constant-time comparison against a stored value, transparently handling the
 * bcrypt hashes written before this phase.
 */
export async function refreshTokenMatches(token: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (!stored.startsWith(HMAC_PREFIX)) {
    // Legacy session. bcrypt.compare is already constant time for its inputs.
    return bcrypt.compare(token, stored).catch(() => false);
  }
  const expected = Buffer.from(hashRefreshToken(token));
  const actual = Buffer.from(stored);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ userId, sid: sessionId, type: 'access' }, env.JWT_SECRET, {
    expiresIn: accessTokenTtlSeconds,
  });
}

export function signRefreshToken(userId: string, sessionId: string): string {
  return jwt.sign(
    // The nonce guarantees that two rotations in the same second produce
    // different tokens, so the stored hash always changes and a replayed
    // predecessor is always detectable.
    { userId, sessionId, type: 'refresh', jti: randomBytes(16).toString('hex') },
    refreshSecret,
    { expiresIn: Math.floor(refreshTokenTtlMs / 1000) },
  );
}

export function issueTokens(userId: string, sessionId: string) {
  return {
    accessToken: signAccessToken(userId, sessionId),
    refreshToken: signRefreshToken(userId, sessionId),
  };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const claims = jwt.verify(token, env.JWT_SECRET) as AccessTokenClaims & { type?: string };
  // A refresh token is signed with a different secret and so cannot verify
  // here, but the explicit check keeps that true if the secrets are ever
  // configured to the same value.
  if (claims.type && claims.type !== 'access') {
    throw Object.assign(new Error('Wrong token type'), { name: 'JsonWebTokenError' });
  }
  return claims;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const claims = jwt.verify(token, refreshSecret) as RefreshTokenClaims & { type?: string };
  if (claims.type && claims.type !== 'refresh') {
    throw Object.assign(new Error('Wrong token type'), { name: 'JsonWebTokenError' });
  }
  return claims;
}

/**
 * Sets the refresh cookie.
 *
 * `sameSite: 'strict'` is what makes this safe to hold a long-lived credential:
 * no cross-site request carries it, so an attacker's page cannot silently mint
 * a fresh access token in a signed-in victim's browser. The path restriction
 * means it is only ever sent to the two endpoints that consume it.
 */
export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshTokenTtlMs,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
  // Deployments that set the cookie before this phase wrote it at the root
  // path; clearing that too stops a stale copy shadowing the scoped one.
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
}
