import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DeliveryStatus, RealtimeEvent } from '@medsupply/shared-types';
import type { Delivery } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useLiveRefresh } from '../realtime/useRealtime';
import './inventory.css';
import { formatFinanceDate } from '../lib/finance';

const statuses = ['', ...Object.values(DeliveryStatus)] as const;

export function DeliveryBoard() {
  const [data, setData] = useState<Delivery[]>([]);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await apiClient.get('/deliveries', {
          params: { ...(status ? { status } : {}), ...(query.trim() ? { q: query.trim() } : {}) },
        });
        setData(response.data.data);
        setError('');
      } catch {
        setError('Unable to load the delivery board.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [query, status],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // Realtime is the primary signal; polling stays as the fallback for blocked sockets.
  useLiveRefresh(RealtimeEvent.DELIVERY_UPDATED, () => void load(true), 30_000);
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Dispatch control</p>
          <h1>Delivery board</h1>
          <p>Assignment, handover, delivery progress, failed attempts, and proof of delivery.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()}>
          Refresh now
        </button>
      </header>
      <form
        className="search-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label htmlFor="delivery-search">Delivery reference</label>
        <div>
          <input
            id="delivery-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="DEL-2026-000001"
          />
          <button type="submit">Search</button>
        </div>
      </form>
      <nav className="filter-tabs" aria-label="Delivery status">
        {statuses.map((value) => (
          <button
            key={value}
            className={status === value ? 'selected' : ''}
            onClick={() => setStatus(value)}
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
        <section className="state">Loading deliveries...</section>
      ) : data.length === 0 ? (
        <section className="state">No deliveries match this queue.</section>
      ) : (
        <section className="catalogue-grid">
          {data.map((delivery) => {
            const shop = typeof delivery.shopId === 'string' ? undefined : delivery.shopId;
            const order = typeof delivery.orderId === 'string' ? undefined : delivery.orderId;
            const person =
              typeof delivery.assignedTo === 'string' ? undefined : delivery.assignedTo;
            return (
              <Link className="medicine-card" to={`/deliveries/${delivery._id}`} key={delivery._id}>
                <div className="card-top">
                  <span className="reference">{delivery.reference}</span>
                  <span className="status">{delivery.priority}</span>
                </div>
                <h2>{shop?.name ?? 'Delivery'}</h2>
                <p>{order?.reference ?? ''}</p>
                <p>{person ? `${person.firstName} ${person.lastName}` : 'Unassigned'}</p>
                <div className="card-bottom">
                  <strong>{delivery.status.replaceAll('_', ' ')}</strong>
                  <span>
                    {delivery.expectedDeliveryDate
                      ? formatFinanceDate(delivery.expectedDeliveryDate)
                      : 'Date pending'}
                  </span>
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
