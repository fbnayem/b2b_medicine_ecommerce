import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { FinanceSummaryCards } from '../components/FinanceSummaryCards';
import { formatFinanceDate, formatFinanceDateTime, formatMinor } from '../lib/finance';
import {
  invoiceDue,
  type AccountSummary,
  type FinanceInvoiceSummary,
  type FinancePayment,
} from './financeTypes';
import './inventory.css';

export function ShopAccount() {
  const [summary, setSummary] = useState<AccountSummary>();
  const [invoices, setInvoices] = useState<FinanceInvoiceSummary[]>([]);
  const [payments, setPayments] = useState<FinancePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResponse, invoiceResponse, paymentResponse] = await Promise.all([
        apiClient.get('/finance/my/summary'),
        apiClient.get('/finance/my/invoices'),
        apiClient.get('/payments', { params: { page: 1, limit: 10 } }),
      ]);
      setSummary(summaryResponse.data.data as AccountSummary);
      setInvoices(invoiceResponse.data.data as FinanceInvoiceSummary[]);
      setPayments(paymentResponse.data.data as FinancePayment[]);
      setError('');
    } catch {
      setError('Unable to load your financial account.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openInvoice(invoiceId: string) {
    try {
      const response = await apiClient.get(`/fulfilment/invoices/${invoiceId}/pdf`, {
        params: { layout: 'a4' },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError('Unable to open this invoice PDF.');
    }
  }

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>Account and credit</h1>
          <p>Invoices, payments, outstanding balance and available credit.</p>
        </div>
        <div className="actions">
          <Link className="secondary-button" to="/account/payments">
            Payment history
          </Link>
          <Link className="primary-button" to="/account/statement">
            Account statement
          </Link>
        </div>
      </header>
      {error ? (
        <section className="state error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}
      {loading ? (
        <section className="state">Loading your account...</section>
      ) : summary ? (
        <>
          <FinanceSummaryCards summary={summary} />
          <section className="detail-grid">
            <article className="panel">
              <div className="panel-heading">
                <h2>Invoices</h2>
                <span>{invoices.length}</span>
              </div>
              {invoices.length === 0 ? (
                <div className="state">No invoices have been issued.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Date</th>
                        <th>Due date</th>
                        <th>Total</th>
                        <th>Remaining</th>
                        <th>Document</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((invoice) => (
                        <tr key={invoice._id}>
                          <td>{invoice.reference}</td>
                          <td>{formatFinanceDate(invoice.invoiceDate)}</td>
                          <td>{formatFinanceDate(invoice.dueDate)}</td>
                          <td>{formatMinor(invoice.grandTotalMinor)}</td>
                          <td>
                            <strong>{formatMinor(invoiceDue(invoice))}</strong>
                          </td>
                          <td>
                            <button
                              className="secondary-button"
                              onClick={() => void openInvoice(invoice._id)}
                            >
                              PDF
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
            <article className="panel">
              <div className="panel-heading">
                <h2>Recent payments</h2>
                <Link to="/account/payments">View all</Link>
              </div>
              {payments.length === 0 ? (
                <div className="state">No payments recorded yet.</div>
              ) : (
                <ol className="movement-list">
                  {payments.map((payment) => (
                    <li key={payment._id}>
                      <div>
                        <Link to={`/account/payments/${payment._id}`}>
                          <strong>{payment.reference}</strong>
                        </Link>
                        <span>{payment.method.replaceAll('_', ' ')}</span>
                        <small>
                          {formatFinanceDateTime(
                            payment.collectionTime ?? payment.collectedAt ?? payment.createdAt,
                          )}
                        </small>
                      </div>
                      <div>
                        <strong>{formatMinor(payment.amountMinor)}</strong>
                        <small>{payment.status}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}
