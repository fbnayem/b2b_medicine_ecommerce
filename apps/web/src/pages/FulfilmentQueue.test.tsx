// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { FulfilmentQueue } from './FulfilmentQueue';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn() } }));

const get = vi.mocked(apiClient.get);

describe('FulfilmentQueue', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('shows loading, queue data, and requests the selected packing queue', async () => {
    get.mockResolvedValue({
      data: {
        data: [
          {
            _id: 'pick-1',
            status: 'PENDING',
            items: [{}],
            orderId: { reference: 'ORD-2026-000001', shopId: { name: 'Dhaka Pharmacy' } },
          },
        ],
      },
    });
    render(
      <MemoryRouter>
        <FulfilmentQueue />
      </MemoryRouter>,
    );
    expect(screen.getByText('Loading queue...')).toBeTruthy();
    expect(await screen.findByText('ORD-2026-000001')).toBeTruthy();
    expect(screen.getByText('Dhaka Pharmacy')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Packing' }));
    await waitFor(() => {
      expect(get).toHaveBeenLastCalledWith('/fulfilment/queue', {
        params: { status: 'PACKING' },
      });
    });
  });

  it('shows an error with a functional retry action', async () => {
    get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { data: [] } });
    render(
      <MemoryRouter>
        <FulfilmentQueue />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Unable to load fulfilment queue.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No fulfilment work in this queue.')).toBeTruthy();
  });
});
