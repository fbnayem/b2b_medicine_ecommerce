// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { DeliveryBoard } from './DeliveryBoard';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);

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
    const view = render(
      <MemoryRouter>
        <DeliveryBoard />
      </MemoryRouter>,
    );
    expect(screen.getByText('Loading deliveries...')).toBeTruthy();
    expect(await screen.findByText('DEL-2026-000001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'FAILED' }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/deliveries', { params: { status: 'FAILED' } }),
    );
    view.unmount();
  });
  it('offers a functional retry after a loading error', async () => {
    get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { data: [] } });
    const view = render(
      <MemoryRouter>
        <DeliveryBoard />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Unable to load the delivery board.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No deliveries match this queue.')).toBeTruthy();
    view.unmount();
  });
});
