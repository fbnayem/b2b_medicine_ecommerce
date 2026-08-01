import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { createActionKey, formatFinanceDateTime, formatMinor } from '../lib/finance';
import { populatedName, type ApiFailure, type FinancePayment } from './financeTypes';
import './inventory.css';

export function CollectionReview() {
  const [payments, setPayments] = useState<FinancePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const actionKeys = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/payments', {
        params: { status: 'PENDING', source: 'DELIVERY_COLLECTION', limit: 100 },
      });
      setPayments(response.data.data as FinancePayment[]);
      setError('');
    } catch {
      setError('Unable to load pending delivery collections.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(payment: FinancePayment, action: 'post' | 'fail', reason?: string) {
    const keyName = `${payment._id}:${action}`;
    actionKeys.current[keyName] ??= createActionKey(`${action}-collection`);
    setWorkingId(payment._id);
    setError('');
    try {
      await apiClient.post(`/payments/${payment._id}/${action}`, {
        ...(reason ? { reason } : {}),
        idempotencyKey: actionKeys.current[keyName],
      });
      delete actionKeys.current[keyName];
      setSuccess(
        action === 'post'
          ? `${payment.reference} verified and posted.`
          : `${payment.reference} marked as failed.`,
      );
      await load();
    } catch (caught) {
      setError(
        (caught as ApiFailure).response?.data?.error?.message ??
          'Collection review failed. Retry uses the same safe action key.',
      );
    } finally {
      setWorkingId('');
    }
  }

  async function openProof(payment: FinancePayment) {
    try {
      const response = await apiClient.get(`/payments/${payment._id}/attachment`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError('Unable to open payment proof.');
    }
  }

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Finance verification</p>
          <h1>Collection review</h1>
          <p>Verify Delivery Person submissions before they affect the customer ledger.</p>
        </div>
        <Link className="secondary-button" to="/payments">
          All payments
        </Link>
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
      {loading ? (
        <section className="state">Loading pending collections...</section>
      ) : payments.length === 0 ? (
        <section className="state">No delivery collections are waiting for review.</section>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Shop</th>
                  <th>Invoice / delivery</th>
                  <th>Collector</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const shop = typeof payment.shopId === 'string' ? undefined : payment.shopId;
                  const invoice =
                    typeof payment.invoiceId === 'string' ? undefined : payment.invoiceId;
                  const delivery =
                    typeof payment.deliveryId === 'string' ? undefined : payment.deliveryId;
                  const working = workingId === payment._id;
                  return (
                    <tr key={payment._id}>
                      <td>
                        <Link to={`/payments/${payment._id}`}>{payment.reference}</Link>
                        <small>{payment.transactionReference}</small>
                      </td>
                      <td>
                        {shop?.name ?? '—'}
                        <small>{shop?.reference}</small>
                      </td>
                      <td>
                        {invoice?.reference ?? '—'}
                        <small>{delivery?.reference}</small>
                      </td>
                      <td>{populatedName(payment.collectedBy)}</td>
                      <td>{payment.method.replaceAll('_', ' ')}</td>
                      <td>
                        <strong>{formatMinor(payment.amountMinor)}</strong>
                      </td>
                      <td>
                        {formatFinanceDateTime(payment.collectionTime ?? payment.collectedAt)}
                      </td>
                      <td>
                        <div className="actions table-actions">
                          {payment.attachment || payment.attachmentId ? (
                            <button
                              className="secondary-button"
                              disabled={working}
                              onClick={() => void openProof(payment)}
                            >
                              Proof
                            </button>
                          ) : null}
                          <button
                            className="primary-button"
                            disabled={working}
                            onClick={() =>
                              window.confirm(`Post ${payment.reference} to the customer ledger?`) &&
                              void act(payment, 'post')
                            }
                          >
                            Verify
                          </button>
                          <button
                            className="danger-button"
                            disabled={working}
                            onClick={() => {
                              const reason = window.prompt('Reason for rejecting this collection:');
                              if (reason?.trim()) void act(payment, 'fail', reason.trim());
                            }}
                          >
                            Fail
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
