// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityEntityType } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useNotificationStore } from '../store/useNotifications';
import { renderWithUi } from '../testing/render';
import { Notifications } from './Notifications';
import { NotificationPreferences } from './NotificationPreferences';
import { ActivityTimeline } from '../components/ActivityTimeline';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  };
});
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

/** The URLs the pages request, without the axios config argument. */
const requested = () => get.mock.calls.map(([url]) => url as string);

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
    get.mockImplementation((url: string) =>
      url.startsWith('/notifications?')
        ? Promise.resolve({ data: { data: [unread], meta: { total: 1, page: 1, limit: 20 } } })
        : Promise.resolve({ data: { data: { total: 1, byCategory: {} } } }),
    );
    post.mockResolvedValue({ data: { data: { updated: 1 } } });

    renderWithUi(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Invoice INV-2026-000001 issued')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/notifications/read', { notificationIds: ['n-1'] }),
    );
  });

  it('filters by category and shows an empty state', async () => {
    get.mockResolvedValue({ data: { data: [], meta: { total: 0, page: 1, limit: 20 } } });
    renderWithUi(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Nothing in this category yet')).toBeTruthy();
    // The filter reads "Deliveries", not `DELIVERY` — the raw enum used to be
    // the button's label.
    fireEvent.click(screen.getByRole('button', { name: 'Deliveries' }));
    await waitFor(() =>
      expect(requested().some((url) => url.includes('category=DELIVERY'))).toBe(true),
    );
  });

  it('offers a retry when the list request fails', async () => {
    get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 20 } },
    });
    renderWithUi(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );
    // A failure is recoverable, which is the whole point of `<Resource>`: the
    // hand-rolled version offered no way back.
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(retry);
    expect(await screen.findByText('Nothing in this category yet')).toBeTruthy();
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

  function mockPreferences(mutedEvents: string[] = []) {
    get.mockImplementation((url: string) =>
      url === '/notifications/catalogue'
        ? Promise.resolve({ data: { data: catalogue } })
        : Promise.resolve({
            data: {
              data: {
                defaultChannels: null,
                overrides: [],
                quietHours: { enabled: false, start: '22:00', end: '07:00' },
                mutedEvents,
              },
            },
          }),
    );
  }

  it('saves an event channel override', async () => {
    mockPreferences();
    put.mockResolvedValue({ data: { data: {} } });

    renderWithUi(
      <MemoryRouter>
        <NotificationPreferences />
      </MemoryRouter>,
    );

    // By role, because the table's `<caption>` carries the same words — it is
    // the table's accessible name, and a bare text query matches both.
    expect(await screen.findByRole('heading', { name: 'What reaches you, and how' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Email for Order approved'));
    fireEvent.click(screen.getByRole('button', { name: 'Save these settings' }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const payload = put.mock.calls[0][1] as {
      overrides: Array<{ event: string; channels: string[] }>;
    };
    expect(payload.overrides[0]).toEqual({
      event: 'ORDER_APPROVED',
      channels: ['PUSH', 'EMAIL'],
    });
  });

  it('disables channel choices for a muted event', async () => {
    mockPreferences(['ORDER_APPROVED']);

    renderWithUi(
      <MemoryRouter>
        <NotificationPreferences />
      </MemoryRouter>,
    );
    const email = (await screen.findByLabelText('Email for Order approved')) as HTMLInputElement;
    expect(email.disabled).toBe(true);
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
    render(<ActivityTimeline entityType={ActivityEntityType.ORDER} entityId="order-2" />);
    // Through the catalogue now, and through the shared `EmptyState`, rather
    // than a hand-written English sentence in an unstyled paragraph.
    expect(await screen.findByText('Nothing has happened yet')).toBeTruthy();
  });
});
