import { describe, expect, it, vi } from 'vitest';
import { NotificationChannel, NotificationEvent } from '@medsupply/shared-types';

// The API client pulls in react-native, whose Flow sources the test bundler
// cannot parse. These modules are not exercised by the pure helpers below.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));
vi.mock('../store/useAuth', () => ({ useAuthStore: { getState: () => ({ accessToken: null }) } }));
vi.mock('socket.io-client', () => ({ io: () => null }));

import type { CatalogueEntry, PreferencePayload } from './api';
import { effectiveChannels, toggleChannel, toggleMuted } from './api';
import { realtimeOrigin } from './realtime';

const entry: CatalogueEntry = {
  event: NotificationEvent.ORDER_APPROVED,
  category: 'APPROVAL',
  priority: 'HIGH',
  defaultChannels: [NotificationChannel.PUSH],
} as CatalogueEntry;

const preference = (overrides: Partial<PreferencePayload> = {}): PreferencePayload => ({
  defaultChannels: null,
  overrides: [],
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  mutedEvents: [],
  ...overrides,
});

describe('mobile preference resolution', () => {
  it('falls back through override, account default, then template default', () => {
    expect(effectiveChannels(entry, preference())).toEqual([NotificationChannel.PUSH]);

    expect(
      effectiveChannels(entry, preference({ defaultChannels: [NotificationChannel.EMAIL] })),
    ).toEqual([NotificationChannel.EMAIL]);

    expect(
      effectiveChannels(
        entry,
        preference({
          defaultChannels: [NotificationChannel.EMAIL],
          overrides: [{ event: entry.event, channels: [NotificationChannel.SMS] }],
        }),
      ),
    ).toEqual([NotificationChannel.SMS]);
  });

  it('toggling a channel writes exactly one override for the event', () => {
    const added = toggleChannel(entry, preference(), NotificationChannel.EMAIL);
    expect(added.overrides).toEqual([
      { event: entry.event, channels: [NotificationChannel.PUSH, NotificationChannel.EMAIL] },
    ]);

    const removed = toggleChannel(entry, added, NotificationChannel.PUSH);
    expect(removed.overrides).toHaveLength(1);
    expect(removed.overrides[0].channels).toEqual([NotificationChannel.EMAIL]);
  });

  it('muting and unmuting an event is reversible without losing channels', () => {
    const withChannels = toggleChannel(entry, preference(), NotificationChannel.EMAIL);
    const muted = toggleMuted(entry, withChannels);
    expect(muted.mutedEvents).toEqual([entry.event]);
    expect(muted.overrides).toEqual(withChannels.overrides);

    const unmuted = toggleMuted(entry, muted);
    expect(unmuted.mutedEvents).toEqual([]);
  });
});

describe('realtime origin', () => {
  it('strips the REST prefix so the socket reaches the server root', () => {
    expect(realtimeOrigin('http://10.0.2.2:5000/api/v1')).toBe('http://10.0.2.2:5000');
    expect(realtimeOrigin('https://api.example.com/api/v1/')).toBe('https://api.example.com');
    expect(realtimeOrigin('https://api.example.com')).toBe('https://api.example.com');
  });
});
