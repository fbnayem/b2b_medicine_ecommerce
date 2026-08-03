import { useCallback, useEffect, useState } from 'react';
import {
  NotificationCategory,
  RealtimeEvent,
  type ActivityEventRecord,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useRealtimeEvent } from '../realtime/useRealtime';
import './inventory.css';
import { formatFinanceDateTime } from '../lib/finance';

const categories = ['', ...Object.values(NotificationCategory)] as const;
const PAGE_SIZE = 30;

/**
 * Organisation-wide activity stream. The server filters each record by the
 * viewer's role, so a Shop Owner sees only their own shop's shop-visible events.
 */
export function ActivityFeed() {
  const [items, setItems] = useState<ActivityEventRecord[]>([]);
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await apiClient.get('/activity', {
          params: { page, limit: PAGE_SIZE, ...(category ? { category } : {}) },
        });
        setItems(response.data.data);
        setTotal(response.data.meta.total);
        setError('');
      } catch {
        setError('Unable to load the activity feed.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [category, page],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeEvent(RealtimeEvent.ACTIVITY_CREATED, () => {
    if (page === 1) void load(true);
  });

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Activity feed</h1>
          <p>Live business events across orders, fulfilment, delivery and finance.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()}>
          Refresh now
        </button>
      </header>

      <nav className="filter-tabs" aria-label="Activity category">
        {categories.map((value) => (
          <button
            key={value || 'all'}
            className={category === value ? 'selected' : ''}
            onClick={() => {
              setCategory(value);
              setPage(1);
            }}
          >
            {value ? value.replaceAll('_', ' ') : 'All'}
          </button>
        ))}
      </nav>

      {error ? (
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}

      {loading ? (
        <section className="state">Loading activity...</section>
      ) : items.length === 0 ? (
        <section className="state">No activity has been recorded for this filter.</section>
      ) : (
        <section className="activity-timeline">
          <ol>
            {items.map((item) => (
              <li key={item._id}>
                <p className="timeline-summary">{item.summary}</p>
                {item.detail ? <p className="timeline-detail">{item.detail}</p> : null}
                <p className="timeline-meta">
                  {formatFinanceDateTime(item.occurredAt)}
                  {item.actorName ? ` · ${item.actorName}` : ''} · {item.category}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <nav className="pagination" aria-label="Activity pages">
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
