import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { formatFinanceDateTime, formatMinor } from '../lib/finance';
import {
  financePaymentMethods,
  financePaymentStatuses,
  type FinancePayment,
  type PageMeta,
} from './financeTypes';
import './inventory.css';

interface PaymentListProps {
  ownerMode?: boolean;
}

export function PaymentList({ ownerMode = false }: PaymentListProps) {
  const [payments, setPayments] = useState<FinancePayment[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, pages: 1 });
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/payments', {
        params: {
          ...(status ? { status } : {}),
          ...(method ? { method } : {}),
          ...(query ? { q: query } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          page,
          limit: 30,
        },
      });
      setPayments(response.data.data as FinancePayment[]);
      setMeta((response.data.meta ?? { page, pages: 1 }) as PageMeta);
      setError('');
    } catch {
      setError('Unable to load payments.');
    } finally {
      setLoading(false);
    }
  }, [from, method, page, query, status, to]);

  useEffect(() => {
    void load();
  }, [load]);

  function applySearch() {
    setPage(1);
    setQuery(queryInput.trim());
  }

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{ownerMode ? 'Your account' : 'Finance'}</p>
          <h1>{ownerMode ? 'Payment history' : 'Payments'}</h1>
          <p>Posted receipts, pending collections, failures and reversals.</p>
        </div>
        <div className="actions">
          {ownerMode ? (
            <Link className="secondary-button" to="/account">
              Account summary
            </Link>
          ) : (
            <>
              <Link className="secondary-button" to="/payments/collections">
                Review collections
              </Link>
              <Link className="primary-button" to="/payments/new">
                Record payment
              </Link>
            </>
          )}
        </div>
      </header>

      <form
        className="panel data-form finance-filters"
        onSubmit={(event) => {
          event.preventDefault();
          applySearch();
        }}
      >
        <div className="form-grid finance-filter-grid">
          <label>
            Reference or transaction
            <input
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="PAY-2026-000001"
            />
          </label>
          <label>
            Method
            <select
              value={method}
              onChange={(event) => {
                setMethod(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All methods</option>
              {financePaymentMethods.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <button className="secondary-button" type="submit">
          Apply filters
        </button>
      </form>

      <nav className="filter-tabs" aria-label="Payment status">
        <button
          className={!status ? 'selected' : ''}
          onClick={() => {
            setStatus('');
            setPage(1);
          }}
        >
          All
        </button>
        {financePaymentStatuses.map((value) => (
          <button
            key={value}
            className={status === value ? 'selected' : ''}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
          >
            {value}
          </button>
        ))}
      </nav>

      {error ? (
        <section className="state error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}
      {loading ? (
        <section className="state">Loading payments...</section>
      ) : payments.length === 0 ? (
        <section className="state">No payments match these filters.</section>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Payment</th>
                  {!ownerMode ? <th>Shop</th> : null}
                  <th>Invoice / delivery</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Collected</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const shop = typeof payment.shopId === 'string' ? undefined : payment.shopId;
                  const invoice =
                    typeof payment.invoiceId === 'string' ? undefined : payment.invoiceId;
                  const delivery =
                    typeof payment.deliveryId === 'string' ? undefined : payment.deliveryId;
                  const detailPath = ownerMode
                    ? `/account/payments/${payment._id}`
                    : `/payments/${payment._id}`;
                  return (
                    <tr key={payment._id}>
                      <td>
                        <Link to={detailPath}>{payment.reference}</Link>
                      </td>
                      {!ownerMode ? (
                        <td>
                          {shop?.name ?? '—'}
                          <small>{shop?.reference}</small>
                        </td>
                      ) : null}
                      <td>
                        {invoice?.reference ?? 'Unallocated'}
                        <small>{delivery?.reference}</small>
                      </td>
                      <td>{payment.method.replaceAll('_', ' ')}</td>
                      <td>
                        <strong>{formatMinor(payment.amountMinor)}</strong>
                      </td>
                      <td>
                        <span className={`status finance-status ${payment.status.toLowerCase()}`}>
                          {payment.status}
                        </span>
                      </td>
                      <td>
                        {formatFinanceDateTime(
                          payment.collectionTime ?? payment.collectedAt ?? payment.createdAt,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(meta.pages ?? 1) > 1 ? (
            <div className="pagination actions">
              <button
                className="secondary-button"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </button>
              <span>
                Page {meta.page ?? page} of {meta.pages}
              </span>
              <button
                className="secondary-button"
                disabled={page >= (meta.pages ?? 1)}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </section>
      )}
    </main>
  );
}
