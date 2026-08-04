// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { renderWithUi } from '../testing/render';
import { CustomerStatement } from './CustomerStatement';
import { OutstandingReport } from './FinancialReports';

// Only the transport is replaced: `errorMessage` and `failureReference` are
// pure helpers, and stubbing them would hide the sentence a user reads.
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiClient: { get: vi.fn() } };
});
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
    renderWithUi(
      <MemoryRouter>
        <CustomerStatement ownerMode />
      </MemoryRouter>,
    );
    // The name reaches the page header as well as the statement body, so it is
    // read from the statement's own heading block.
    expect((await screen.findAllByText('Dhaka Pharmacy')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('৳250.00').length).toBeGreaterThan(0);
    // The date range is now part of the request URL rather than an axios
    // `params` object, because the range is also the query's cache key.
    const [url] = get.mock.calls[0] as [string];
    expect(url).toMatch(/^\/finance\/my\/statement\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  });

  it('renders server-aggregated outstanding balances with a ledger link', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({
        data: {
          data: String(url).startsWith('/finance/reports/summary')
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
    renderWithUi(
      <MemoryRouter>
        <OutstandingReport />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Dhaka Pharmacy')).toBeTruthy();
    expect(screen.getAllByText('৳750.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View ledger' }).getAttribute('href')).toBe(
      '/shops/shop-1/ledger',
    );
    // The as-at date is part of the URL because it is also the query's key.
    await waitFor(() =>
      expect(
        get.mock.calls.some(([url]) =>
          /^\/finance\/reports\/outstanding\?asOf=\d{4}-\d{2}-\d{2}$/.test(url as string),
        ),
      ).toBe(true),
    );
  });
});
