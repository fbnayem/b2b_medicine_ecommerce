import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { OrderStatus } from '@medsupply/shared-types';
import type { Order, Shop } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import './inventory.css';
type Stock = {
  _id: string;
  available: number;
  batches: Array<{ batchNumber: string; expiryDate: string; available: number }>;
};
type Line = {
  orderItemId: string;
  approvedQuantity: number;
  unitPriceMinor: number;
  lineDiscountMinor: number;
};
export function ApprovalReview() {
  const { id } = useParams();
  const [data, setData] = useState<{
    order: Order;
    stock: Stock[];
    history: Order[];
    approvals: unknown[];
  } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [delivery, setDelivery] = useState(0);
  const [internal, setInternal] = useState('');
  const [ownerNote, setOwnerNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function load() {
    try {
      const value = (await apiClient.get(`/approvals/${id}`)).data.data;
      setData(value);
      setLines(
        value.order.items.map(
          (item: { _id: string; requestedQuantity: number; estimatedUnitPriceMinor: number }) => ({
            orderItemId: item._id,
            approvedQuantity: item.requestedQuantity,
            unitPriceMinor: item.estimatedUnitPriceMinor,
            lineDiscountMinor: 0,
          }),
        ),
      );
    } catch {
      setError('Unable to load review.');
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  const total = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + line.approvedQuantity * line.unitPriceMinor - line.lineDiscountMinor,
        0,
      ) -
      orderDiscount +
      delivery,
    [lines, orderDiscount, delivery],
  );
  async function action(name: 'start' | 'hold' | 'reject' | 'approve') {
    if (!data) return;
    setError('');
    try {
      let body: Record<string, unknown> = { version: data.order.version };
      if (name === 'approve')
        body = {
          ...body,
          lines,
          orderDiscountMinor: orderDiscount,
          deliveryChargeMinor: delivery,
          internalNotes: internal || undefined,
          shopOwnerNotes: ownerNote || undefined,
          creditOverride: false,
        };
      else if (name !== 'start') {
        const reason = window.prompt(`${name === 'hold' ? 'Hold' : 'Rejection'} reason:`);
        if (!reason) return;
        body = {
          ...body,
          reason,
          internalNotes: internal || undefined,
          shopOwnerNotes: ownerNote || reason,
        };
      }
      await apiClient.post(`/approvals/${id}/${name}`, body);
      setSuccess(`${name} completed.`);
      await load();
    } catch (caught: unknown) {
      setError(
        (caught as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Action failed.',
      );
    }
  }
  if (!data)
    return (
      <main className="inventory-page">
        <section className={error ? 'state error' : 'state'}>
          {error || 'Loading review...'}
        </section>
      </main>
    );
  const { order, stock, history } = data;
  const shop = order.shopId as Shop;
  const availableCredit = shop.creditLimit - shop.outstandingBalance;
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Manager review</p>
          <h1>{order.reference}</h1>
          <p>
            {shop.name} / {order.status.replaceAll('_', ' ')}
          </p>
        </div>
        <Link className="secondary-button" to="/approvals">
          Back to queue
        </Link>
      </header>
      {error && <section className="state error">{error}</section>}
      {success && <section className="state success">{success}</section>}
      <section className="metric-grid">
        <article>
          <span>Credit limit</span>
          <strong>৳{(shop.creditLimit / 100).toFixed(2)}</strong>
        </article>
        <article>
          <span>Outstanding</span>
          <strong>৳{(shop.outstandingBalance / 100).toFixed(2)}</strong>
        </article>
        <article>
          <span>Available credit</span>
          <strong>৳{(availableCredit / 100).toFixed(2)}</strong>
        </article>
        <article>
          <span>Payment terms</span>
          <strong>{shop.paymentTermsDays} days</strong>
        </article>
      </section>
      <section className="panel">
        <h2>Requested medicines</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Requested</th>
                <th>Current stock</th>
                <th>Approved</th>
                <th>Unit price (paisa)</th>
                <th>Line discount</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item, index) => {
                const available =
                  stock.find((value) => value._id === item.medicineId)?.available ?? 0;
                const line = lines[index]!;
                return (
                  <tr key={item.medicineId}>
                    <td>
                      <strong>{item.medicineSnapshot.brandName}</strong>
                      <small>{item.medicineSnapshot.genericName}</small>
                    </td>
                    <td>{item.requestedQuantity}</td>
                    <td className={available < item.requestedQuantity ? 'danger' : ''}>
                      {available}
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max={item.requestedQuantity}
                        value={line.approvedQuantity}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((value, i) =>
                              i === index
                                ? { ...value, approvedQuantity: Number(event.target.value) }
                                : value,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={line.unitPriceMinor}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((value, i) =>
                              i === index
                                ? { ...value, unitPriceMinor: Number(event.target.value) }
                                : value,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={line.lineDiscountMinor}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((value, i) =>
                              i === index
                                ? { ...value, lineDiscountMinor: Number(event.target.value) }
                                : value,
                            ),
                          )
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="detail-grid">
        <div className="panel data-form">
          <h2>Decision adjustments</h2>
          <label>
            Order discount (paisa)
            <input
              type="number"
              min="0"
              value={orderDiscount}
              onChange={(event) => setOrderDiscount(Number(event.target.value))}
            />
          </label>
          <label>
            Delivery charge (paisa)
            <input
              type="number"
              min="0"
              value={delivery}
              onChange={(event) => setDelivery(Number(event.target.value))}
            />
          </label>
          <label>
            Internal notes
            <textarea value={internal} onChange={(event) => setInternal(event.target.value)} />
          </label>
          <label>
            Shop Owner-visible notes
            <textarea value={ownerNote} onChange={(event) => setOwnerNote(event.target.value)} />
          </label>
          <strong>Approval total: ৳{(total / 100).toFixed(2)}</strong>
          <div className="actions">
            {order.status === OrderStatus.SUBMITTED && (
              <button className="secondary-button" onClick={() => void action('start')}>
                Start review
              </button>
            )}
            <button className="primary-button" onClick={() => void action('approve')}>
              Confirm approval
            </button>
            <button className="secondary-button" onClick={() => void action('hold')}>
              Hold
            </button>
            <button className="secondary-button" onClick={() => void action('reject')}>
              Reject
            </button>
          </div>
        </div>
        <div className="panel">
          <h2>Previous orders</h2>
          {history.length ? (
            history.map((previous) => (
              <p key={previous._id}>
                {previous.reference} / {previous.status} / ৳
                {(previous.estimatedTotalMinor / 100).toFixed(2)}
              </p>
            ))
          ) : (
            <p>No previous orders.</p>
          )}
          <h2>Approval history</h2>
          <p>{data.approvals.length} decision record(s)</p>
        </div>
      </section>
    </main>
  );
}
