import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { OrderStatus } from '@medsupply/shared-types';
import type { Order } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useCart } from '../store/useCart';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { ActivityEntityType } from '@medsupply/shared-types';
import './inventory.css';
import { formatFinanceDateTime, formatMinor } from '../lib/finance';
import { requireReason, useAsk } from '../components/ui';

export function OrderDetail() {
  const ask = useAsk();
  const { id } = useParams();
  const [params] = useSearchParams();
  const [order, setOrder] = useState<Order>();
  const [deliveryId, setDeliveryId] = useState('');
  const [error, setError] = useState('');
  const { clear, add, setQuantity, setDraftId } = useCart();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      setOrder((await apiClient.get(`/orders/${id}`)).data.data);
      try {
        setDeliveryId((await apiClient.get(`/deliveries/order/${id}`)).data.data._id);
      } catch {
        setDeliveryId('');
      }
      setError('');
    } catch {
      setError('Unable to load order.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function repeat() {
    const response = await apiClient.post(`/orders/${id}/duplicate`);
    clear();
    for (const item of response.data.data.items) {
      const medicine = (await apiClient.get(`/inventory/medicines/${item.medicineId}`)).data.data;
      add(medicine);
      setQuantity(medicine._id, item.requestedQuantity);
    }
    setDraftId(response.data.data._id);
    navigate('/cart');
  }

  async function cancel() {
    const reason = await ask.prompt({
      title: 'Ask to cancel this order',
      description:
        'A manager decides cancellations. You will be told whether yours was granted, and the ' +
        'order carries on in the meantime.',
      label: 'Why do you want to cancel it?',
      multiline: true,
      confirmLabel: 'Send the request',
      validate: requireReason(),
    });
    if (!reason) return;
    await apiClient.post(`/orders/${id}/cancellation-request`, { reason });
    await load();
  }

  if (error)
    return (
      <main className="inventory-page">
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      </main>
    );
  if (!order)
    return (
      <main className="inventory-page">
        <section className="state">Loading order...</section>
      </main>
    );
  const cancellable = [
    OrderStatus.SUBMITTED,
    OrderStatus.UNDER_REVIEW,
    OrderStatus.ON_HOLD,
  ].includes(order.status as typeof OrderStatus.SUBMITTED);
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">
            {params.get('submitted') ? 'Order submitted successfully' : 'Order details'}
          </p>
          <h1>{order.reference}</h1>
          <p>{order.status.replaceAll('_', ' ')}</p>
        </div>
        <div className="actions">
          <button className="secondary-button" onClick={() => void repeat()}>
            Repeat order
          </button>
          {cancellable && !order.cancellationRequestedAt ? (
            <button className="secondary-button" onClick={() => void cancel()}>
              Request cancellation
            </button>
          ) : null}
          {deliveryId ? (
            <Link className="secondary-button" to={`/deliveries/${deliveryId}`}>
              Track delivery
            </Link>
          ) : null}
          <Link className="secondary-button" to="/orders">
            All orders
          </Link>
        </div>
      </header>
      {order.cancellationRequestedAt ? (
        <section className="state">Cancellation requested: {order.cancellationReason}</section>
      ) : null}
      <section className="detail-grid">
        <article className="panel">
          <h2>Items</h2>
          {order.items.map((item) => (
            <div className="card-bottom" key={item.medicineId}>
              <div>
                <strong>
                  {item.medicineSnapshot.brandName} {item.medicineSnapshot.strength}
                </strong>
                <small>
                  {item.requestedQuantity} × {formatMinor(item.estimatedUnitPriceMinor)}
                </small>
              </div>
              <strong>{formatMinor(item.estimatedLineTotalMinor)}</strong>
            </div>
          ))}
          <div className="card-bottom">
            <strong>Estimated total</strong>
            <strong>{formatMinor(order.estimatedTotalMinor)}</strong>
          </div>
        </article>
        <article className="panel">
          <h2>Status timeline</h2>
          <ol className="movement-list">
            {order.statusHistory.map((entry, index) => (
              <li key={`${entry.to}-${index}`}>
                <div>
                  <strong>{entry.to.replaceAll('_', ' ')}</strong>
                  <small>{entry.note}</small>
                </div>
                <small>{formatFinanceDateTime(entry.at)}</small>
              </li>
            ))}
          </ol>
        </article>
      </section>
      <ActivityTimeline
        entityType={ActivityEntityType.ORDER}
        entityId={String(order._id)}
        title="Order activity"
      />
    </main>
  );
}
