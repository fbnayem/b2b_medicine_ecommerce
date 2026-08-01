import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { FinanceSummaryCards } from '../components/FinanceSummaryCards';
import { formatFinanceDateTime, formatMinor } from '../lib/finance';
import type { AccountSummary, LedgerEntry } from './financeTypes';
import './inventory.css';

export function CustomerLedger() {
  const { shopId } = useParams();
  const [summary, setSummary] = useState<AccountSummary>();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    try {
      const [summaryResponse, ledgerResponse] = await Promise.all([
        apiClient.get(`/finance/shops/${shopId}/summary`),
        apiClient.get(`/finance/shops/${shopId}/ledger`, {
          params: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
        }),
      ]);
      setSummary(summaryResponse.data.data as AccountSummary);
      setEntries(ledgerResponse.data.data as LedgerEntry[]);
      setError('');
    } catch {
      setError('Unable to load this customer ledger.');
    } finally {
      setLoading(false);
    }
  }, [from, shopId, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Customer finance</p>
          <h1>Customer ledger</h1>
          <p>Append-only charges, payments, credits, debits and reversals.</p>
        </div>
        <div className="actions">
          <Link className="secondary-button" to={`/shops/${shopId}`}>
            Shop
          </Link>
          <Link className="secondary-button" to={`/shops/${shopId}/statement`}>
            Statement
          </Link>
          <Link className="primary-button" to={`/payments/new?shopId=${shopId}`}>
            Record payment
          </Link>
        </div>
      </header>
      <form
        className="panel data-form finance-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <div className="form-grid">
          <label>
            From
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>
        <button className="secondary-button">Apply dates</button>
      </form>
      {error ? (
        <section className="state error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}
      {summary ? <FinanceSummaryCards summary={summary} /> : null}
      {loading ? (
        <section className="state">Loading ledger...</section>
      ) : entries.length === 0 ? (
        <section className="state">No ledger entries match this period.</section>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Posted</th>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry._id}>
                    <td>
                      {formatFinanceDateTime(
                        entry.postingTime ?? entry.postedAt ?? entry.createdAt,
                      )}
                    </td>
                    <td>{entry.reference ?? entry.sourceReference ?? '—'}</td>
                    <td>{entry.type.replaceAll('_', ' ')}</td>
                    <td>{entry.description ?? '—'}</td>
                    <td>{entry.debitMinor ? formatMinor(entry.debitMinor) : '—'}</td>
                    <td>{entry.creditMinor ? formatMinor(entry.creditMinor) : '—'}</td>
                    <td>
                      <strong>{formatMinor(entry.balanceAfterMinor)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
