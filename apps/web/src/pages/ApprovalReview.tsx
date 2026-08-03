import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { OrderStatus } from '@medsupply/shared-types';
import type { Order, Shop } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import './inventory.css';
import { formatMinor } from '../lib/finance';
import { Badge, Card, requireReason, useAsk } from '../components/ui';
type Stock = {
  _id: string;
  available: number;
  batches: Array<{ batchNumber: string; expiryDate: string; available: number }>;
};
/** What the server will actually enforce, rather than what this page can guess. */
type Credit = {
  creditLimitMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  reservedExposureMinor: number;
  availableCreditMinor: number;
  projectedExposureMinor: number;
  orderBlocked: boolean;
  blockReasons: string[];
};
type Line = {
  orderItemId: string;
  approvedQuantity: number;
  unitPriceMinor: number;
  lineDiscountMinor: number;
};
export function ApprovalReview() {
  const ask = useAsk();
  const { id } = useParams();
  const [data, setData] = useState<{
    order: Order;
    stock: Stock[];
    history: Order[];
    credit?: Credit;
    canOverrideCredit?: boolean;
    approvals: unknown[];
  } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [delivery, setDelivery] = useState(0);
  const [internal, setInternal] = useState('');
  const [ownerNote, setOwnerNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [overrideCredit, setOverrideCredit] = useState(false);
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
  /**
   * Answering a cancellation request.
   *
   * The request endpoint existed and stamped a timestamp; nothing anywhere
   * decided it, so every request a shop owner made sat unanswered while the
   * warehouse carried on picking the order.
   */
  async function decideCancellation(approve: boolean) {
    if (!data) return;
    const reason = await ask.prompt({
      title: approve ? 'Cancel this order?' : 'Refuse the cancellation?',
      description: approve
        ? 'The stock it is holding goes back on the shelf and the credit it reserved is released. ' +
          'This cannot be undone — a new order would have to be raised.'
        : 'The order carries on as normal and the shop is told why you could not cancel it.',
      label: approve ? 'Why is it being cancelled?' : 'Why can it not be cancelled?',
      multiline: true,
      confirmLabel: approve ? 'Cancel the order' : 'Refuse the request',
      danger: approve,
      validate: requireReason(),
    });
    if (!reason) return;

    setError('');
    try {
      const response = await apiClient.post(`/orders/${data.order._id}/cancellation-decision`, {
        approve,
        reason,
        version: data.order.version,
      });
      const meta = response.data?.meta ?? {};
      setSuccess(
        approve
          ? `Order cancelled. ${formatMinor(meta.releasedCreditMinor ?? 0)} of credit and ` +
              `${meta.releasedStockUnits ?? 0} units were released.`
          : 'The cancellation was refused and the shop has been told why.',
      );
      await load();
    } catch (caught: unknown) {
      setError(
        (caught as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Unable to record that decision.',
      );
    }
  }

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
          // Was hard-coded `false` on both clients, so a manager facing a
          // blocked order had no path forward at all — the service supported an
          // override that nothing could ever ask for.
          creditOverride: overrideCredit,
        };
      else if (name !== 'start') {
        const reason = await ask.prompt({
          title: name === 'hold' ? 'Put this order on hold' : 'Reject this order',
          description:
            name === 'hold'
              ? 'The shop will see that their order is waiting on something, and what.'
              : 'The shop will be told their order was rejected, and why.',
          label: 'Reason',
          multiline: true,
          confirmLabel: name === 'hold' ? 'Put on hold' : 'Reject order',
          danger: name !== 'hold',
          validate: requireReason(),
        });
        if (!reason) return;
        body = {
          ...body,
          reason,
          internalNotes: internal || undefined,
          shopOwnerNotes: ownerNote || reason,
        };
      }
      await apiClient.post(`/approvals/${id}/${name}`, body);
      setSuccess(
        {
          start: 'Review started.',
          hold: 'This order is on hold, and the shop has been told why.',
          reject: 'Order rejected, and the shop has been told why.',
          approve: 'Order approved and sent to the warehouse for picking.',
        }[name],
      );
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
  const { order, stock, history, credit } = data;
  const shop = order.shopId as Shop;
  /*
   * From the server, which counts `reservedCreditMinor` — the exposure of
   * orders already approved and not yet invoiced. This page used to compute
   * `creditLimit - outstandingBalance` locally and could therefore show
   * comfortable headroom on an order the server was about to refuse.
   */
  const availableCredit =
    credit?.availableCreditMinor ?? shop.creditLimit - shop.outstandingBalance;
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
          <strong>{formatMinor(shop.creditLimit)}</strong>
        </article>
        <article>
          <span>Outstanding</span>
          <strong>{formatMinor(shop.outstandingBalance)}</strong>
        </article>
        <article>
          <span>Available credit</span>
          <strong>{formatMinor(availableCredit)}</strong>
        </article>
        <article>
          <span>Already committed</span>
          <strong>{formatMinor(credit?.reservedExposureMinor ?? 0)}</strong>
        </article>
        <article>
          <span>Payment terms</span>
          <strong>{shop.paymentTermsDays} days</strong>
        </article>
      </section>

      {order.cancellationRequestedAt ? (
        <Card className="border-warning bg-warning-subtle">
          <h2 className="text-lg font-semibold">This shop has asked to cancel</h2>
          <p className="mt-1">{order.cancellationReason}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-md bg-danger px-4 font-medium text-on-brand"
              onClick={() => void decideCancellation(true)}
            >
              Cancel the order
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md border border-border bg-surface px-4 font-medium"
              onClick={() => void decideCancellation(false)}
            >
              Refuse and carry on
            </button>
          </div>
        </Card>
      ) : null}

      {credit?.orderBlocked ? (
        <Card className="border-danger bg-danger-subtle">
          <h2 className="text-lg font-semibold">This order is blocked</h2>
          <ul className="mt-2 flex list-disc flex-col gap-1 ps-5">
            {credit.blockReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-text-muted">
            Approving it would take {shop.name} to {formatMinor(credit.projectedExposureMinor)}{' '}
            against a limit of {formatMinor(credit.creditLimitMinor)}.
          </p>

          {data.canOverrideCredit ? (
            <label className="mt-3 flex items-start gap-2">
              <input
                type="checkbox"
                checked={overrideCredit}
                onChange={(event) => setOverrideCredit(event.target.checked)}
              />
              <span>
                <strong>Approve it anyway.</strong> Write the reason in the internal notes below —
                it is required, it is recorded against your name, and it cannot be edited
                afterwards.
              </span>
            </label>
          ) : (
            <p className="mt-3">
              <Badge tone="warning">Administrator decision</Badge> Only an administrator can approve
              an order past its credit limit. Ask one to review it, or reduce the quantities until
              the order fits.
            </p>
          )}
        </Card>
      ) : null}
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
          <strong>Approval total: {formatMinor(total)}</strong>
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
                {previous.reference} / {previous.status} /{' '}
                {formatMinor(previous.estimatedTotalMinor)}
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
