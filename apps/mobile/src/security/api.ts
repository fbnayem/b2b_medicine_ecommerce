import { apiClient } from '../api/client';

/**
 * Session management for the mobile client.
 *
 * A phone is the device most likely to be lost, so the ability to end a session
 * from another device matters more here than anywhere else. The transport is
 * kept in this module and the screen stays presentational, in line with the
 * rule that business logic does not live in components.
 */

export interface SessionSummary {
  _id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  current: boolean;
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const response = await apiClient.get('/auth/sessions');
  // A truncated or unexpected payload degrades to "no sessions" rather than
  // throwing and blanking the screen.
  return Array.isArray(response.data?.data) ? (response.data.data as SessionSummary[]) : [];
}

export async function revokeSession(sessionId: string): Promise<void> {
  await apiClient.delete(`/auth/sessions/${sessionId}`);
}

export async function revokeEverySession(): Promise<number> {
  const response = await apiClient.post('/auth/logout-all');
  return Number(response.data?.data?.revoked ?? 0);
}

/**
 * Names a session in terms its owner can recognise. A user asked "is this you?"
 * cannot answer from a user-agent string.
 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const platform = /android/i.test(userAgent)
    ? 'Android'
    : /iphone|ipad|ios|darwin/i.test(userAgent)
      ? 'iOS'
      : /windows/i.test(userAgent)
        ? 'Windows'
        : /mac os|macintosh/i.test(userAgent)
          ? 'macOS'
          : /linux/i.test(userAgent)
            ? 'Linux'
            : 'Unknown platform';
  const client = /okhttp|expo|medsupply/i.test(userAgent)
    ? 'MedSupply mobile'
    : /edg\//i.test(userAgent)
      ? 'Edge'
      : /chrome\//i.test(userAgent)
        ? 'Chrome'
        : /firefox\//i.test(userAgent)
          ? 'Firefox'
          : /safari\//i.test(userAgent)
            ? 'Safari'
            : 'Unknown client';
  return `${client} on ${platform}`;
}

/** Why a session ended, in words rather than an enum. */
export function revocationLabel(reason: string | null): string {
  switch (reason) {
    case 'TOKEN_REUSE':
      return 'Ended for safety';
    case 'REVOKED_BY_ADMIN':
      return 'Ended by an administrator';
    case 'ROLE_CHANGED':
      return 'Ended after a role change';
    case 'SIGNED_OUT_EVERYWHERE':
      return 'Signed out everywhere';
    default:
      return 'Signed out';
  }
}

/**
 * Whether a session can still be ended. Doing this locally keeps the interface
 * from offering an action the server would refuse anyway.
 */
export function isRevocable(session: SessionSummary, now = new Date()): boolean {
  return !session.revokedAt && new Date(session.expiresAt) > now;
}

/** Sessions to show first: live ones, newest first, then the ended ones. */
export function orderSessions(sessions: SessionSummary[], now = new Date()): SessionSummary[] {
  return [...sessions].sort((left, right) => {
    const liveDifference = Number(isRevocable(right, now)) - Number(isRevocable(left, now));
    if (liveDifference !== 0) return liveDifference;
    if (left.current !== right.current) return left.current ? -1 : 1;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}
