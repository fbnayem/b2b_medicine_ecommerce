// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { CollectionReview } from './CollectionReview';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);

describe('CollectionReview', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({
      data: {
        data: [
          {
            _id: 'payment-1',
            reference: 'PAY-2026-000001',
            amountMinor: 50000,
            method: 'CASH',
            status: 'PENDING',
            source: 'DELIVERY_COLLECTION',
            createdAt: '2026-07-29T05:00:00.000Z',
            shopId: { _id: 'shop-1', reference: 'SHP-1', name: 'Dhaka Pharmacy' },
            invoiceId: { _id: 'invoice-1', reference: 'INV-1', grandTotalMinor: 50000 },
            deliveryId: { _id: 'delivery-1', reference: 'DEL-1' },
            collectedBy: { _id: 'user-1', firstName: 'Rafiq', lastName: 'Ahmed' },
          },
        ],
      },
    });
    post.mockResolvedValue({ data: { data: {} } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads only pending delivery collections and safely verifies one', async () => {
    render(
      <MemoryRouter>
        <CollectionReview />
      </MemoryRouter>,
    );
    expect(await screen.findByText('PAY-2026-000001')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/payments', {
      params: { status: 'PENDING', source: 'DELIVERY_COLLECTION', limit: 100 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/payments/payment-1/post', {
        idempotencyKey: expect.stringContaining('post-collection-'),
      }),
    );
  });
});
