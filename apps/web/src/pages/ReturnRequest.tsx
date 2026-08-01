import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ReturnReason } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { createActionKey, formatFinanceDate, formatMinor } from '../lib/finance';
import { RETURN_REASONS } from './returnLabels';
import './inventory.css';

interface InvoiceOption {
  _id: string;
  reference: string;
  invoiceDate: string;
  grandTotalMinor: number;
}

interface InvoiceLine {
  medicineId: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  medicineSnapshot: { brandName: string; genericName: string; strength: string; packSize: string };
}

type Draft = Record<string, { quantity: string; reason: ReturnReason; notes: string }>;

const lineId = (line: InvoiceLine) => `${line.medicineId}:${line.batchId}`;

export function ReturnRequest() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [invoiceId, setInvoiceId] = useState(params.get('invoiceId') ?? '');
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [primaryReason, setPrimaryReason] = useState<ReturnReason>(ReturnReason.DAMAGED_IN_TRANSIT);
  const [shopNotes, setShopNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingLines, setLoadingLines] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/finance/my/invoices', { params: { limit: 50 } });
      setInvoices(response.data.data as InvoiceOption[]);
      setError('');
    } catch (caught) {
      const failure = caught as { response?: { status?: number } };
      setError(
        failure.response?.status === 403
          ? 'Your role cannot request returns.'
          : 'Unable to load your invoices.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    if (!invoiceId) {
      setLines([]);
      setDraft({});
      return;
    }
    let cancelled = false;
    setLoadingLines(true);
    apiClient
      .get(`/fulfilment/invoices/${invoiceId}`)
      .then((response) => {
        if (cancelled) return;
        const items = (response.data.data?.items ?? []) as InvoiceLine[];
        setLines(items);
        setDraft(
          Object.fromEntries(
            items.map((line) => [lineId(line), { quantity: '', reason: primaryReason, notes: '' }]),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load the items on that invoice.');
      })
      .finally(() => {
        if (!cancelled) setLoadingLines(false);
      });
    return () => {
      cancelled = true;
    };
    // `primaryReason` only seeds new rows; re-running on every change would
    // silently overwrite per-line reasons the customer already chose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  const selected = useMemo(
    () =>
      lines
        .map((line) => ({ line, entry: draft[lineId(line)] }))
        .filter(({ entry }) => Number(entry?.quantity) > 0),
    [lines, draft],
  );

  const estimateMinor = selected.reduce(
    (sum, { line, entry }) =>
      sum + Math.round((line.lineTotalMinor * Number(entry.quantity)) / line.quantity),
    0,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected.length) {
      setError('Enter a quantity for at least one item.');
      return;
    }
    const overLimit = selected.find(({ line, entry }) => Number(entry.quantity) > line.quantity);
    if (overLimit) {
      setError(
        `You can return at most ${overLimit.line.quantity} of ${overLimit.line.medicineSnapshot.brandName}.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiClient.post('/returns', {
        invoiceId,
        primaryReason,
        shopNotes: shopNotes.trim() || undefined,
        lines: selected.map(({ line, entry }) => ({
          medicineId: line.medicineId,
          batchId: line.batchId,
          quantity: Number(entry.quantity),
          reason: entry.reason,
          notes: entry.notes.trim() || undefined,
        })),
        idempotencyKey: createActionKey('return-request'),
      });
      navigate(`/returns/${response.data.data._id}`);
    } catch (caught) {
      const failure = caught as { response?: { data?: { error?: { message?: string } } } };
      setError(failure.response?.data?.error?.message ?? 'Unable to submit this return request.');
      setSubmitting(false);
    }
  }

  return (
    <main className="inventory-page narrow">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Returns</p>
          <h1>Request a return</h1>
          <p>Choose a delivered invoice, then the items and quantities you need to send back.</p>
        </div>
      </header>

      {error ? (
        <section className="state error" role="alert">
          {error}
        </section>
      ) : null}

      {loading ? (
        <section className="state">Loading your invoices...</section>
      ) : invoices.length === 0 ? (
        <section className="state">
          You have no issued invoices yet, so there is nothing to return.
        </section>
      ) : (
        <form className="panel data-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Invoice
              <select
                required
                value={invoiceId}
                onChange={(event) => setInvoiceId(event.target.value)}
              >
                <option value="">Select an invoice</option>
                {invoices.map((invoice) => (
                  <option key={invoice._id} value={invoice._id}>
                    {invoice.reference} — {formatFinanceDate(invoice.invoiceDate)} —{' '}
                    {formatMinor(invoice.grandTotalMinor)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Main reason
              <select
                value={primaryReason}
                onChange={(event) => setPrimaryReason(event.target.value as ReturnReason)}
              >
                {RETURN_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loadingLines ? (
            <p className="state">Loading invoice items...</p>
          ) : lines.length === 0 ? (
            invoiceId ? (
              <p className="state">That invoice has no returnable items.</p>
            ) : null
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Batch</th>
                    <th>Invoiced</th>
                    <th>Return quantity</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const key = lineId(line);
                    const entry = draft[key] ?? {
                      quantity: '',
                      reason: primaryReason,
                      notes: '',
                    };
                    return (
                      <tr key={key}>
                        <td>
                          {line.medicineSnapshot.brandName}
                          <small>
                            {line.medicineSnapshot.strength} · {line.medicineSnapshot.packSize}
                          </small>
                        </td>
                        <td>
                          {line.batchNumber}
                          <small>Expires {formatFinanceDate(line.expiryDate)}</small>
                        </td>
                        <td>{line.quantity}</td>
                        <td>
                          <input
                            aria-label={`Return quantity for ${line.medicineSnapshot.brandName}`}
                            type="number"
                            min={0}
                            max={line.quantity}
                            value={entry.quantity}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [key]: { ...entry, quantity: event.target.value },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`Return reason for ${line.medicineSnapshot.brandName}`}
                            value={entry.reason}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [key]: { ...entry, reason: event.target.value as ReturnReason },
                              }))
                            }
                          >
                            {RETURN_REASONS.map((reason) => (
                              <option key={reason.value} value={reason.value}>
                                {reason.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <label>
            Notes for the supplier
            <textarea
              rows={3}
              maxLength={1000}
              value={shopNotes}
              onChange={(event) => setShopNotes(event.target.value)}
            />
          </label>

          <p className="muted">
            Estimated credit if fully approved: <strong>{formatMinor(estimateMinor)}</strong>. The
            final credit is calculated from the goods actually received and inspected.
          </p>

          <div className="actions">
            <button className="primary-button" disabled={submitting || !selected.length}>
              {submitting ? 'Submitting...' : 'Submit return request'}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
