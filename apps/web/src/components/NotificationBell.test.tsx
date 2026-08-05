// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeEvent, type NotificationRecord } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { useNotificationStore } from '../store/useNotifications';
import { NotificationBell } from './NotificationBell';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

// Captures the realtime subscriptions so a test can push a server event.
const handlers = new Map<string, (payload: unknown) => void>();
vi.mock('../realtime/socket', () => ({
  onRealtime: (event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler);
    return () => handlers.delete(event);
  },
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);

const notification = (overrides: Partial<NotificationRecord> = {}): NotificationRecord =>
  ({
    _id: 'n-1',
    recipientId: 'u-1',
    event: 'ORDER_APPROVED',
    type: 'ORDER_APPROVED',
    category: 'APPROVAL',
    priority: 'HIGH',
    title: 'Order ORD-2026-000001 reviewed',
    body: 'Status: APPROVED.',
    link: '/orders/order-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }) as NotificationRecord;

function signIn() {
  useAuthStore.setState({
    user: { _id: 'u-1', role: 'MANAGER' } as never,
    accessToken: 'token',
    isAuthenticated: true,
  });
}

describe('NotificationBell', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    handlers.clear();
    useNotificationStore.getState().reset();
    signIn();
  });

  it('shows the unread badge and lists recent notifications when opened', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/notifications/unread-count') {
        return Promise.resolve({ data: { data: { total: 3, byCategory: { APPROVAL: 3 } } } });
      }
      return Promise.resolve({ data: { data: [notification()] } });
    });

    const view = render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    expect(await screen.findByText('3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 3 unread' }));
    expect(await screen.findByText('Order ORD-2026-000001 reviewed')).toBeTruthy();
    view.unmount();
  });

  it('increments the badge when the server pushes a new notification', async () => {
    get.mockResolvedValue({ data: { data: { total: 0, byCategory: {} } } });
    const view = render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    await waitFor(() => expect(handlers.has(RealtimeEvent.NOTIFICATION_CREATED)).toBe(true));
    handlers.get(RealtimeEvent.NOTIFICATION_CREATED)!(notification({ _id: 'n-live' }));

    expect(await screen.findByText('1')).toBeTruthy();
    view.unmount();
  });

  it('surfaces a retry action when the recent list fails to load', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/notifications/unread-count') {
        return Promise.resolve({ data: { data: { total: 1, byCategory: {} } } });
      }
      return Promise.reject(new Error('offline'));
    });

    const view = render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText('Unable to load notifications.')).toBeTruthy();
    // "Try again", not "Retry": the panel now uses the shared `ErrorState`
    // rather than its own markup, so the recovery action is worded the same
    // here as on every other screen that can fail.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    view.unmount();
  });

  it('renders nothing for a signed-out visitor', () => {
    useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false });
    const view = render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull();
    view.unmount();
  });
});
