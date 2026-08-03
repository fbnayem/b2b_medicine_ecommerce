import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { UserRole } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { createActionKey, formatFinanceDateTime, formatMinor } from '../lib/finance';
import { useAuthStore } from '../store/useAuth';
import { populatedName, type ApiFailure, type FinancePayment } from './financeTypes';
import './inventory.css';
import { requireReason, useAsk } from '../components/ui';

interface PaymentDetailProps {
  ownerMode?: boolean;
}

export function PaymentDetail({ ownerMode = false }: PaymentDetailProps) {
  const ask = useAsk();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const role = useAuthStore((state) => state.user?.role);
  const [payment, setPayment] = useState<FinancePayment>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(
    searchParams.get('recorded') ? 'Payment recorded successfully.' : '',
  );
  const actionKeys = useRef<Record<string, string>>({});
  const canReverse = !ownerMode && (role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPayment((await apiClient.get(`/payments/${id}`)).data.data as FinancePayment);
      setError('');
    } catch {
      setError('Unable to load this payment.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function keyFor(action: string) {
    actionKeys.current[action] ??= createActionKey(`${action}-payment`);
    return actionKeys.current[action];
  }

  async function runAction(action: 'post' | 'fail' | 'reverse', reason?: string) {
    setWorking(true);
    setError('');
    try {
      const response = await apiClient.post(`/payments/${id}/${action}`, {
        ...(reason ? { reason } : {}),
        idempotencyKey: keyFor(action),
      });
      setPayment(response.data.data as FinancePayment);
      setSuccess(
        action === 'post'
          ? 'Payment posted.'
          : action === 'fail'
            ? 'Payment marked as failed.'
            : 'Reversal posted.',
      );
      delete actionKeys.current[action];
    } catch (caught) {
      setError(
        (caught as ApiFailure).response?.data?.error?.message ??
          `Unable to ${action} this payment.`,
      );
    } finally {
      setWorking(false);
    }
  }

  async function openFile(path: string, fallback: string) {
    try {
      const response = await apiClient.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError(fallback);
    }
  }

  if (loading)
    return (
      <main className="inventory-page">
        <section className="state">Loading payment...</section>
      </main>
    );
  if (!payment)
    return (
      <main className="inventory-page">
        <section className="state error">
          {error || 'Payment not found.'}
          <button onClick={() => void load()}>Retry</button>
        </section>
      </main>
    );

  const shop = typeof payment.shopId === 'string' ? undefined : payment.shopId;
  const invoice = typeof payment.invoiceId === 'string' ? undefined : payment.invoiceId;
  const delivery = typeof payment.deliveryId === 'string' ? undefined : payment.deliveryId;
  const reversal =
    typeof payment.reversalPaymentId === 'string' ? undefined : payment.reversalPaymentId;
  const original =
    typeof payment.reversesPaymentId === 'string' ? undefined : payment.reversesPaymentId;

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Payment details</p>
          <h1>{payment.reference}</h1>
          <p>{payment.status}</p>
        </div>
        <div className="actions">
          <Link className="secondary-button" to={ownerMode ? '/account/payments' : '/payments'}>
            Payment list
          </Link>
          <button
            className="secondary-button"
            onClick={() =>
              void openFile(
                `/payments/${payment._id}/receipt?format=pdf`,
                'Unable to open the receipt PDF.',
              )
            }
          >
            Receipt PDF
          </button>
          {payment.attachment || payment.attachmentId ? (
            <button
              className="secondary-button"
              onClick={() =>
                void openFile(
                  `/payments/${payment._id}/attachment`,
                  'Unable to open payment proof.',
                )
              }
            >
              Payment proof
            </button>
          ) : null}
        </div>
      </header>
      {error ? (
        <section className="state error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}
      {success ? (
        <section className="state success" role="status">
          {success}
        </section>
      ) : null}

      <section className="detail-grid">
        <article className="panel receipt-print">
          <div className="panel-heading">
            <h2>Receipt</h2>
            <span className={`status finance-status ${payment.status.toLowerCase()}`}>
              {payment.status}
            </span>
          </div>
          <strong className="finance-hero-amount">{formatMinor(payment.amountMinor)}</strong>
          <dl>
            <dt>Shop</dt>
            <dd>
              {shop?.name ?? '—'}
              <small>{shop?.reference}</small>
            </dd>
            <dt>Invoice</dt>
            <dd>{invoice?.reference ?? 'Unallocated / advance'}</dd>
            <dt>Delivery</dt>
            <dd>{delivery?.reference ?? '—'}</dd>
            <dt>Method</dt>
            <dd>{payment.method.replaceAll('_', ' ')}</dd>
            <dt>Transaction</dt>
            <dd>{payment.transactionReference ?? '—'}</dd>
            <dt>Collected by</dt>
            <dd>{populatedName(payment.collectedBy)}</dd>
            <dt>Received by</dt>
            <dd>{populatedName(payment.receivedBy)}</dd>
            <dt>Collection time</dt>
            <dd>{formatFinanceDateTime(payment.collectionTime ?? payment.collectedAt)}</dd>
            <dt>Posting time</dt>
            <dd>{formatFinanceDateTime(payment.postingTime ?? payment.postedAt)}</dd>
          </dl>
          {payment.notes ? (
            <p>
              <strong>Notes:</strong> {payment.notes}
            </p>
          ) : null}
        </article>

        <article className="panel">
          <h2>Financial controls</h2>
          {payment.status === 'PENDING' && !ownerMode ? (
            <div className="actions vertical-actions">
              <button
                className="primary-button"
                disabled={working}
                onClick={() => {
                  void (async () => {
                    const agreed = await ask.confirm({
                      title: 'Post this payment to the ledger?',
                      description:
                        'Posting is permanent. The invoice balance changes immediately and the ' +
                        'entry cannot be edited afterwards — only reversed, which leaves both records.',
                      confirmLabel: 'Post payment',
                    });
                    if (agreed) await runAction('post');
                  })();
                }}
              >
                Post payment
              </button>
              <button
                className="danger-button"
                disabled={working}
                onClick={() => {
                  void (async () => {
                    const reason = await ask.prompt({
                      title: 'Mark this collection as failed',
                      description: 'The money was not received. Say what happened.',
                      label: 'Reason',
                      multiline: true,
                      confirmLabel: 'Mark as failed',
                      danger: true,
                      validate: requireReason(),
                    });
                    if (reason) await runAction('fail', reason);
                  })();
                }}
              >
                Mark failed
              </button>
            </div>
          ) : null}
          {payment.status === 'POSTED' && canReverse ? (
            <button
              className="danger-button"
              disabled={working}
              onClick={() => {
                void (async () => {
                  /*
                   * Reversing posted money used to be a `window.confirm` followed
                   * by a `window.prompt`, and Playwright dismisses both — so a
                   * test could have claimed to cover this while cancelling it.
                   */
                  const reason = await ask.prompt({
                    title: 'Reverse this payment?',
                    description:
                      'This does not delete anything. It writes an opposite entry, so both the ' +
                      'payment and the reversal stay on the customer’s ledger for good, and the ' +
                      'invoice goes back to being due.',
                    label: 'Why is it being reversed?',
                    multiline: true,
                    confirmLabel: 'Reverse payment',
                    danger: true,
                    validate: requireReason(),
                  });
                  if (reason) await runAction('reverse', reason);
                })();
              }}
            >
              Reverse payment
            </button>
          ) : null}
          {ownerMode ? (
            <p className="muted">
              Posted financial records are read-only. Contact MedSupply B2B if a correction is
              required.
            </p>
          ) : null}
          {payment.reversalReference ? (
            <p>
              This payment was reversed by <strong>{payment.reversalReference}</strong>.
            </p>
          ) : null}
          {reversal ? (
            <p>
              <Link to={`/payments/${reversal._id}`}>Open reversal {reversal.reference}</Link>
            </p>
          ) : null}
          {original ? (
            <p>
              <Link to={`/payments/${original._id}`}>Open original {original.reference}</Link>
            </p>
          ) : null}
          <dl>
            <dt>Source</dt>
            <dd>{payment.source?.replaceAll('_', ' ') ?? 'Manual'}</dd>
            <dt>Created</dt>
            <dd>{formatFinanceDateTime(payment.createdAt)}</dd>
            <dt>Attachment</dt>
            <dd>{payment.attachment?.fileName ?? (payment.attachmentId ? 'Available' : 'None')}</dd>
          </dl>
        </article>
      </section>
    </main>
  );
}
