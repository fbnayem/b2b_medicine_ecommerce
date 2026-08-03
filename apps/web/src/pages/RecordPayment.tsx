import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { createActionKey, formatMinor, parseMajorToMinor } from '../lib/finance';
import {
  financePaymentMethods,
  invoiceDue,
  type ApiFailure,
  type FinanceInvoiceSummary,
  type FinancePayment,
  type FinancePaymentMethod,
  type FinanceShopSummary,
} from './financeTypes';
import './inventory.css';
import { toDateTimeInputValue, toMoneyInputValue } from '@medsupply/utilities';

interface AttachmentPayload {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

const acceptedPaymentFiles = ['image/jpeg', 'image/png', 'application/pdf'];
const nowInDhaka = () => toDateTimeInputValue(new Date());

async function attachmentPayload(file: File): Promise<AttachmentPayload> {
  if (!acceptedPaymentFiles.includes(file.type)) {
    throw new Error('Payment proof must be a JPEG, PNG, or PDF.');
  }
  if (file.size < 1 || file.size > 2_000_000) {
    throw new Error('Payment proof must be smaller than 2 MB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return { fileName: file.name, mimeType: file.type, base64Data: btoa(binary) };
}

export function RecordPayment() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [shops, setShops] = useState<FinanceShopSummary[]>([]);
  const [invoices, setInvoices] = useState<FinanceInvoiceSummary[]>([]);
  const [shopId, setShopId] = useState(searchParams.get('shopId') ?? '');
  const [invoiceId, setInvoiceId] = useState(searchParams.get('invoiceId') ?? '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<FinancePaymentMethod>('CASH');
  const [transactionReference, setTransactionReference] = useState('');
  const [collectionTime, setCollectionTime] = useState(nowInDhaka);
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File>();
  const [postImmediately, setPostImmediately] = useState(true);
  const [allowAdvance, setAllowAdvance] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<FinancePayment>();
  const idempotencyKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    apiClient
      .get('/shops', { params: { status: 'ACTIVE', limit: 100 } })
      .then((response) => {
        if (active) setShops(response.data.data as FinanceShopSummary[]);
      })
      .catch(() => {
        if (active) setError('Unable to load active shops.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!shopId) {
      setInvoices([]);
      return;
    }
    let active = true;
    setLoadingInvoices(true);
    apiClient
      .get(`/finance/shops/${shopId}/invoices`, { params: { status: 'OPEN' } })
      .then((response) => {
        if (!active) return;
        setInvoices(response.data.data as FinanceInvoiceSummary[]);
      })
      .catch(() => {
        if (active) setError('Unable to load this shop’s invoices.');
      })
      .finally(() => {
        if (active) setLoadingInvoices(false);
      });
    return () => {
      active = false;
    };
  }, [shopId]);

  function changed() {
    idempotencyKey.current = undefined;
    setCreated(undefined);
    setError('');
  }

  function chooseShop(value: string) {
    changed();
    setShopId(value);
    setInvoiceId('');
  }

  function chooseInvoice(value: string) {
    changed();
    setInvoiceId(value);
    const invoice = invoices.find((candidate) => candidate._id === value);
    if (invoice) setAmount(toMoneyInputValue(invoiceDue(invoice)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || created) return;
    setError('');
    let amountMinor: number;
    try {
      amountMinor = parseMajorToMinor(amount);
      if (amountMinor <= 0) throw new Error('Payment amount must be greater than zero.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Enter a valid payment amount.');
      return;
    }

    setSubmitting(true);
    idempotencyKey.current ??= createActionKey('record-payment');
    try {
      const attachment = file ? await attachmentPayload(file) : undefined;
      const response = await apiClient.post('/payments', {
        shopId,
        invoiceId: invoiceId || undefined,
        amountMinor,
        method,
        transactionReference: transactionReference.trim() || undefined,
        collectedAt: new Date(`${collectionTime}:00+06:00`).toISOString(),
        notes: notes.trim() || undefined,
        attachment,
        allowAdvance,
        idempotencyKey: idempotencyKey.current,
      });
      const payment = response.data.data as FinancePayment;
      setCreated(payment);
      if (postImmediately && payment.status === 'PENDING') {
        try {
          await apiClient.post(`/payments/${payment._id}/post`, {
            idempotencyKey: createActionKey('post-payment'),
            allowAdvance,
          });
        } catch {
          setError(
            'Payment was saved as pending, but could not be posted. Open it to retry safely.',
          );
          return;
        }
      }
      navigate(`/payments/${payment._id}?recorded=1`);
    } catch (caught) {
      const failure = caught as ApiFailure;
      const message = failure.response?.data?.error?.message;
      setError(message ?? (caught instanceof Error ? caught.message : 'Unable to record payment.'));
      if (failure.response?.status && failure.response.status < 500)
        idempotencyKey.current = undefined;
    } finally {
      setSubmitting(false);
    }
  }

  if (loading)
    return (
      <main className="inventory-page">
        <section className="state">Loading payment form...</section>
      </main>
    );

  return (
    <main className="inventory-page narrow">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Finance</p>
          <h1>Record payment</h1>
          <p>Amounts are posted in integer poisha with duplicate protection.</p>
        </div>
        <Link className="secondary-button" to="/payments">
          Payments
        </Link>
      </header>
      {error ? (
        <section className="state error" role="alert">
          {error}
          {created ? (
            <Link className="secondary-button" to={`/payments/${created._id}`}>
              Open pending payment
            </Link>
          ) : null}
        </section>
      ) : null}
      <form className="panel data-form" onSubmit={(event) => void submit(event)}>
        <label>
          Shop
          <select required value={shopId} onChange={(event) => chooseShop(event.target.value)}>
            <option value="">Select an active shop</option>
            {shops.map((shop) => (
              <option key={shop._id} value={shop._id}>
                {shop.reference} · {shop.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Invoice allocation (optional for advance)
          <select
            value={invoiceId}
            disabled={!shopId || loadingInvoices}
            onChange={(event) => chooseInvoice(event.target.value)}
          >
            <option value="">
              {loadingInvoices ? 'Loading invoices...' : 'Unallocated / advance balance'}
            </option>
            {invoices.map((invoice) => (
              <option key={invoice._id} value={invoice._id}>
                {invoice.reference} · due {formatMinor(invoiceDue(invoice))}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Amount (৳)
            <input
              required
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => {
                changed();
                setAmount(event.target.value);
              }}
            />
          </label>
          <label>
            Method
            <select
              value={method}
              onChange={(event) => {
                changed();
                setMethod(event.target.value as FinancePaymentMethod);
              }}
            >
              {financePaymentMethods
                .filter((value) => value !== 'CREDIT')
                .map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll('_', ' ')}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Collection time
            <input
              required
              type="datetime-local"
              value={collectionTime}
              onChange={(event) => {
                changed();
                setCollectionTime(event.target.value);
              }}
            />
          </label>
          <label>
            Transaction reference
            <input
              value={transactionReference}
              maxLength={120}
              onChange={(event) => {
                changed();
                setTransactionReference(event.target.value);
              }}
            />
          </label>
        </div>
        <label>
          Payment proof (JPEG, PNG or PDF; max 2 MB)
          <input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(event) => {
              changed();
              setFile(event.target.files?.[0]);
            }}
          />
        </label>
        <label>
          Notes
          <textarea
            value={notes}
            maxLength={1000}
            onChange={(event) => {
              changed();
              setNotes(event.target.value);
            }}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={postImmediately}
            onChange={(event) => {
              changed();
              setPostImmediately(event.target.checked);
            }}
          />
          Post immediately after recording
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allowAdvance}
            onChange={(event) => {
              changed();
              setAllowAdvance(event.target.checked);
            }}
          />
          Allow any explicit excess or unallocated amount to become customer advance
        </label>
        <button className="primary-button" disabled={submitting || Boolean(created)}>
          {submitting ? 'Recording...' : 'Record payment'}
        </button>
      </form>
    </main>
  );
}
