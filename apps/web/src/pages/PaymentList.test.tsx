// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { PaymentList } from './PaymentList';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);

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
    render(
      <MemoryRouter>
        <PaymentList />
      </MemoryRouter>,
    );
    expect(screen.getByText('Loading payments...')).toBeTruthy();
    expect(await screen.findByText('PAY-2026-000001')).toBeTruthy();
    expect(screen.getByText('৳1,250.50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'POSTED' }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/payments', {
        params: { status: 'POSTED', page: 1, limit: 30 },
      }),
    );
  });

  it('offers a working retry after a loading failure', async () => {
    get
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: { data: [], meta: { page: 1, pages: 1 } } });
    render(
      <MemoryRouter>
        <PaymentList />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Unable to load payments.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No payments match these filters.')).toBeTruthy();
  });
});
