import { useCallback, useEffect, useState } from 'react';
import type { AuditLogRecord, User } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import './inventory.css';
import { formatFinanceDateTime } from '../lib/finance';

const PAGE_SIZE = 25;

interface AuditRow extends Omit<AuditLogRecord, 'actorId'> {
  actorId: (Partial<User> & { _id: string }) | string;
}

function actorLabel(actor: AuditRow['actorId']) {
  if (!actor) return 'Unknown actor';
  if (typeof actor === 'string') return actor;
  const name = [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim();
  return name || actor.email || String(actor._id);
}

/** Shows only what the record itself contains; nothing is inferred or re-derived. */
function summarise(row: AuditRow) {
  const changed = row.after && typeof row.after === 'object' ? Object.keys(row.after) : [];
  return changed.length ? `${changed.slice(0, 6).join(', ')}` : 'No recorded detail';
}

export function AuditLogViewer() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/admin/audit', {
        params: {
          page,
          limit: PAGE_SIZE,
          ...(action ? { action } : {}),
          ...(entityType ? { entityType } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      });
      setRows(response.data.data);
      setTotal(response.data.meta.total);
      setError('');
    } catch (caught) {
      const failure = caught as { response?: { status?: number } };
      setError(
        failure.response?.status === 403
          ? 'Your role cannot read the audit log.'
          : 'Unable to load the audit log.',
      );
    } finally {
      setLoading(false);
    }
  }, [action, entityType, from, page, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    apiClient
      .get('/admin/audit/actions')
      .then((response) => setActions(response.data.data))
      .catch(() => setActions([]));
  }, []);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Audit log</h1>
          <p>Append-only record of sensitive operations. Entries cannot be edited or removed.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()}>
          Reload
        </button>
      </header>

      <div className="notification-actions">
        <label htmlFor="audit-action">Action</label>
        <select
          id="audit-action"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All actions</option>
          {actions.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <label htmlFor="audit-entity">Entity type</label>
        <input
          id="audit-entity"
          value={entityType}
          placeholder="Order, Payment, User..."
          onChange={(event) => {
            setEntityType(event.target.value);
            setPage(1);
          }}
        />
        <label htmlFor="audit-from">From</label>
        <input
          id="audit-from"
          type="date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setPage(1);
          }}
        />
        <label htmlFor="audit-to">To</label>
        <input
          id="audit-to"
          type="date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {error ? (
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}

      {loading ? (
        <section className="state">Loading the audit log...</section>
      ) : rows.length === 0 ? (
        <section className="state">No audit records match this filter.</section>
      ) : (
        <section className="notification-list">
          {rows.map((row) => (
            <article key={row._id} className="notification-row">
              <div>
                <p className="notification-title">{row.action.replaceAll('_', ' ')}</p>
                <p>
                  {row.entityType} · {String(row.entityId)}
                </p>
                <p className="notification-meta">
                  {actorLabel(row.actorId)} ({row.actorRole?.replaceAll('_', ' ')}) ·{' '}
                  {formatFinanceDateTime(row.createdAt)}
                  {row.ipAddress ? ` · ${row.ipAddress}` : ''}
                </p>
                <p className="notification-meta">{summarise(row)}</p>
                {expanded === row._id ? (
                  <pre className="audit-detail">
                    {JSON.stringify({ before: row.before, after: row.after }, null, 2)}
                  </pre>
                ) : null}
              </div>
              <div className="notification-row-actions">
                <button
                  type="button"
                  className="secondary-button"
                  aria-expanded={expanded === row._id}
                  onClick={() => setExpanded(expanded === row._id ? null : row._id)}
                >
                  {expanded === row._id ? 'Hide detail' : 'Show detail'}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <nav className="pagination" aria-label="Audit pages">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {lastPage}
        </span>
        <button type="button" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </nav>
    </main>
  );
}
