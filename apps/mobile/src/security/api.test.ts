import { describe, expect, it, vi } from 'vitest';

// The API client pulls in react-native, whose Flow sources the test bundler
// cannot parse. Only the pure presentation and policy helpers are exercised.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

import {
  describeDevice,
  isRevocable,
  orderSessions,
  revocationLabel,
  type SessionSummary,
} from './api';

const NOW = new Date('2026-08-01T12:00:00.000Z');

function session(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    _id: 'id',
    userAgent: null,
    ipAddress: null,
    createdAt: '2026-07-30T12:00:00.000Z',
    lastUsedAt: null,
    expiresAt: '2026-08-06T12:00:00.000Z',
    revokedAt: null,
    revokedReason: null,
    current: false,
    ...overrides,
  };
}

describe('describing a device', () => {
  it('names the mobile application rather than its HTTP library', () => {
    expect(describeDevice('okhttp/4.12.0 Android 14')).toBe('MedSupply mobile on Android');
    expect(describeDevice('Expo/57 CFNetwork Darwin')).toBe('MedSupply mobile on iOS');
  });

  it('names desktop browsers so a user can recognise their own', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/130')).toBe('Chrome on Windows');
    expect(describeDevice('Mozilla/5.0 (Macintosh) Safari/605')).toBe('Safari on macOS');
    expect(describeDevice('Mozilla/5.0 (X11; Linux) Firefox/131')).toBe('Firefox on Linux');
  });

  it('says so plainly when it cannot tell', () => {
    expect(describeDevice(null)).toBe('Unknown device');
    expect(describeDevice('curl/8.0')).toBe('Unknown client on Unknown platform');
  });
});

describe('whether a session can still be ended', () => {
  it('offers the action only for a live session', () => {
    expect(isRevocable(session({}), NOW)).toBe(true);
    expect(isRevocable(session({ revokedAt: '2026-07-31T00:00:00.000Z' }), NOW)).toBe(false);
    // Already expired: the server would refuse, so the button is not offered.
    expect(isRevocable(session({ expiresAt: '2026-07-31T00:00:00.000Z' }), NOW)).toBe(false);
  });
});

describe('ordering the list', () => {
  it('puts live sessions first, then this device, then the newest', () => {
    const ended = session({ _id: 'ended', revokedAt: '2026-07-31T00:00:00.000Z' });
    const older = session({ _id: 'older', createdAt: '2026-07-20T12:00:00.000Z' });
    const current = session({ _id: 'current', current: true });
    const newer = session({ _id: 'newer', createdAt: '2026-07-31T12:00:00.000Z' });

    const ordered = orderSessions([ended, older, current, newer], NOW).map((row) => row._id);
    expect(ordered).toEqual(['current', 'newer', 'older', 'ended']);
  });

  it('does not mutate the array it was given', () => {
    const rows = [
      session({ _id: 'a' }),
      session({ _id: 'b', revokedAt: '2026-07-31T00:00:00.000Z' }),
    ];
    const snapshot = rows.map((row) => row._id);
    orderSessions(rows, NOW);
    expect(rows.map((row) => row._id)).toEqual(snapshot);
  });
});

describe('explaining why a session ended', () => {
  it('distinguishes a safety revocation from an ordinary sign-out', () => {
    // This is the difference between "I signed out" and "somebody replayed a
    // stolen token", and the user is the only person who can tell them apart.
    expect(revocationLabel('TOKEN_REUSE')).toBe('Ended for safety');
    expect(revocationLabel('REVOKED_BY_ADMIN')).toBe('Ended by an administrator');
    expect(revocationLabel('ROLE_CHANGED')).toBe('Ended after a role change');
    expect(revocationLabel('SIGNED_OUT_EVERYWHERE')).toBe('Signed out everywhere');
    expect(revocationLabel('SIGNED_OUT')).toBe('Signed out');
    expect(revocationLabel(null)).toBe('Signed out');
  });
});
