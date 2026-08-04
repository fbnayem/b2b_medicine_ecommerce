// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { renderWithUi } from '../testing/render';
import { DeliveryBoard } from './DeliveryBoard';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiClient: { get: vi.fn() } };
});
vi.mock('../realtime/socket', () => ({
  onRealtime: () => () => {},
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

const get = vi.mocked(apiClient.get);
const requested = () => get.mock.calls.map(([url]) => url as string);

describe('DeliveryBoard', () => {
  beforeEach(() => get.mockReset());

  it('shows ready deliveries and filters the failed queue', async () => {
    get.mockResolvedValue({
      data: {
        data: [
          {
            _id: 'del-1',
            reference: 'DEL-2026-000001',
            status: 'READY_FOR_ASSIGNMENT',
            priority: 'NORMAL',
            shopId: { name: 'Dhaka Pharmacy' },
            orderId: { reference: 'ORD-2026-000001' },
            contactSnapshot: {},
            addressSnapshot: {},
          },
        ],
      },
    });
    renderWithUi(
      <MemoryRouter>
        <DeliveryBoard />
      </MemoryRouter>,
    );
    expect(await screen.findByText('DEL-2026-000001')).toBeTruthy();
    // The filter reads "Failed" rather than the raw enum, and the status
    // travels in the URL because it is also the query's cache key.
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    await waitFor(() =>
      expect(requested().some((url) => url.includes('status=FAILED'))).toBe(true),
    );
  });

  it('offers a functional retry after a loading error', async () => {
    get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: { data: [] } });
    renderWithUi(
      <MemoryRouter>
        <DeliveryBoard />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing in this queue')).toBeTruthy();
  });
});
