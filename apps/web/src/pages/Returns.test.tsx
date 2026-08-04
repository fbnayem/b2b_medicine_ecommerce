// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '../testing/render';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnStatus, UserRole, UserStatus } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { ReturnList } from './ReturnList';
import { ReturnDetail } from './ReturnDetail';
import { AnalyticsDashboard } from './AnalyticsDashboard';

// Only the transport is replaced. `errorMessage` and `failureReference` are
// pure helpers over the caught value, and stubbing them out would mean the
// tests never see the sentence a user actually reads.
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() },
  };
});
vi.mock('../realtime/socket', () => ({
  onRealtime: () => () => {},
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);

function signIn(role: UserRole) {
  useAuthStore.setState({
    user: {
      _id: 'u1',
      email: 'user@test.local',
      firstName: 'Test',
      lastName: 'User',
      role,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    accessToken: 'token',
    isAuthenticated: true,
  });
}

const detailRecord = {
  _id: 'r1',
  reference: 'RET-2026-000001',
  status: ReturnStatus.RECEIVED,
  primaryReason: 'DAMAGED_IN_TRANSIT',
  lines: [
    {
      medicineId: 'm1',
      batchId: 'b1',
      batchNumber: 'BATCH-1',
      expiryDate: '2027-01-01T00:00:00.000Z',
      invoicedQuantity: 10,
      requestedQuantity: 4,
      approvedQuantity: 4,
      receivedQuantity: 4,
      restockQuantity: 3,
      damagedQuantity: 1,
      expiredQuantity: 0,
      quarantinedQuantity: 0,
      unitPriceMinor: 1250,
      refundMinor: 5000,
      reason: 'DAMAGED_IN_TRANSIT',
      medicineSnapshot: {
        brandName: 'Napa',
        genericName: 'Paracetamol',
        strength: '500mg',
        packSize: '10x10',
      },
    },
  ],
  requestedTotalMinor: 5000,
  approvedSubtotalMinor: 5000,
  approvedTaxMinor: 0,
  approvedTotalMinor: 5000,
  requestedAt: '2026-08-01T04:00:00.000Z',
  version: 3,
  shopId: { _id: 's1', reference: 'SHP-1', name: 'City Pharmacy' },
  invoiceId: { _id: 'i1', reference: 'INV-2026-000001', grandTotalMinor: 12500 },
  orderId: { _id: 'o1', reference: 'ORD-2026-000001', status: 'RETURN_REQUESTED' },
};

/**
 * The detail page embeds the activity timeline, which issues its own request,
 * so the mock answers by URL rather than returning one payload to everything.
 */
function mockDetailRequests(record: unknown = detailRecord) {
  get.mockImplementation(async (url: string) =>
    url === '/activity/timeline' ? { data: { data: [] } } : { data: { data: record } },
  );
}

function renderDetail() {
  return renderWithUi(
    <MemoryRouter initialEntries={['/returns/r1']}>
      <Routes>
        <Route path="/returns/:id" element={<ReturnDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Requests the return detail made, excluding the timeline's own fetch. */
const detailCalls = () => get.mock.calls.filter(([url]) => url !== '/activity/timeline');

beforeEach(() => {
  // A failed assertion otherwise leaves its tree mounted and the next query
  // matches elements from both renders.
  cleanup();
  vi.clearAllMocks();
});

describe('Return list', () => {
  it('offers a shop owner the request action and hides the shop column', async () => {
    signIn(UserRole.SHOP_OWNER);
    get.mockResolvedValue({
      data: {
        data: [
          {
            _id: 'r1',
            reference: 'RET-2026-000001',
            status: ReturnStatus.REQUESTED,
            primaryReason: 'DAMAGED_IN_TRANSIT',
            requestedAt: '2026-08-01T04:00:00.000Z',
            requestedTotalMinor: 5000,
            approvedTotalMinor: 0,
            invoiceId: { _id: 'i1', reference: 'INV-2026-000001' },
          },
        ],
        meta: { pages: 1 },
      },
    });

    renderWithUi(
      <MemoryRouter>
        <ReturnList />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'Request a return' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'RET-2026-000001' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Shop' })).toBeNull();
  });

  it('shows the shop column and no request action for a manager', async () => {
    signIn(UserRole.MANAGER);
    get.mockResolvedValue({ data: { data: [], meta: { pages: 1 } } });

    renderWithUi(
      <MemoryRouter>
        <ReturnList />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No returns yet')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Request a return' })).toBeNull();
  });

  it('explains a permission failure instead of showing an empty list', async () => {
    signIn(UserRole.MANAGER);
    get.mockRejectedValue({ response: { status: 403 } });

    renderWithUi(
      <MemoryRouter>
        <ReturnList />
      </MemoryRouter>,
    );

    // A refusal is explained as a refusal. The page used to hand-code this
    // sentence; it now comes from the catalogue, so every screen says the same
    // thing and it is available in Bangla.
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining(
        'Your account does not have permission to do that.',
      ) as unknown as string,
    );
  });
});

describe('Return detail', () => {
  it('offers the credit note only to management on a received return', async () => {
    signIn(UserRole.MANAGER);
    mockDetailRequests();
    post.mockResolvedValue({ data: { data: detailRecord } });

    renderDetail();

    const issue = await screen.findByRole('button', { name: 'Issue the credit note' });
    fireEvent.click(issue);

    // Posting a credit note to a customer's ledger is irreversible, so it is
    // confirmed in a real dialog. This test used to stub `window.confirm` to
    // return true, which meant it never exercised the confirmation at all.
    fireEvent.click(await screen.findByTestId('dialog-confirm'));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/returns/r1/credit-note');
    // The version travels with the action so a concurrent change is refused.
    expect((body as { version: number }).version).toBe(3);
  });

  it('hides every internal action from a shop owner', async () => {
    signIn(UserRole.SHOP_OWNER);
    mockDetailRequests();

    renderDetail();

    // The reference is split across text nodes by the surrounding label.
    await screen.findByText(/RET-2026-000001/);
    expect(screen.queryByRole('button', { name: 'Issue the credit note' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm what arrived' })).toBeNull();
    expect(screen.getByText('There is nothing for your role to do at this stage.')).toBeTruthy();
  });

  it('lets a storekeeper record dispositions on an approved return', async () => {
    signIn(UserRole.STOREKEEPER);
    mockDetailRequests({ ...detailRecord, status: ReturnStatus.COLLECTED });
    post.mockResolvedValue({ data: { data: detailRecord } });

    renderDetail();

    const damaged = await screen.findByLabelText('Damaged quantity for Napa');
    fireEvent.change(damaged, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm what arrived' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/returns/r1/receive');
    expect((body as { lines: Array<{ damagedQuantity: number }> }).lines[0].damagedQuantity).toBe(
      2,
    );
  });

  it('reloads and keeps the explanation when another reviewer got there first', async () => {
    signIn(UserRole.MANAGER);
    mockDetailRequests();
    post.mockRejectedValue({
      response: { data: { error: { code: 'STALE_RETURN', message: 'stale' } } },
    });

    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Issue the credit note' }));
    fireEvent.click(await screen.findByTestId('dialog-confirm'));

    // The reload must not swallow the explanation, or the reviewer sees values
    // change with no reason given. The wording now comes from the catalogue's
    // STALE_RETURN entry rather than from a sentence typed into this page.
    expect(
      await screen.findByText('Somebody else updated this return while you were looking at it.'),
    ).toBeTruthy();
    expect(detailCalls()).toHaveLength(2);
  });
});

describe('Analytics dashboard', () => {
  const overview = {
    period: { from: '2026-08-01', to: '2026-08-01', granularity: 'DAY' },
    sales: {
      invoiceCount: 2,
      shopCount: 1,
      unitsSold: 20,
      grossMinor: 25_000,
      discountMinor: 0,
      taxMinor: 0,
      deliveryChargeMinor: 0,
      netMinor: 25_000,
      returnedMinor: 5000,
      netAfterReturnsMinor: 20_000,
      averageInvoiceMinor: 12_500,
    },
    salesSeries: [
      {
        bucket: '2026-08-01',
        invoiceCount: 2,
        grossMinor: 25_000,
        discountMinor: 0,
        taxMinor: 0,
        netMinor: 25_000,
        returnedMinor: 5000,
        netAfterReturnsMinor: 20_000,
      },
    ],
    orders: {
      submitted: 4,
      reviewed: 3,
      approved: 3,
      rejected: 0,
      invoiced: 2,
      delivered: 2,
      cancelled: 1,
    },
    orderCycleHours: {
      submitToReview: 1.5,
      reviewToInvoice: 3,
      invoiceToDelivery: 12,
      submitToDelivery: 17,
    },
    delivery: {
      total: 2,
      delivered: 2,
      partiallyDelivered: 0,
      failed: 0,
      returnedToStore: 0,
      onTime: 2,
      late: 0,
      successBasisPoints: 10_000,
      onTimeBasisPoints: 10_000,
      averageCycleHours: 6,
    },
    returns: {
      returnCount: 1,
      completedCount: 1,
      pendingCount: 0,
      unitsReturned: 4,
      unitsRestocked: 3,
      unitsWrittenOff: 1,
      requestedMinor: 5000,
      creditedMinor: 5000,
      pendingCreditMinor: 0,
      salesNetMinor: 25_000,
      returnRateBasisPoints: 2000,
    },
    receivables: {
      outstandingMinor: 20_000,
      overdueMinor: 7500,
      ageing: [
        { bucket: 'CURRENT', invoiceCount: 1, amountMinor: 12_500 },
        { bucket: 'DAYS_1_30', invoiceCount: 1, amountMinor: 7500 },
        { bucket: 'DAYS_31_60', invoiceCount: 0, amountMinor: 0 },
        { bucket: 'DAYS_61_90', invoiceCount: 0, amountMinor: 0 },
        { bucket: 'DAYS_90_PLUS', invoiceCount: 0, amountMinor: 0 },
      ],
    },
    inventory: {
      costValueMinor: 80_000,
      available: 100,
      expiringSoonBatches: 1,
      lowStockCount: 2,
    },
    topMedicines: [
      {
        key: 'm1',
        label: 'Napa',
        invoiceCount: 2,
        quantity: 20,
        netMinor: 25_000,
        returnedMinor: 5000,
        sharePercentBasisPoints: 10_000,
      },
    ],
    topShops: [],
  };

  it('renders the headline figures and an accessible table behind every chart', async () => {
    signIn(UserRole.MANAGER);
    get.mockResolvedValue({ data: { data: overview } });

    render(
      <MemoryRouter>
        <AnalyticsDashboard />
      </MemoryRouter>,
    );

    // Several cards can legitimately carry the same amount, and the chart's
    // data table repeats it again, so each figure is read from its own card.
    // Scoped to the metric card's own label; the same words appear again as a
    // chart legend entry.
    const card = (label: string) =>
      screen.getByText(label, { selector: 'article > span' }).closest('article');
    await screen.findByText('Net sales', { selector: 'article > span' });
    expect(card('Net sales')?.textContent).toContain('৳250.00');
    expect(card('After returns')?.textContent).toContain('৳200.00');
    expect(card('Overdue')?.textContent).toContain('৳75.00');
    // The SVG is hidden from assistive technology, so the numbers must also be
    // reachable as a real table.
    const table = screen.getByRole('table', { name: /Net sales and returns by period/i });
    expect(table.textContent).toContain('2026-08-01');
    expect(screen.getByText('20.0%')).toBeTruthy();
  });

  it('explains a permission failure rather than rendering an empty dashboard', async () => {
    signIn(UserRole.MANAGER);
    get.mockRejectedValue({ response: { status: 403 } });

    render(
      <MemoryRouter>
        <AnalyticsDashboard />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your role cannot view business analytics.');
  });
});
