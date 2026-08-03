import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ActivityEntityType,
  DeliveryPriority,
  DeliveryStatus,
  RealtimeEvent,
  UserRole,
} from '@medsupply/shared-types';
import type { Delivery, User } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { useRealtimeEvent } from '../realtime/useRealtime';
import './inventory.css';
import { toDateInputValue } from '@medsupply/utilities';
import { formatFinanceDateTime } from '../lib/finance';
import { useAsk } from '../components/ui';

type DeliveryPerson = Pick<User, '_id' | 'firstName' | 'lastName' | 'email'> & {
  activeDeliveries: number;
};
type ApiFailure = { response?: { data?: { error?: { message?: string } } } };
const managerRoles: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
const actionKey = (name: string) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function DeliveryDetail() {
  const ask = useAsk();
  const { id } = useParams();
  const role = useAuthStore((state) => state.user?.role);
  const [delivery, setDelivery] = useState<Delivery>();
  const [people, setPeople] = useState<DeliveryPerson[]>([]);
  const [personId, setPersonId] = useState('');
  // The Dhaka calendar date. `toISOString()` yields the UTC one, so a
  // storekeeper assigning a delivery before 6 am was offered yesterday.
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [priority, setPriority] = useState<DeliveryPriority>(DeliveryPriority.NORMAL);
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const canManage = role ? managerRoles.includes(role) : false;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const value: Delivery = (await apiClient.get(`/deliveries/${id}`)).data.data;
      setDelivery(value);
      setPersonId(
        typeof value.assignedTo === 'string' ? value.assignedTo : (value.assignedTo?._id ?? ''),
      );
      if (value.expectedDeliveryDate) setDate(value.expectedDeliveryDate.slice(0, 10));
      setPriority(value.priority);
      setInstructions(value.instructions ?? '');
      if (canManage) setPeople((await apiClient.get('/deliveries/personnel')).data.data);
      setError('');
    } catch {
      setError('Unable to load delivery details.');
    } finally {
      setLoading(false);
    }
  }, [canManage, id]);
  useEffect(() => {
    void load();
  }, [load]);
  // Another operator acting on this delivery refreshes the open detail view.
  useRealtimeEvent<{ entityId?: string }>(RealtimeEvent.DELIVERY_UPDATED, (payload) => {
    if (payload?.entityId === id) void load();
  });
  function message(caught: unknown, fallback: string) {
    return (caught as ApiFailure).response?.data?.error?.message ?? fallback;
  }
  async function post(path: string, body: Record<string, unknown>, confirmation: string) {
    if (!delivery) return;
    try {
      await apiClient.post(`/deliveries/${id}/${path}`, {
        version: delivery.version,
        idempotencyKey: actionKey(path),
        ...body,
      });
      setSuccess(confirmation);
      setError('');
      await load();
    } catch (caught) {
      setError(message(caught, 'Delivery action failed.'));
    }
  }
  async function assign() {
    if (!personId || !date) {
      setError('Select a delivery person and expected date.');
      return;
    }
    await post(
      'assign',
      {
        deliveryPersonId: personId,
        expectedDeliveryDate: `${date}T12:00:00+06:00`,
        priority,
        instructions: instructions || undefined,
      },
      'Assignment saved.',
    );
  }
  async function handover() {
    if (
      !delivery ||
      typeof delivery.packageId === 'string' ||
      typeof delivery.invoiceId === 'string'
    )
      return;
    if (
      !(await ask.confirm({
        title: `Hand ${delivery.packageId.reference} over?`,
        description:
          'Custody of the package passes to the delivery person. Confirm only once they are ' +
          'physically holding it.',
        confirmLabel: 'Hand it over',
      }))
    )
      return;
    await post(
      'handover',
      {
        packageReference: delivery.packageId.reference,
        invoiceReference: delivery.invoiceId.reference,
        packageCount: delivery.packageId.packageCount,
      },
      'Package handover confirmed.',
    );
  }
  async function openProof(fileId: string) {
    try {
      const file = await apiClient.get(`/deliveries/proof/${fileId}`, { responseType: 'blob' });
      const url = URL.createObjectURL(file.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError('Unable to open proof file.');
    }
  }
  async function openInvoice(invoiceId: string) {
    try {
      const file = await apiClient.get(`/fulfilment/invoices/${invoiceId}/pdf`, {
        params: { layout: 'a4' },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(file.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError('Unable to open invoice PDF.');
    }
  }
  if (loading)
    return (
      <main className="inventory-page">
        <section className="state">Loading delivery...</section>
      </main>
    );
  if (!delivery)
    return (
      <main className="inventory-page">
        <section className="state error">
          {error || 'Delivery not found.'}
          <button onClick={() => void load()}>Retry</button>
        </section>
      </main>
    );
  const shop = typeof delivery.shopId === 'string' ? undefined : delivery.shopId;
  const order = typeof delivery.orderId === 'string' ? undefined : delivery.orderId;
  const pack = typeof delivery.packageId === 'string' ? undefined : delivery.packageId;
  const invoice = typeof delivery.invoiceId === 'string' ? undefined : delivery.invoiceId;
  const person = typeof delivery.assignedTo === 'string' ? undefined : delivery.assignedTo;
  const assignable =
    delivery.status === DeliveryStatus.READY_FOR_ASSIGNMENT ||
    delivery.status === DeliveryStatus.ASSIGNED ||
    delivery.status === DeliveryStatus.RETURNED_TO_STORE;
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Delivery control</p>
          <h1>{delivery.reference}</h1>
          <p>{delivery.status.replaceAll('_', ' ')}</p>
        </div>
        <div className="actions">
          <Link className="secondary-button" to="/deliveries">
            Delivery board
          </Link>
          {order ? (
            <Link className="secondary-button" to={`/orders/${order._id}`}>
              Order
            </Link>
          ) : null}
        </div>
      </header>
      {error ? (
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}
      {success ? <section className="state success">{success}</section> : null}
      <section className="detail-grid">
        <article className="panel">
          <h2>Package and destination</h2>
          <dl>
            <dt>Shop</dt>
            <dd>{shop?.name}</dd>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${delivery.contactSnapshot.phone}`}>{delivery.contactSnapshot.phone}</a>
            </dd>
            <dt>Address</dt>
            <dd>
              {delivery.addressSnapshot.line1}, {delivery.addressSnapshot.city},{' '}
              {delivery.addressSnapshot.district}
            </dd>
            <dt>Package</dt>
            <dd>
              {pack?.reference} · {pack?.packageCount} package(s)
            </dd>
            <dt>Invoice</dt>
            <dd>{invoice?.reference}</dd>
            <dt>Assigned to</dt>
            <dd>{person ? `${person.firstName} ${person.lastName}` : 'Not assigned'}</dd>
            <dt>Required proof</dt>
            <dd>{delivery.proofRequirements.join(', ')}</dd>
          </dl>
          {invoice ? (
            <button className="secondary-button" onClick={() => void openInvoice(invoice._id)}>
              Open invoice PDF
            </button>
          ) : null}
        </article>
        {canManage && assignable ? (
          <article className="panel">
            <h2>{delivery.assignedTo ? 'Reassign delivery' : 'Assign delivery'}</h2>
            <form
              className="data-form"
              onSubmit={(event) => {
                event.preventDefault();
                void assign();
              }}
            >
              <label>
                Delivery person
                <select value={personId} onChange={(event) => setPersonId(event.target.value)}>
                  <option value="">Select person</option>
                  {people.map((candidate) => (
                    <option key={candidate._id} value={candidate._id}>
                      {candidate.firstName} {candidate.lastName} · {candidate.activeDeliveries}{' '}
                      active
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Expected date
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <label>
                Priority
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as DeliveryPriority)}
                >
                  {Object.values(DeliveryPriority).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Instructions
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </label>
              <button type="submit">Save assignment</button>
            </form>
            {delivery.status === DeliveryStatus.ASSIGNED ? (
              <button
                className="secondary-button"
                onClick={async () =>
                  (await ask.confirm({
                    title: 'Cancel this delivery?',
                    description:
                      'The delivery is called off and the order returns to needing a rider. Use ' +
                      'this only while the package is still at the store.',
                    confirmLabel: 'Cancel delivery',
                    danger: true,
                  })) && void post('cancel', {}, 'Delivery cancelled.')
                }
              >
                Cancel delivery
              </button>
            ) : null}
          </article>
        ) : null}
        {role === UserRole.STOREKEEPER && delivery.status === DeliveryStatus.ASSIGNED ? (
          <article className="panel">
            <h2>Store handover</h2>
            <p>
              Confirm the package reference, invoice, count, assigned person, and current timestamp.
            </p>
            <button onClick={() => void handover()}>Confirm handover</button>
          </article>
        ) : null}
        {role === UserRole.STOREKEEPER && delivery.status === DeliveryStatus.RETURNING ? (
          <article className="panel">
            <h2>Returned package</h2>
            <p>Inspect the physical package before confirming it is back in store custody.</p>
            <button
              onClick={async () =>
                (await ask.confirm({
                  title: 'Is the package back at the store?',
                  description:
                    'Confirm only once you are holding it. This returns custody to the store and ' +
                    'the stock becomes available again.',
                  confirmLabel: 'Yes, it is back',
                })) && void post('returned', {}, 'Return confirmed.')
              }
            >
              Confirm returned to store
            </button>
          </article>
        ) : null}
        {delivery.failure ? (
          <article className="panel">
            <h2>Failed attempt</h2>
            <p>
              <strong>{delivery.failure.reason.replaceAll('_', ' ')}</strong>
            </p>
            <p>{delivery.failure.notes}</p>
            <small>{formatFinanceDateTime(delivery.failure.reportedAt)}</small>
            {canManage && delivery.status === DeliveryStatus.FAILED ? (
              <button onClick={() => void post('returning', {}, 'Return trip started.')}>
                Start return to store
              </button>
            ) : null}
          </article>
        ) : null}
        {delivery.proof ? (
          <article className="panel">
            <h2>Proof of delivery</h2>
            <dl>
              <dt>Receiver</dt>
              <dd>{delivery.proof.receiverName}</dd>
              <dt>Phone</dt>
              <dd>{delivery.proof.receiverPhone}</dd>
              <dt>Packages</dt>
              <dd>{delivery.proof.deliveredPackageCount}</dd>
              <dt>Time</dt>
              <dd>{formatFinanceDateTime(delivery.proof.deliveredAt)}</dd>
              <dt>OTP</dt>
              <dd>{delivery.proof.otpVerifiedAt ? 'Verified' : 'Not required'}</dd>
              <dt>GPS</dt>
              <dd>
                {delivery.proof.gps
                  ? `${delivery.proof.gps.latitude.toFixed(5)}, ${delivery.proof.gps.longitude.toFixed(5)}`
                  : 'Not provided'}
              </dd>
            </dl>
            <div className="actions">
              {delivery.proof.signatureFileId ? (
                <button
                  className="secondary-button"
                  onClick={() => void openProof(delivery.proof!.signatureFileId!)}
                >
                  View signature
                </button>
              ) : null}
              {delivery.proof.photoFileId ? (
                <button
                  className="secondary-button"
                  onClick={() => void openProof(delivery.proof!.photoFileId!)}
                >
                  View photo
                </button>
              ) : null}
            </div>
          </article>
        ) : null}
        <article className="panel">
          <h2>Delivery timeline</h2>
          <ol className="movement-list">
            {delivery.history.map((entry, index) => (
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
        entityType={ActivityEntityType.DELIVERY}
        entityId={String(delivery._id)}
        title="Delivery activity"
      />
    </main>
  );
}
