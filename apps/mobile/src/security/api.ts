import { describeDevice, revocationReason } from '@medsupply/utilities';
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

type Translate = (path: string, values?: Record<string, string | number>) => string;

/**
 * Names a session in terms its owner can recognise, in their own language.
 *
 * A user asked "is this you?" cannot answer from a user-agent string. The
 * classification is `describeDevice` in `@medsupply/utilities` — both clients
 * held their own copy of it, already one regex apart — and the words around it
 * come from the catalogue, because "Unknown device" is a sentence and `Chrome`
 * is a proper noun.
 */
export function deviceLabel(t: Translate, userAgent: string | null): string {
  const { client, platform } = describeDevice(userAgent);
  if (!client && !platform) return t('security.unknownDevice');
  return t('security.deviceOn', {
    client: client ?? t('security.unknownClient'),
    platform: platform ?? t('security.unknownPlatform'),
  });
}

/** Why a session ended, in words rather than an enum. */
export function endedLabel(t: Translate, reason: string | null): string {
  const key = revocationReason(reason);
  return t(`security.ended${key.charAt(0).toUpperCase()}${key.slice(1)}`);
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
