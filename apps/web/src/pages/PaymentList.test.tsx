// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { renderWithUi } from '../testing/render';
import { PaymentList } from './PaymentList';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiClient: { get: vi.fn() } };
});
const get = vi.mocked(apiClient.get);
const requested = () => get.mock.calls.map(([url]) => url as string);

const payment = {
  _id: 'payment-1',
  reference: 'PAY-2026-000001',
  shopId: { _id: 'shop-1', reference: 'SHP-2026-000001', name: 'Dhaka Pharmacy' },
  invoiceId: { _id: 'invoice-1', reference: 'INV-2026-000001', grandTotalMinor: 150000 },
  deliveryId: { _id: 'delivery-1', reference: 'DEL-2026-000001' },
  amountMinor: 125050,
  method: 'CASH',
  status: 'POSTED',
  collectionTime: '2026-07-29T05:00:00.000Z',
  createdAt: '2026-07-29T05:00:00.000Z',
};

describe('PaymentList', () => {
  beforeEach(() => get.mockReset());
  afterEach(() => cleanup());

  it('shows payments and requests the selected status queue', async () => {
    get.mockResolvedValue({ data: { data: [payment], meta: { page: 1, pages: 1, total: 1 } } });
    renderWithUi(
      <MemoryRouter>
        <PaymentList />
      </MemoryRouter>,
    );
    expect(await screen.findByText('PAY-2026-000001')).toBeTruthy();
    expect(screen.getByText('৳1,250.50')).toBeTruthy();
    // The filter reads "Posted" rather than the raw enum, and the status
    // travels in the URL because it is also the query's cache key.
    fireEvent.click(screen.getByRole('button', { name: 'Posted' }));
    await waitFor(() =>
      expect(requested().some((url) => url.includes('status=POSTED'))).toBe(true),
    );
  });

  it('offers a working retry after a loading failure', async () => {
    get
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ data: { data: [], meta: { page: 1, pages: 1, total: 0 } } });
    renderWithUi(
      <MemoryRouter>
        <PaymentList />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No payments yet')).toBeTruthy();
  });
});
