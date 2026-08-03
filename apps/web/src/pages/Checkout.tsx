import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PaymentMethod } from '@medsupply/shared-types';
import type { Shop } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useCart } from '../store/useCart';
import './inventory.css';
export function Checkout() {
  const { items, draftId, clear } = useCart();
  const [shop, setShop] = useState<Shop>();
  const [addressId, setAddressId] = useState('');
  const [payment, setPayment] = useState(PaymentMethod.CASH);
  const [po, setPo] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    apiClient
      .get('/shops/my')
      .then((response) => {
        const value = response.data.data[0];
        setShop(value);
        setAddressId(
          value?.deliveryAddresses?.find((address: { isDefault: boolean }) => address.isDefault)
            ?._id ??
            value?.deliveryAddresses?.[0]?._id ??
            '',
        );
      })
      .catch(() => setError('Unable to load your shop addresses.'));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const body = {
        items: items.map((item) => ({
          medicineId: item.medicine._id,
          requestedQuantity: item.quantity,
          shopNotes: item.notes,
        })),
        deliveryAddressId: addressId,
        requestedPaymentMethod: payment,
        purchaseOrderReference: po || undefined,
        shopNotes: notes || undefined,
        idempotencyKey: crypto.randomUUID(),
      };
      const url = draftId ? `/orders/drafts/${draftId}/submit` : '/orders/submit';
      const response = await apiClient.post(url, body);
      clear();
      navigate(`/orders/${response.data.data._id}?submitted=1`);
    } catch (caught: unknown) {
      setError(
        (caught as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Order submission failed',
      );
    } finally {
      setSubmitting(false);
    }
  }
  if (!items.length)
    return (
      <main className="inventory-page">
        <section className="state">Your cart is empty.</section>
      </main>
    );
  return (
    <main className="inventory-page narrow">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Ordering</p>
          <h1>Checkout</h1>
          <p>The server will validate current prices, limits and availability.</p>
        </div>
      </header>
      <form className="panel data-form" onSubmit={submit}>
        {error && (
          <div className="state error" role="alert">
            {error}
          </div>
        )}
        <label>
          Delivery address
          <select required value={addressId} onChange={(event) => setAddressId(event.target.value)}>
            <option value="">Select an address</option>
            {shop?.deliveryAddresses.map((address) => (
              <option
                key={(address as typeof address & { _id: string })._id}
                value={(address as typeof address & { _id: string })._id}
              >
                {address.label}: {address.line1}, {address.city}
              </option>
            ))}
          </select>
        </label>
        <label>
          Requested payment method
          <select
            value={payment}
            onChange={(event) => setPayment(event.target.value as typeof payment)}
          >
            {/* `value` is not optional here. Without it an option submits its
                own text, so choosing mobile money sent the literal string
                "MOBILE FINANCIAL SERVICE" instead of MOBILE_FINANCIAL_SERVICE.
                Only the four single-word methods round-tripped correctly. */}
            {Object.values(PaymentMethod).map((value) => (
              <option key={value} value={value}>
                {value.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Purchase-order reference
          <input value={po} onChange={(event) => setPo(event.target.value)} />
        </label>
        <label>
          Delivery notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <button className="primary-button" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit order request'}
        </button>
      </form>
    </main>
  );
}
