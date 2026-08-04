// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole, UserStatus } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { renderWithUi } from '../testing/render';
import { SecurityCentre } from './SecurityCentre';
import { describeDevice, formatUptime, revocationLabel } from './securityLabels';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const get = vi.mocked(apiClient.get);
const del = vi.mocked(apiClient.delete);
const post = vi.mocked(apiClient.post);

function signIn(role: UserRole) {
  useAuthStore.setState({
    user: {
      _id: 'u1',
      email: 'user@test.local',
      firstName: 'Test',
      lastName: 'User',
      role,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    accessToken: 'token',
    isAuthenticated: true,
  });
}

const sessions = [
  {
    _id: 's1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',
    ipAddress: '203.0.113.4',
    createdAt: '2026-07-30T04:00:00.000Z',
    lastUsedAt: '2026-08-01T04:00:00.000Z',
    expiresAt: '2026-08-08T04:00:00.000Z',
    revokedAt: null,
    revokedReason: null,
    current: true,
  },
  {
    _id: 's2',
    userAgent: 'okhttp/4.12 Android',
    ipAddress: '198.51.100.9',
    createdAt: '2026-07-28T04:00:00.000Z',
    lastUsedAt: null,
    expiresAt: '2026-08-04T04:00:00.000Z',
    revokedAt: null,
    revokedReason: null,
    current: false,
  },
];

/** The runtime panel is administrator-only; the sessions call is shared. */
function mockRequests(options: { runtime?: boolean; rows?: typeof sessions } = {}) {
  get.mockImplementation((url: string) => {
    if (url === '/auth/sessions') {
      return Promise.resolve({ data: { data: options.rows ?? sessions } });
    }
    if (url === '/admin/runtime') {
      return options.runtime === false
        ? Promise.reject({ response: { status: 403 } })
        : Promise.resolve({
            data: {
              data: {
                version: '1.2.3',
                commit: 'abcdef1234567890',
                environment: 'production',
                uptimeSeconds: 7200,
                database: { state: 'connected', maxPoolSize: 20, queryTimeoutMs: 20000 },
                realtime: { driver: 'redis' },
                notifications: { driver: 'bullmq' },
                rateLimit: {
                  driver: 'redis',
                  windowSeconds: 60,
                  global: 600,
                  auth: 10,
                  write: 120,
                  report: 60,
                },
                tokens: {
                  accessTokenMinutes: 15,
                  refreshTokenDays: 7,
                  dedicatedRefreshSecret: true,
                },
                request: { trustProxyHops: 1, jsonBodyLimit: '256kb', uploadBodyLimit: '4mb' },
              },
            },
          });
    }
    return Promise.resolve({ data: { data: [] } });
  });
}

describe('security centre', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // No `window.confirm` spy: the page asks through the real dialog now, and
    // stubbing the native one would let a test pass while cancelling the very
    // action it claims to exercise.
  });

  it('names each device in words its owner can recognise', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0')).toBe('Chrome on Windows');
    expect(describeDevice('okhttp/4.12 Android')).toBe('MedSupply mobile on Android');
    expect(describeDevice(null)).toBe('Unknown device');
  });

  it('reports uptime and revocation reasons in words', () => {
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(7200)).toBe('2h 0m');
    expect(formatUptime(200_000)).toBe('2d 7h');
    // A session ended by reuse detection must not read like an ordinary
    // sign-out: the owner is the only person who can tell them apart.
    expect(revocationLabel('TOKEN_REUSE')).toBe('Ended for safety');
    expect(revocationLabel(null)).toBe('Signed out');
  });

  it('lists every sign-in and marks the current device', async () => {
    signIn(UserRole.SHOP_OWNER);
    mockRequests();
    renderWithUi(
      <MemoryRouter>
        <SecurityCentre />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Chrome on Windows')).toBeTruthy();
    expect(screen.getByText('MedSupply mobile on Android')).toBeTruthy();
    expect(screen.getByText('This device')).toBeTruthy();
    expect(screen.getByText('203.0.113.4')).toBeTruthy();
    // A Shop Owner must not be shown the deployment panel at all.
    expect(get).not.toHaveBeenCalledWith('/admin/runtime');
    expect(screen.queryByText('This installation')).toBeNull();
  });

  it('confirms before signing a device out and reloads afterwards', async () => {
    signIn(UserRole.MANAGER);
    mockRequests();
    del.mockResolvedValue({ data: { data: { success: true } } });
    renderWithUi(
      <MemoryRouter>
        <SecurityCentre />
      </MemoryRouter>,
    );

    await screen.findByText('MedSupply mobile on Android');
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[1]!);
    fireEvent.click(await screen.findByTestId('dialog-confirm'));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/auth/sessions/s2'));
    expect(await screen.findByText('That device was signed out.')).toBeTruthy();
  });

  it('offers signing out everywhere only when more than one session is live', async () => {
    signIn(UserRole.MANAGER);
    mockRequests({ rows: [sessions[0]] });
    renderWithUi(
      <MemoryRouter>
        <SecurityCentre />
      </MemoryRouter>,
    );

    await screen.findByText('Chrome on Windows');
    expect(screen.queryByRole('button', { name: 'Sign out everywhere' })).toBeNull();

    cleanup();
    mockRequests();
    post.mockResolvedValue({ data: { data: { success: true, revoked: 2 } } });
    renderWithUi(
      <MemoryRouter>
        <SecurityCentre />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    fireEvent.click(await screen.findByTestId('dialog-confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/logout-all'));
    expect(await screen.findByText('Signed out of 2 devices.')).toBeTruthy();
  });

  it('shows an administrator the deployment posture without any secret', async () => {
    signIn(UserRole.ADMIN);
    mockRequests();
    renderWithUi(
      <MemoryRouter>
        <SecurityCentre />
      </MemoryRouter>,
    );

    expect(await screen.findByText('This installation')).toBeTruthy();
    expect(screen.getByText('1.2.3 (abcdef123456)')).toBeTruthy();
    expect(screen.getByText('15 minutes')).toBeTruthy();
    expect(screen.getByText('shared · 60s window')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
  });

  it('keeps the session list usable when the deployment panel cannot be read', async () => {
    signIn(UserRole.ADMIN);
    mockRequests({ runtime: false });
    renderWithUi(
      <MemoryRouter>
        <SecurityCentre />
      </MemoryRouter>,
    );

    // The failure of a supplementary panel must not take the primary one down.
    expect(await screen.findByText('Chrome on Windows')).toBeTruthy();
    expect(
      screen.getByText('The installation details could not be read. Your sign-ins are unaffected.'),
    ).toBeTruthy();
  });

  it('reports a failure with a retry rather than an empty screen', async () => {
    signIn(UserRole.MANAGER);
    get.mockRejectedValue({ response: { status: 500 } });
    renderWithUi(
      <MemoryRouter>
        <SecurityCentre />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
