import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { formatFinanceDate, formatFinanceDateTime, formatMinor } from '../lib/finance';
import type { FinanceReportData, FinanceReportRow } from './financeTypes';
import './inventory.css';

type ReportKind = 'outstanding' | 'overdue' | 'collections';

interface ReportSummary {
  outstandingBalanceMinor?: number;
  overdueBalanceMinor?: number;
  collectedAmountMinor?: number;
  pendingCollectionMinor?: number;
  shopCount?: number;
}

const reportCopy: Record<ReportKind, { title: string; description: string }> = {
  outstanding: {
    title: 'Outstanding report',
    description: 'Customer balances and open invoice exposure.',
  },
  overdue: {
    title: 'Overdue report',
    description: 'Balances past invoice due dates, ordered by risk.',
  },
  collections: {
    title: 'Collection report',
    description: 'Collected, pending, failed and reversed payments.',
  },
};

function reportAmount(kind: ReportKind, row: FinanceReportRow) {
  if (kind === 'outstanding') return row.outstandingBalanceMinor ?? row.amountMinor ?? 0;
  if (kind === 'overdue') return row.overdueBalanceMinor ?? row.amountMinor ?? 0;
  return row.collectedAmountMinor ?? row.amountMinor ?? 0;
}

function FinancialReportPage({ kind }: { kind: ReportKind }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  const [rows, setRows] = useState<FinanceReportRow[]>([]);
  const [summary, setSummary] = useState<ReportSummary>({});
  const [totalMinor, setTotalMinor] = useState(0);
  const [asOf, setAsOf] = useState(today);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState({ asOf: today, from: monthStart, to: today });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params =
        kind === 'collections' ? { from: applied.from, to: applied.to } : { asOf: applied.asOf };
      const [reportResponse, summaryResponse] = await Promise.all([
        apiClient.get(`/finance/reports/${kind}`, { params }),
        apiClient.get('/finance/reports/summary', { params }),
      ]);
      const raw = reportResponse.data.data as FinanceReportData | FinanceReportRow[];
      const data = Array.isArray(raw) ? { rows: raw } : raw;
      setRows(data.rows);
      setTotalMinor(
        data.totalMinor ??
          data.outstandingTotalMinor ??
          data.overdueTotalMinor ??
          data.collectedTotalMinor ??
          data.rows.reduce((sum, row) => sum + reportAmount(kind, row), 0),
      );
      setSummary(summaryResponse.data.data as ReportSummary);
      setError('');
    } catch {
      setError(`Unable to load the ${kind} report.`);
    } finally {
      setLoading(false);
    }
  }, [applied, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = reportCopy[kind];
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Finance reports</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <Link className="secondary-button" to="/payments">
          Payments
        </Link>
      </header>
      <nav className="filter-tabs" aria-label="Financial report">
        <Link className={kind === 'outstanding' ? 'selected' : ''} to="/reports/outstanding">
          Outstanding
        </Link>
        <Link className={kind === 'overdue' ? 'selected' : ''} to="/reports/overdue">
          Overdue
        </Link>
        <Link className={kind === 'collections' ? 'selected' : ''} to="/reports/collections">
          Collections
        </Link>
      </nav>
      <form
        className="panel data-form finance-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ asOf, from, to });
        }}
      >
        {kind === 'collections' ? (
          <div className="form-grid">
            <label>
              From
              <input
                required
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              To
              <input
                required
                min={from}
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>
        ) : (
          <label>
            As of
            <input
              required
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
            />
          </label>
        )}
        <button className="secondary-button">Run report</button>
      </form>
      <section className="metric-grid finance-metrics">
        <article>
          <span>Report total</span>
          <strong>{formatMinor(totalMinor)}</strong>
        </article>
        <article>
          <span>All outstanding</span>
          <strong>{formatMinor(summary.outstandingBalanceMinor ?? 0)}</strong>
        </article>
        <article>
          <span>All overdue</span>
          <strong>{formatMinor(summary.overdueBalanceMinor ?? 0)}</strong>
        </article>
        <article>
          <span>Period collected</span>
          <strong>{formatMinor(summary.collectedAmountMinor ?? 0)}</strong>
        </article>
      </section>
      {error ? (
        <section className="state error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}
      {loading ? (
        <section className="state">Loading report...</section>
      ) : rows.length === 0 ? (
        <section className="state">No records match this report period.</section>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {kind === 'collections' ? (
                    <>
                      <th>Payment</th>
                      <th>Shop</th>
                      <th>Collector</th>
                      <th>Method</th>
                      <th>Status</th>
                      <th>Collected</th>
                      <th>Amount</th>
                    </>
                  ) : (
                    <>
                      <th>Shop</th>
                      <th>Invoices</th>
                      <th>{kind === 'overdue' ? 'Oldest due' : 'Due date'}</th>
                      {kind === 'overdue' ? <th>Days overdue</th> : null}
                      <th>Amount</th>
                      <th>Account</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) =>
                  kind === 'collections' ? (
                    <tr key={row.paymentReference ?? `${index}`}>
                      <td>{row.paymentReference ?? '—'}</td>
                      <td>
                        {row.shopName ?? '—'}
                        <small>{row.shopReference}</small>
                      </td>
                      <td>{row.collectorName ?? '—'}</td>
                      <td>{row.method?.replaceAll('_', ' ') ?? '—'}</td>
                      <td>{row.status ?? '—'}</td>
                      <td>{formatFinanceDateTime(row.collectionTime)}</td>
                      <td>
                        <strong>{formatMinor(reportAmount(kind, row))}</strong>
                      </td>
                    </tr>
                  ) : (
                    <tr key={row.shopId ?? row.shopReference ?? `${index}`}>
                      <td>
                        {row.shopName ?? '—'}
                        <small>{row.shopReference}</small>
                      </td>
                      <td>{row.invoiceCount ?? '—'}</td>
                      <td>{formatFinanceDate(row.oldestDueDate ?? row.dueDate)}</td>
                      {kind === 'overdue' ? <td>{row.overdueDays ?? '—'}</td> : null}
                      <td>
                        <strong>{formatMinor(reportAmount(kind, row))}</strong>
                      </td>
                      <td>
                        {row.shopId ? (
                          <Link to={`/shops/${row.shopId}/ledger`}>View ledger</Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

export function OutstandingReport() {
  return <FinancialReportPage kind="outstanding" />;
}
export function OverdueReport() {
  return <FinancialReportPage kind="overdue" />;
}
export function CollectionReport() {
  return <FinancialReportPage kind="collections" />;
}
