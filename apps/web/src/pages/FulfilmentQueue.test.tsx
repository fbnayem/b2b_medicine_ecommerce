// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { renderWithUi } from '../testing/render';
import { FulfilmentQueue } from './FulfilmentQueue';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiClient: { get: vi.fn() } };
});

const get = vi.mocked(apiClient.get);
const requested = () => get.mock.calls.map(([url]) => url as string);

describe('FulfilmentQueue', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('shows queue data and requests the selected packing queue', async () => {
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
    renderWithUi(
      <MemoryRouter>
        <FulfilmentQueue />
      </MemoryRouter>,
    );
    expect(await screen.findByText('ORD-2026-000001')).toBeTruthy();
    expect(screen.getByText('Dhaka Pharmacy')).toBeTruthy();

    // The filter reads "Being packed" rather than the raw `PACKING`, and the
    // status travels in the URL because it is also the query's cache key.
    fireEvent.click(screen.getByRole('button', { name: 'Being packed' }));
    await waitFor(() =>
      expect(requested().some((url) => url.includes('status=PACKING'))).toBe(true),
    );
  });

  it('shows an error with a functional retry action', async () => {
    get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: { data: [] } });
    renderWithUi(
      <MemoryRouter>
        <FulfilmentQueue />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing in this queue')).toBeTruthy();
  });
});
