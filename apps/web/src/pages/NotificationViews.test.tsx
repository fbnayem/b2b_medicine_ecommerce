// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityEntityType } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useNotificationStore } from '../store/useNotifications';
import { Notifications } from './Notifications';
import { NotificationPreferences } from './NotificationPreferences';
import { ActivityTimeline } from '../components/ActivityTimeline';

vi.mock('../api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));
vi.mock('../realtime/socket', () => ({
  onRealtime: () => () => {},
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const put = vi.mocked(apiClient.put);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  useNotificationStore.getState().reset();
});

describe('Notifications page', () => {
  const unread = {
    _id: 'n-1',
    title: 'Invoice INV-2026-000001 issued',
    body: 'The order is packed and invoiced.',
    category: 'FINANCE',
    priority: 'NORMAL',
    createdAt: new Date().toISOString(),
  };

  it('lists notifications and marks one read through the API', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/notifications') {
        return Promise.resolve({ data: { data: [unread], meta: { total: 1 } } });
      }
      return Promise.resolve({ data: { data: { total: 1, byCategory: {} } } });
    });
    post.mockResolvedValue({ data: { data: { updated: 1 } } });

    const view = render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    expect(screen.getByText('Loading notifications...')).toBeTruthy();
    expect(await screen.findByText('Invoice INV-2026-000001 issued')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/notifications/read', { notificationIds: ['n-1'] }),
    );
    view.unmount();
  });

  it('filters by category and shows an empty state', async () => {
    get.mockResolvedValue({ data: { data: [], meta: { total: 0 } } });
    const view = render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No notifications in this category yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'DELIVERY' }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/notifications', {
        params: { page: 1, limit: 20, category: 'DELIVERY' },
      }),
    );
    view.unmount();
  });

  it('offers a retry when the list request fails', async () => {
    get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      data: { data: [], meta: { total: 0 } },
    });
    const view = render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Unable to load notifications.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No notifications in this category yet.')).toBeTruthy();
    view.unmount();
  });
});

describe('NotificationPreferences', () => {
  const catalogue = {
    channels: ['EMAIL', 'SMS', 'PUSH', 'WHATSAPP'],
    events: [
      {
        event: 'ORDER_APPROVED',
        category: 'APPROVAL',
        priority: 'HIGH',
        defaultChannels: ['PUSH'],
      },
    ],
  };

  it('saves an event channel override', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/notifications/catalogue') return Promise.resolve({ data: { data: catalogue } });
      return Promise.resolve({
        data: {
          data: {
            defaultChannels: null,
            overrides: [],
            quietHours: { enabled: false, start: '22:00', end: '07:00' },
            mutedEvents: [],
          },
        },
      });
    });
    put.mockResolvedValue({ data: { data: {} } });

    const view = render(
      <MemoryRouter>
        <NotificationPreferences />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Channels by event')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('EMAIL for ORDER_APPROVED'));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const payload = put.mock.calls[0][1] as {
      overrides: Array<{ event: string; channels: string[] }>;
    };
    expect(payload.overrides[0]).toEqual({
      event: 'ORDER_APPROVED',
      channels: ['PUSH', 'EMAIL'],
    });
    view.unmount();
  });

  it('disables channel choices for a muted event', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/notifications/catalogue') return Promise.resolve({ data: { data: catalogue } });
      return Promise.resolve({
        data: {
          data: {
            defaultChannels: null,
            overrides: [],
            quietHours: { enabled: false, start: '22:00', end: '07:00' },
            mutedEvents: ['ORDER_APPROVED'],
          },
        },
      });
    });

    const view = render(
      <MemoryRouter>
        <NotificationPreferences />
      </MemoryRouter>,
    );
    const email = (await screen.findByLabelText('EMAIL for ORDER_APPROVED')) as HTMLInputElement;
    expect(email.disabled).toBe(true);
    view.unmount();
  });
});

describe('ActivityTimeline', () => {
  it('renders permitted events and an empty state', async () => {
    get.mockResolvedValueOnce({
      data: {
        data: [
          {
            _id: 'a-1',
            summary: 'Order ORD-2026-000001 submitted by Dhaka Pharmacy',
            detail: '3 line(s) requested.',
            occurredAt: new Date().toISOString(),
            actorName: 'Karim Rahman',
            actorRole: 'SHOP_OWNER',
            category: 'ORDER',
          },
        ],
      },
    });

    const populated = render(
      <ActivityTimeline entityType={ActivityEntityType.ORDER} entityId="order-1" />,
    );
    expect(
      await screen.findByText('Order ORD-2026-000001 submitted by Dhaka Pharmacy'),
    ).toBeTruthy();
    expect(screen.getByText(/Karim Rahman/)).toBeTruthy();
    populated.unmount();

    get.mockResolvedValueOnce({ data: { data: [] } });
    const empty = render(
      <ActivityTimeline entityType={ActivityEntityType.ORDER} entityId="order-2" />,
    );
    expect(await screen.findByText('No activity has been recorded yet.')).toBeTruthy();
    empty.unmount();
  });
});
