// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { CustomerStatement } from './CustomerStatement';
import { OutstandingReport } from './FinancialReports';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);

describe('Phase 8 finance views', () => {
  beforeEach(() => get.mockReset());
  afterEach(() => cleanup());

  it('renders a Shop Owner statement using server-provided opening and closing balances', async () => {
    get.mockResolvedValue({
      data: {
        data: {
          shop: { _id: 'shop-1', reference: 'SHP-2026-000001', name: 'Dhaka Pharmacy' },
          from: '2026-07-01',
          to: '2026-07-29',
          openingBalanceMinor: 10000,
          closingBalanceMinor: 25000,
          entries: [
            {
              _id: 'entry-1',
              type: 'INVOICE_CHARGE',
              reference: 'INV-2026-000001',
              debitMinor: 15000,
              creditMinor: 0,
              balanceAfterMinor: 25000,
              postingTime: '2026-07-15T06:00:00.000Z',
            },
          ],
        },
      },
    });
    render(
      <MemoryRouter>
        <CustomerStatement ownerMode />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Dhaka Pharmacy')).toBeTruthy();
    expect(screen.getAllByText('৳250.00').length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledWith('/finance/my/statement', {
      params: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
    });
  });

  it('renders server-aggregated outstanding balances with a ledger link', async () => {
    get.mockImplementation((url) =>
      Promise.resolve({
        data: {
          data:
            url === '/finance/reports/summary'
              ? {
                  outstandingBalanceMinor: 75000,
                  overdueBalanceMinor: 20000,
                  collectedAmountMinor: 10000,
                }
              : {
                  rows: [
                    {
                      shopId: 'shop-1',
                      shopReference: 'SHP-2026-000001',
                      shopName: 'Dhaka Pharmacy',
                      invoiceCount: 2,
                      outstandingBalanceMinor: 75000,
                      oldestDueDate: '2026-07-01',
                    },
                  ],
                  outstandingTotalMinor: 75000,
                },
        },
      }),
    );
    render(
      <MemoryRouter>
        <OutstandingReport />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Dhaka Pharmacy')).toBeTruthy();
    expect(screen.getAllByText('৳750.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View ledger' }).getAttribute('href')).toBe(
      '/shops/shop-1/ledger',
    );
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/finance/reports/outstanding', {
        params: expect.objectContaining({ asOf: expect.any(String) }),
      }),
    );
  });
});
