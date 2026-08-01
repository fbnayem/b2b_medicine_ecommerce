import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import './inventory.css';

type PickingList = {
  _id: string;
  status: string;
  items: unknown[];
  orderId: { reference: string; shopId: { name: string } };
};

const queues = [
  ['', 'All'],
  ['PENDING', 'Approved & waiting'],
  ['PICKING', 'Picking'],
  ['PAUSED', 'Paused'],
  ['PACKING', 'Packing'],
  ['BLOCKED_DISCREPANCY', 'Discrepancy'],
  ['PACKED', 'Packed'],
] as const;

export function FulfilmentQueue() {
  const [data, setData] = useState<PickingList[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        (await apiClient.get('/fulfilment/queue', { params: status ? { status } : {} })).data.data,
      );
      setError('');
    } catch {
      setError('Unable to load fulfilment queue.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Storekeeper</p>
          <h1>Fulfilment queue</h1>
          <p>Pick, resolve, pack, and hand off approved orders.</p>
        </div>
        <Link className="secondary-button" to="/fulfilment/ready">
          Ready for delivery
        </Link>
      </header>
      <nav className="filter-tabs" aria-label="Fulfilment status">
        {queues.map(([value, label]) => (
          <button
            key={value}
            className={status === value ? 'selected' : ''}
            onClick={() => setStatus(value)}
          >
            {label}
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
        <section className="state">Loading queue...</section>
      ) : data.length === 0 ? (
        <section className="state">No fulfilment work in this queue.</section>
      ) : (
        <section className="catalogue-grid">
          {data.map((list) => (
            <Link className="medicine-card" to={`/fulfilment/${list._id}`} key={list._id}>
              <span className="reference">{list.orderId.reference}</span>
              <h2>{list.orderId.shopId.name}</h2>
              <p>{list.items.length} allocated batch line(s)</p>
              <div className="card-bottom">
                <strong>{list.status.replaceAll('_', ' ')}</strong>
                <span>Open</span>
              </div>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
