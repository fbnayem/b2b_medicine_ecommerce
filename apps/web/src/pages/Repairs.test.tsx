// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { renderWithUi } from '../testing/render';
import { LedgerCorrections } from '../components/LedgerCorrections';
import { CreditReservationRepair } from '../components/CreditReservationRepair';
import { TestSend, DeliveryLog } from '../components/NotificationDelivery';

/**
 * The screens for endpoints that had none.
 *
 * Eleven endpoints were reached by no client on either application, and their
 * count was published wrongly three times because it was kept by hand. Nine of
 * them are now called from here, and these tests exist so that the calls are
 * checked rather than counted: each asserts the method, the path and the body
 * the server actually validates, because a screen that calls the wrong path is
 * indistinguishable from no screen at all.
 */

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);

const RECONCILIATION = {
  shopId: 'shop-1',
  ledgerBalanceMinor: 250000,
  cachedBalanceMinor: 200000,
  projectionDifferenceMinor: -50000,
  missingInvoiceCharges: ['INV-2026-000004'],
  postedPaymentsWithoutLedger: [],
  deliveryCollectionsWithoutPayment: [],
  repairedInvoiceCharges: 0,
  repairedProjection: false,
};

function signedInAs(role: UserRole) {
  useAuthStore.setState({
    user: { _id: 'user-1', role } as never,
    accessToken: 'token',
    isAuthenticated: true,
  });
}

beforeEach(() => {
  cleanup();
  get.mockReset();
  post.mockReset();
  signedInAs(UserRole.ADMIN);
});

/**
 * `useAsk` renders a dialog; every write below goes through one.
 *
 * The dialog's confirm button carries the same words as the button that opened
 * it — deliberately, so nobody has to work out what they are agreeing to — so
 * the last match is the one inside the dialog.
 */
async function confirmDialog(label: string | RegExp) {
  const buttons = await screen.findAllByRole('button', { name: label });
  fireEvent.click(buttons[buttons.length - 1]!);
}

describe('checking and correcting a customer ledger', () => {
  it('reads the reconciliation and shows the difference rather than only a verdict', async () => {
    get.mockResolvedValue({ data: { data: RECONCILIATION } });

    renderWithUi(
      <MemoryRouter>
        <LedgerCorrections shopId="shop-1" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('reconcile-check'));

    await waitFor(() => expect(get).toHaveBeenCalledWith('/finance/reconciliation/shop-1'));
    // Both figures, not just the gap: the point of the screen is that somebody
    // can see which of the two they believe.
    expect(await screen.findByText('৳2,500.00')).toBeTruthy();
    expect(screen.getByText('৳2,000.00')).toBeTruthy();
    expect(screen.getByText('INV-2026-000004')).toBeTruthy();
  });

  it('offers the repair only once a check has found something to repair', async () => {
    get.mockResolvedValue({
      data: {
        data: { ...RECONCILIATION, projectionDifferenceMinor: 0, missingInvoiceCharges: [] },
      },
    });

    renderWithUi(
      <MemoryRouter>
        <LedgerCorrections shopId="shop-1" />
      </MemoryRouter>,
    );
    // Before any check: nothing to correct, so nothing offering to correct it.
    expect(screen.queryByRole('button', { name: /correct it/i })).toBeNull();

    fireEvent.click(screen.getByTestId('reconcile-check'));
    await screen.findByTestId('reconcile-clean');
    expect(
      screen.queryByRole('button', { name: /correct it/i }),
      'a clean account must not offer a repair — pressing it would post nothing and read as if it had',
    ).toBeNull();
  });

  it('posts an adjustment in minor units, with an idempotency key', async () => {
    post.mockResolvedValue({ data: { data: {}, meta: {} } });

    renderWithUi(
      <MemoryRouter>
        <LedgerCorrections shopId="shop-1" />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('adjustment-amount'), { target: { value: '250.50' } });
    fireEvent.change(screen.getByTestId('adjustment-reason'), {
      target: { value: 'Goodwill credit agreed by phone' },
    });
    fireEvent.click(screen.getByRole('button', { name: /post it/i }));
    await confirmDialog(/post it/i);

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/finance/adjustments');
    // 250.50 taka is 25,050 paisa. A screen that sent 250.5 would post two and
    // a half taka, and the ledger would be quietly wrong by a factor of a
    // hundred on the one screen that exists to correct it.
    expect(body.amountMinor).toBe(25050);
    expect(body.shopId).toBe('shop-1');
    expect(String(body.idempotencyKey).length).toBeGreaterThanOrEqual(8);
  });

  it('is invisible to a sales representative, who may not read a ledger at all', () => {
    signedInAs(UserRole.SALES);
    renderWithUi(
      <MemoryRouter>
        <LedgerCorrections shopId="shop-1" />
      </MemoryRouter>,
    );
    // A rep may read what a customer owes and nothing else about it, so even
    // the read here is refused by the router. A button whose only outcome is a
    // 403 is worse than no button.
    expect(screen.queryByTestId('reconcile-check')).toBeNull();
  });

  it('lets a manager check but never correct', async () => {
    signedInAs(UserRole.MANAGER);
    get.mockResolvedValue({ data: { data: RECONCILIATION } });

    renderWithUi(
      <MemoryRouter>
        <LedgerCorrections shopId="shop-1" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('reconcile-check'));
    await screen.findByTestId('reconcile-report');

    // The router refuses both writes to a manager, so offering them would be a
    // button whose only outcome is a 403.
    expect(screen.queryByRole('button', { name: /correct it/i })).toBeNull();
    expect(screen.queryByTestId('adjustment-amount')).toBeNull();
  });
});

describe('recording the credit an old order holds', () => {
  it('reports a replay as a replay rather than as a fresh reservation', async () => {
    post.mockResolvedValue({ data: { data: {}, meta: { idempotentReplay: true } } });

    renderWithUi(
      <MemoryRouter>
        <CreditReservationRepair orderId="order-1" />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('backfill-reason'), {
      target: { value: 'Migrated order from the old system' },
    });
    fireEvent.click(screen.getByRole('button', { name: /record it/i }));
    await confirmDialog(/record it/i);

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/finance/credit-reservations/backfill');
    expect(body.orderId).toBe('order-1');
    // The server replays rather than double-reserving. Saying "recorded" here
    // would tell an administrator they had just changed a balance they had not.
    expect(await screen.findByText(/already had its credit recorded/i)).toBeTruthy();
  });
});

describe('proving a notification channel works', () => {
  it('sends the test to the signed-in person and to nobody else', async () => {
    post.mockResolvedValue({ data: { data: { notificationIds: ['n-1'] } } });

    renderWithUi(
      <MemoryRouter>
        <TestSend />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('test-note'), {
      target: { value: 'Checking the mail server' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send it to me/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/notifications/test');
    expect(
      body.recipientId,
      'the endpoint accepts any recipient, so a real customer could be sent a real-looking ' +
        'order notification that is not true — the screen must never offer that',
    ).toBe('user-1');
  });

  it('reads the attempt log for one message, and separates a suppression from a failure', async () => {
    get.mockResolvedValue({
      data: {
        data: [
          {
            _id: 'd-1',
            channel: 'EMAIL',
            status: 'SUPPRESSED',
            suppressionReason: 'They have turned email off',
            createdAt: '2026-08-08T04:00:00.000Z',
          },
          {
            _id: 'd-2',
            channel: 'SMS',
            status: 'FAILED',
            lastError: 'The gateway refused the number',
            failedAt: '2026-08-08T04:00:05.000Z',
          },
        ],
      },
    });

    renderWithUi(
      <MemoryRouter>
        <DeliveryLog notificationId="n-1" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('deliveries-n-1'));

    await waitFor(() => expect(get).toHaveBeenCalledWith('/notifications/n-1/deliveries'));
    // A preference working and a gateway refusing are different facts, and a
    // screen that renders both as "failed" sends somebody looking for a bug
    // that is really somebody's switched-off email.
    expect(await screen.findByText('Held back by a preference')).toBeTruthy();
    expect(screen.getByText('Did not send')).toBeTruthy();
    expect(screen.getByText('They have turned email off')).toBeTruthy();
    expect(screen.getByText('The gateway refused the number')).toBeTruthy();
  });

  it('shows neither to a manager', () => {
    signedInAs(UserRole.MANAGER);
    renderWithUi(
      <MemoryRouter>
        <TestSend />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('test-note')).toBeNull();
  });
});
