import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RealtimeEvent, UserRole, type ReturnStatus } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { useRealtimeEvent } from '../realtime/useRealtime';
import { formatFinanceDate, formatMinor } from '../lib/finance';
import { RETURN_STATUS_FILTERS, statusLabel } from './returnLabels';
import './inventory.css';

export interface ReturnRow {
  _id: string;
  reference: string;
  status: ReturnStatus;
  primaryReason: string;
  requestedAt: string;
  requestedTotalMinor: number;
  approvedTotalMinor: number;
  creditNoteReference?: string;
  shopId?: { _id: string; reference: string; name?: string } | string;
  invoiceId?: { _id: string; reference: string; name?: string } | string;
}

const named = (value: ReturnRow['shopId']) =>
  typeof value === 'object' && value ? value : undefined;

export function ReturnList() {
  const role = useAuthStore((state) => state.user?.role);
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState({ status: '', q: '' });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/returns', {
        params: {
          page,
          limit: 20,
          ...(applied.status ? { status: applied.status } : {}),
          ...(applied.q ? { q: applied.q } : {}),
        },
      });
      setRows(response.data.data as ReturnRow[]);
      setPages(response.data.meta?.pages ?? 1);
      setError('');
    } catch (caught) {
      const failure = caught as { response?: { status?: number } };
      setError(
        failure.response?.status === 403
          ? 'Your role cannot view returns.'
          : 'Unable to load returns.',
      );
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // A colleague approving or receiving a return should not require a refresh.
  useRealtimeEvent(RealtimeEvent.RETURN_UPDATED, () => {
    void load();
  });

  const isOwner = role === UserRole.SHOP_OWNER;

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Returns</p>
          <h1>{isOwner ? 'My returns' : 'Customer returns'}</h1>
          <p>
            {isOwner
              ? 'Request a return against a delivered invoice and follow it through to the credit note.'
              : 'Review, receive and credit returned goods.'}
          </p>
        </div>
        {isOwner ? (
          <Link className="primary-button" to="/returns/new">
            Request a return
          </Link>
        ) : null}
      </header>

      <form
        className="panel data-form finance-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setApplied({ status, q: query.trim() });
        }}
      >
        <div className="form-grid">
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {RETURN_STATUS_FILTERS.map((entry) => (
                <option key={entry.value || 'all'} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reference
            <input
              value={query}
              placeholder="RET-2026-000001"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <button className="secondary-button">Apply filters</button>
      </form>

      {error ? (
        <section className="state error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}

      {loading ? (
        <section className="state">Loading returns...</section>
      ) : rows.length === 0 ? (
        <section className="state">
          {applied.status || applied.q
            ? 'No returns match these filters.'
            : 'No returns have been requested yet.'}
        </section>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Return</th>
                  {isOwner ? null : <th>Shop</th>}
                  <th>Invoice</th>
                  <th>Requested</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id}>
                    <td>
                      <Link to={`/returns/${row._id}`}>{row.reference}</Link>
                      {row.creditNoteReference ? <small>{row.creditNoteReference}</small> : null}
                    </td>
                    {isOwner ? null : (
                      <td>
                        {named(row.shopId)?.name ?? '—'}
                        <small>{named(row.shopId)?.reference}</small>
                      </td>
                    )}
                    <td>{named(row.invoiceId)?.reference ?? '—'}</td>
                    <td>{formatFinanceDate(row.requestedAt)}</td>
                    <td>{row.primaryReason.replaceAll('_', ' ').toLowerCase()}</td>
                    <td>
                      <span className={`return-status ${row.status.toLowerCase()}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td>
                      <strong>
                        {formatMinor(
                          row.approvedTotalMinor > 0
                            ? row.approvedTotalMinor
                            : row.requestedTotalMinor,
                        )}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <nav className="pagination" aria-label="Return pages">
              <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>
                Next
              </button>
            </nav>
          ) : null}
        </section>
      )}
    </main>
  );
}
