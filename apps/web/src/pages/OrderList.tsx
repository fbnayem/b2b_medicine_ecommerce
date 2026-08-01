import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Order } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import './inventory.css';
export function OrderList() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true);
    setError('');
    try {
      setOrders((await apiClient.get('/orders')).data.data);
    } catch {
      setError('Unable to load orders.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Ordering</p>
          <h1>Orders</h1>
        </div>
        <Link className="primary-button" to="/medicines">
          Create order
        </Link>
      </header>
      {error && (
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      )}
      {loading ? (
        <section className="state">Loading orders…</section>
      ) : orders.length === 0 ? (
        <section className="state">No orders yet.</section>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Items</th>
                  <th>Estimate</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order._id}>
                    <td>
                      <Link to={`/orders/${order._id}`}>{order.reference}</Link>
                    </td>
                    <td>
                      {new Date(order.createdAt).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td>{order.status.replaceAll('_', ' ')}</td>
                    <td>{order.items.length}</td>
                    <td>৳{(order.estimatedTotalMinor / 100).toFixed(2)}</td>
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
