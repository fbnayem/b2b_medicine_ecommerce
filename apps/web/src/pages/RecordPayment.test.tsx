// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { RecordPayment } from './RecordPayment';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);

describe('RecordPayment', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockImplementation((url) =>
      Promise.resolve(
        url === '/shops'
          ? {
              data: {
                data: [{ _id: 'shop-1', reference: 'SHP-2026-000001', name: 'Dhaka Pharmacy' }],
              },
            }
          : {
              data: {
                data: [
                  {
                    _id: 'invoice-1',
                    reference: 'INV-2026-000001',
                    grandTotalMinor: 200000,
                    dueMinor: 150000,
                  },
                ],
              },
            },
      ),
    );
  });
  afterEach(() => cleanup());

  it('posts an exact integer amount and a stable idempotency key', async () => {
    post.mockResolvedValue({
      data: { data: { _id: 'payment-1', reference: 'PAY-2026-000001', status: 'POSTED' } },
    });
    render(
      <MemoryRouter initialEntries={['/payments/new']}>
        <RecordPayment />
      </MemoryRouter>,
    );
    const shopSelect = await screen.findByLabelText('Shop');
    fireEvent.change(shopSelect, { target: { value: 'shop-1' } });
    const invoiceSelect = await screen.findByLabelText('Invoice allocation (optional for advance)');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /INV-2026-000001/ })).toBeTruthy(),
    );
    fireEvent.change(invoiceSelect, { target: { value: 'invoice-1' } });
    fireEvent.change(screen.getByLabelText('Amount (৳)'), { target: { value: '1,234.56' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.amountMinor).toBe(123456);
    expect(body.shopId).toBe('shop-1');
    expect(body.invoiceId).toBe('invoice-1');
    expect(body.idempotencyKey).toEqual(expect.stringContaining('record-payment-'));
  });

  it('blocks values with more than two decimal places before calling the API', async () => {
    render(
      <MemoryRouter initialEntries={['/payments/new']}>
        <RecordPayment />
      </MemoryRouter>,
    );
    const shopSelect = await screen.findByLabelText('Shop');
    fireEvent.change(shopSelect, { target: { value: 'shop-1' } });
    fireEvent.change(screen.getByLabelText('Amount (৳)'), { target: { value: '10.001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(
      await screen.findByText('Enter a positive amount with no more than two decimal places.'),
    ).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
});
