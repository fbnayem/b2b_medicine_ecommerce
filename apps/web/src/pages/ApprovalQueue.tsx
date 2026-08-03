import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { OrderStatus } from '@medsupply/shared-types';
import type { Order, Shop } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import './inventory.css';
import { formatFinanceDateTime, formatMinor } from '../lib/finance';
export function ApprovalQueue() {
  const [data, setData] = useState<Order[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(
        (await apiClient.get('/approvals/queue', { params: status ? { status } : {} })).data.data,
      );
    } catch {
      setError('Unable to load approval queue.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [status]);
  const states = [
    OrderStatus.SUBMITTED,
    OrderStatus.UNDER_REVIEW,
    OrderStatus.ON_HOLD,
    OrderStatus.APPROVED,
    OrderStatus.PARTIALLY_APPROVED,
    OrderStatus.REJECTED,
  ];
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Manager</p>
          <h1>Approval queue</h1>
          <p>Review stock, credit and licence risks before reserving inventory.</p>
        </div>
      </header>
      <nav className="filter-tabs">
        <button className={!status ? 'selected' : ''} onClick={() => setStatus('')}>
          All
        </button>
        {states.map((value) => (
          <button
            key={value}
            className={status === value ? 'selected' : ''}
            onClick={() => setStatus(value)}
          >
            {value.replaceAll('_', ' ')}
          </button>
        ))}
      </nav>
      {error && (
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      )}
      {loading ? (
        <section className="state">Loading queue...</section>
      ) : data.length === 0 ? (
        <section className="state">No orders in this queue.</section>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Shop</th>
                  <th>Status</th>
                  <th>Estimate</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data.map((order) => {
                  const shop = order.shopId as Shop;
                  return (
                    <tr key={order._id}>
                      <td>
                        <Link to={`/approvals/${order._id}`}>{order.reference}</Link>
                      </td>
                      <td>{shop.name}</td>
                      <td>{order.status.replaceAll('_', ' ')}</td>
                      <td>{formatMinor(order.estimatedTotalMinor)}</td>
                      <td>{order.submittedAt ? formatFinanceDateTime(order.submittedAt) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
