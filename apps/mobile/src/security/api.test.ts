import { describe, expect, it, vi } from 'vitest';

// The API client pulls in react-native, whose Flow sources the test bundler
// cannot parse. Only the pure presentation and policy helpers are exercised.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

import { translatorFor } from '@medsupply/i18n';
import { deviceLabel, endedLabel, isRevocable, orderSessions, type SessionSummary } from './api';

const t = translatorFor('en');

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
    expect(deviceLabel(t, 'okhttp/4.12.0 Android 14')).toBe('MedSupply mobile on Android');
    expect(deviceLabel(t, 'Expo/57 CFNetwork Darwin')).toBe('MedSupply mobile on iOS');
  });

  it('names desktop browsers so a user can recognise their own', () => {
    expect(deviceLabel(t, 'Mozilla/5.0 (Windows NT 10.0) Chrome/130')).toBe('Chrome on Windows');
    expect(deviceLabel(t, 'Mozilla/5.0 (Macintosh) Safari/605')).toBe('Safari on macOS');
    expect(deviceLabel(t, 'Mozilla/5.0 (X11; Linux) Firefox/131')).toBe('Firefox on Linux');
  });

  it('says so plainly when it cannot tell', () => {
    expect(deviceLabel(t, null)).toBe('Unknown device');
    // `curl/8.0` names neither, and "Unknown app on Unknown kind of device" —
    // which is what this said before — is a worse answer than "Unknown device"
    // to somebody being asked whether they recognise it.
    expect(deviceLabel(t, 'curl/8.0')).toBe('Unknown device');
    // One half known is still worth saying.
    expect(deviceLabel(t, 'curl/8.0 (Windows NT 10.0)')).toBe('Unknown app on Windows');
  });

  it('answers in the language the rest of the screen is in', () => {
    // The whole job of this screen is "do you recognise this device?", and it
    // was answering in English whatever the app was set to.
    expect(deviceLabel(translatorFor('bn'), null)).toBe('অচেনা ডিভাইস');
    expect(endedLabel(translatorFor('bn'), 'TOKEN_REUSE')).toBe('নিরাপত্তার জন্য বন্ধ করা হয়েছে');
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
    expect(endedLabel(t, 'TOKEN_REUSE')).toBe('Ended for safety');
    expect(endedLabel(t, 'REVOKED_BY_ADMIN')).toBe('Ended by an administrator');
    expect(endedLabel(t, 'ROLE_CHANGED')).toBe('Ended after a role change');
    expect(endedLabel(t, 'SIGNED_OUT_EVERYWHERE')).toBe('Signed out everywhere');
    expect(endedLabel(t, 'SIGNED_OUT')).toBe('Signed out');
    expect(endedLabel(t, null)).toBe('Signed out');
  });
});
