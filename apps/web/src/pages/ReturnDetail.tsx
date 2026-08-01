import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActivityEntityType, RealtimeEvent, ReturnStatus, UserRole } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { useAuthStore } from '../store/useAuth';
import { useRealtimeEvent } from '../realtime/useRealtime';
import {
  createActionKey,
  formatFinanceDate,
  formatFinanceDateTime,
  formatMinor,
} from '../lib/finance';
import { statusLabel } from './returnLabels';
import './inventory.css';

interface DetailLine {
  medicineId: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  invoicedQuantity: number;
  requestedQuantity: number;
  approvedQuantity: number;
  receivedQuantity: number;
  restockQuantity: number;
  damagedQuantity: number;
  expiredQuantity: number;
  quarantinedQuantity: number;
  unitPriceMinor: number;
  refundMinor: number;
  reason: string;
  notes?: string;
  medicineSnapshot: { brandName: string; genericName: string; strength: string; packSize: string };
}

interface ReturnDetailData {
  _id: string;
  reference: string;
  status: ReturnStatus;
  primaryReason: string;
  shopNotes?: string;
  internalNotes?: string;
  reviewNotes?: string;
  rejectionReason?: string;
  lines: DetailLine[];
  requestedTotalMinor: number;
  approvedSubtotalMinor: number;
  approvedTaxMinor: number;
  approvedTotalMinor: number;
  creditNoteReference?: string;
  requestedAt: string;
  reviewedAt?: string;
  collectedAt?: string;
  receivedAt?: string;
  completedAt?: string;
  version: number;
  shopId?: { _id: string; reference: string; name: string };
  invoiceId?: { _id: string; reference: string; grandTotalMinor: number };
  orderId?: { _id: string; reference: string; status: string };
  requestedBy?: { firstName: string; lastName: string };
  creditNote?: { _id: string; reference: string; totalMinor: number; issuedAt: string };
}

type DecisionDraft = Record<string, string>;
type ReceiptDraft = Record<
  string,
  { restock: string; damaged: string; expired: string; quarantined: string }
>;

const lineId = (line: DetailLine) => `${line.medicineId}:${line.batchId}`;
const number = (value: string) => Math.max(0, Math.trunc(Number(value) || 0));

const MANAGEMENT: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];

export function ReturnDetail() {
  const { id = '' } = useParams();
  const role = useAuthStore((state) => state.user?.role);
  const [record, setRecord] = useState<ReturnDetailData | null>(null);
  const [decision, setDecision] = useState<DecisionDraft>({});
  const [receipt, setReceipt] = useState<ReceiptDraft>({});
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/returns/${id}`);
      const data = response.data.data as ReturnDetailData;
      setRecord(data);
      setDecision(
        Object.fromEntries(
          data.lines.map((line) => [
            lineId(line),
            String(line.approvedQuantity || line.requestedQuantity),
          ]),
        ),
      );
      setReceipt(
        Object.fromEntries(
          data.lines.map((line) => [
            lineId(line),
            {
              restock: String(
                line.restockQuantity || (line.receivedQuantity ? 0 : line.approvedQuantity),
              ),
              damaged: String(line.damagedQuantity || 0),
              expired: String(line.expiredQuantity || 0),
              quarantined: String(line.quarantinedQuantity || 0),
            },
          ]),
        ),
      );
      setError('');
    } catch (caught) {
      const failure = caught as { response?: { status?: number } };
      setError(
        failure.response?.status === 403
          ? 'You do not have access to this return.'
          : failure.response?.status === 404
            ? 'This return no longer exists.'
            : 'Unable to load this return.',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeEvent<{ entityId?: string }>(RealtimeEvent.RETURN_UPDATED, (payload) => {
    if (!payload?.entityId || payload.entityId === id) void load();
  });

  async function act(action: string, body: Record<string, unknown>, successMessage: string) {
    if (!record) return;
    setBusy(action);
    setStatus('');
    try {
      await apiClient.post(`/returns/${record._id}/${action}`, {
        version: record.version,
        idempotencyKey: createActionKey(`return-${action}`),
        ...body,
      });
      setStatus(successMessage);
      setError('');
      await load();
    } catch (caught) {
      const failure = caught as {
        response?: { data?: { error?: { message?: string; code?: string } } };
      };
      const code = failure.response?.data?.error?.code;
      // Reload first: `load` clears the error on success, so setting the
      // message afterwards is what keeps the explanation on screen.
      if (code === 'STALE_RETURN') await load();
      setError(
        code === 'STALE_RETURN'
          ? 'Someone else updated this return. The latest version has been reloaded.'
          : (failure.response?.data?.error?.message ?? 'That action could not be completed.'),
      );
    } finally {
      setBusy('');
    }
  }

  if (loading)
    return (
      <main className="inventory-page">
        <section className="state">Loading return...</section>
      </main>
    );
  if (!record) {
    return (
      <main className="inventory-page">
        <section className="state error" role="alert">
          {error || 'This return could not be loaded.'}
          <button onClick={() => void load()}>Retry</button>
        </section>
      </main>
    );
  }

  const isManagement = role ? MANAGEMENT.includes(role) : false;
  const isStorekeeper = role === UserRole.STOREKEEPER;
  const isDeliveryPerson = role === UserRole.DELIVERY_PERSON;
  const isOwner = role === UserRole.SHOP_OWNER;
  const canReview =
    isManagement &&
    (record.status === ReturnStatus.REQUESTED || record.status === ReturnStatus.UNDER_REVIEW);
  const approved =
    record.status === ReturnStatus.APPROVED || record.status === ReturnStatus.PARTIALLY_APPROVED;
  const canCollect = (isManagement || isDeliveryPerson) && approved;
  const canReceive =
    (isManagement || isStorekeeper) && (approved || record.status === ReturnStatus.COLLECTED);
  const canCredit = isManagement && record.status === ReturnStatus.RECEIVED;
  const cancellable: ReturnStatus[] = [
    ReturnStatus.REQUESTED,
    ReturnStatus.UNDER_REVIEW,
    ReturnStatus.APPROVED,
    ReturnStatus.PARTIALLY_APPROVED,
  ];
  const canCancel = (isManagement || isOwner) && cancellable.includes(record.status);

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Return {record.reference}</p>
          <h1>
            <span className={`return-status ${record.status.toLowerCase()}`}>
              {statusLabel(record.status)}
            </span>
          </h1>
          <p>
            Requested {formatFinanceDateTime(record.requestedAt)}
            {record.requestedBy
              ? ` by ${record.requestedBy.firstName} ${record.requestedBy.lastName}`
              : ''}
            .
          </p>
        </div>
        <Link className="secondary-button" to="/returns">
          All returns
        </Link>
      </header>

      {error ? (
        <section className="state error" role="alert">
          {error}
        </section>
      ) : null}
      {status ? (
        <section className="state success" role="status">
          {status}
        </section>
      ) : null}

      <section className="metric-grid finance-metrics">
        <article>
          <span>Requested value</span>
          <strong>{formatMinor(record.requestedTotalMinor)}</strong>
        </article>
        <article>
          <span>Credit subtotal</span>
          <strong>{formatMinor(record.approvedSubtotalMinor)}</strong>
        </article>
        <article>
          <span>Credit tax</span>
          <strong>{formatMinor(record.approvedTaxMinor)}</strong>
        </article>
        <article>
          <span>Credit total</span>
          <strong>{formatMinor(record.approvedTotalMinor)}</strong>
        </article>
      </section>

      <section className="panel detail-grid">
        <div>
          <h2>Reference</h2>
          <p>
            Invoice:{' '}
            {record.invoiceId ? (
              <Link to={`/orders/${record.orderId?._id ?? ''}`}>{record.invoiceId.reference}</Link>
            ) : (
              '—'
            )}
          </p>
          <p>Order: {record.orderId?.reference ?? '—'}</p>
          {isOwner ? null : (
            <p>
              Shop: {record.shopId?.name ?? '—'} <small>{record.shopId?.reference}</small>
            </p>
          )}
          <p>Main reason: {record.primaryReason.replaceAll('_', ' ').toLowerCase()}</p>
        </div>
        <div>
          <h2>Progress</h2>
          <p>
            Reviewed: {record.reviewedAt ? formatFinanceDateTime(record.reviewedAt) : 'Not yet'}
          </p>
          <p>
            Collected: {record.collectedAt ? formatFinanceDateTime(record.collectedAt) : 'Not yet'}
          </p>
          <p>
            Received: {record.receivedAt ? formatFinanceDateTime(record.receivedAt) : 'Not yet'}
          </p>
          <p>
            Credit note:{' '}
            {record.creditNote ? (
              <a
                href={`/api/v1/returns/credit-notes/${record.creditNote._id}?format=pdf`}
                target="_blank"
                rel="noreferrer"
              >
                {record.creditNote.reference}
              </a>
            ) : (
              'Not issued'
            )}
          </p>
        </div>
      </section>

      {record.shopNotes ? (
        <section className="panel">
          <h2>Customer notes</h2>
          <p>{record.shopNotes}</p>
        </section>
      ) : null}
      {record.rejectionReason ? (
        <section className="panel">
          <h2>Rejection reason</h2>
          <p>{record.rejectionReason}</p>
        </section>
      ) : null}
      {record.internalNotes && !isOwner ? (
        <section className="panel">
          <h2>Internal notes</h2>
          <p>{record.internalNotes}</p>
        </section>
      ) : null}

      <section className="panel">
        <h2>Returned items</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Batch</th>
                <th>Invoiced</th>
                <th>Requested</th>
                <th>Approved</th>
                <th>Received</th>
                <th>Disposition</th>
                <th>Credit</th>
              </tr>
            </thead>
            <tbody>
              {record.lines.map((line) => (
                <tr key={lineId(line)}>
                  <td>
                    {line.medicineSnapshot.brandName}
                    <small>
                      {line.medicineSnapshot.strength} ·{' '}
                      {line.reason.replaceAll('_', ' ').toLowerCase()}
                    </small>
                  </td>
                  <td>
                    {line.batchNumber}
                    <small>Expires {formatFinanceDate(line.expiryDate)}</small>
                  </td>
                  <td>{line.invoicedQuantity}</td>
                  <td>{line.requestedQuantity}</td>
                  <td>{line.approvedQuantity}</td>
                  <td>{line.receivedQuantity}</td>
                  <td>
                    {line.receivedQuantity
                      ? [
                          line.restockQuantity ? `${line.restockQuantity} restocked` : '',
                          line.damagedQuantity ? `${line.damagedQuantity} damaged` : '',
                          line.expiredQuantity ? `${line.expiredQuantity} expired` : '',
                          line.quarantinedQuantity ? `${line.quarantinedQuantity} quarantined` : '',
                        ]
                          .filter(Boolean)
                          .join(', ')
                      : '—'}
                  </td>
                  <td>
                    <strong>{formatMinor(line.refundMinor)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canReview ? (
        <section className="panel">
          <h2>Review decision</h2>
          <p className="muted">
            Approve the quantities you accept. Approving nothing records the return as rejected.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Requested</th>
                  <th>Approve</th>
                </tr>
              </thead>
              <tbody>
                {record.lines.map((line) => (
                  <tr key={`decide-${lineId(line)}`}>
                    <td>{line.medicineSnapshot.brandName}</td>
                    <td>{line.requestedQuantity}</td>
                    <td>
                      <input
                        aria-label={`Approved quantity for ${line.medicineSnapshot.brandName}`}
                        type="number"
                        min={0}
                        max={line.requestedQuantity}
                        value={decision[lineId(line)] ?? ''}
                        onChange={(event) =>
                          setDecision((current) => ({
                            ...current,
                            [lineId(line)]: event.target.value,
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label>
            Review notes
            <textarea
              rows={2}
              maxLength={1000}
              value={reviewNotes}
              onChange={(event) => setReviewNotes(event.target.value)}
            />
          </label>
          <div className="actions">
            {record.status === ReturnStatus.REQUESTED ? (
              <button
                className="secondary-button"
                disabled={Boolean(busy)}
                onClick={() => void act('review', {}, 'Return claimed for review.')}
              >
                {busy === 'review' ? 'Claiming...' : 'Start review'}
              </button>
            ) : null}
            <button
              className="primary-button"
              disabled={Boolean(busy)}
              onClick={() =>
                void act(
                  'decision',
                  {
                    reviewNotes: reviewNotes.trim() || undefined,
                    lines: record.lines.map((line) => ({
                      medicineId: line.medicineId,
                      batchId: line.batchId,
                      approvedQuantity: Math.min(
                        line.requestedQuantity,
                        number(decision[lineId(line)] ?? '0'),
                      ),
                    })),
                  },
                  'Review decision recorded.',
                )
              }
            >
              {busy === 'decision' ? 'Saving...' : 'Save decision'}
            </button>
            <button
              className="danger-button"
              disabled={Boolean(busy) || rejectionReason.trim().length < 5}
              onClick={() =>
                void act('reject', { rejectionReason: rejectionReason.trim() }, 'Return rejected.')
              }
            >
              {busy === 'reject' ? 'Rejecting...' : 'Reject return'}
            </button>
            <input
              aria-label="Rejection reason"
              placeholder="Reason for rejection"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
            />
          </div>
        </section>
      ) : null}

      {canReceive ? (
        <section className="panel">
          <h2>Receive and inspect</h2>
          <p className="muted">
            Record where each unit goes. Only restocked units return to saleable stock; an expired
            batch cannot be restocked.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Approved</th>
                  <th>Restock</th>
                  <th>Damaged</th>
                  <th>Expired</th>
                  <th>Quarantine</th>
                </tr>
              </thead>
              <tbody>
                {record.lines
                  .filter((line) => line.approvedQuantity > 0)
                  .map((line) => {
                    const key = lineId(line);
                    const entry = receipt[key] ?? {
                      restock: '0',
                      damaged: '0',
                      expired: '0',
                      quarantined: '0',
                    };
                    const total =
                      number(entry.restock) +
                      number(entry.damaged) +
                      number(entry.expired) +
                      number(entry.quarantined);
                    return (
                      <tr key={`receive-${key}`}>
                        <td>
                          {line.medicineSnapshot.brandName}
                          <small>Batch {line.batchNumber}</small>
                        </td>
                        <td className={total > line.approvedQuantity ? 'over-limit' : ''}>
                          {total} / {line.approvedQuantity}
                        </td>
                        {(['restock', 'damaged', 'expired', 'quarantined'] as const).map(
                          (field) => (
                            <td key={field}>
                              <input
                                aria-label={`${field} quantity for ${line.medicineSnapshot.brandName}`}
                                type="number"
                                min={0}
                                max={line.approvedQuantity}
                                value={entry[field]}
                                onChange={(event) =>
                                  setReceipt((current) => ({
                                    ...current,
                                    [key]: { ...entry, [field]: event.target.value },
                                  }))
                                }
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button
              className="primary-button"
              disabled={Boolean(busy)}
              onClick={() =>
                void act(
                  'receive',
                  {
                    lines: record.lines
                      .filter((line) => line.approvedQuantity > 0)
                      .map((line) => {
                        const entry = receipt[lineId(line)] ?? {
                          restock: '0',
                          damaged: '0',
                          expired: '0',
                          quarantined: '0',
                        };
                        return {
                          medicineId: line.medicineId,
                          batchId: line.batchId,
                          restockQuantity: number(entry.restock),
                          damagedQuantity: number(entry.damaged),
                          expiredQuantity: number(entry.expired),
                          quarantinedQuantity: number(entry.quarantined),
                        };
                      }),
                  },
                  'Goods received and stock updated.',
                )
              }
            >
              {busy === 'receive' ? 'Booking in...' : 'Confirm receipt'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Actions</h2>
        <div className="actions">
          {canCollect ? (
            <button
              className="secondary-button"
              disabled={Boolean(busy)}
              onClick={() => void act('collect', {}, 'Marked as collected from the shop.')}
            >
              {busy === 'collect' ? 'Saving...' : 'Mark collected'}
            </button>
          ) : null}
          {canCredit ? (
            <button
              className="primary-button"
              disabled={Boolean(busy)}
              onClick={() => {
                if (
                  window.confirm(
                    `Issue a credit note for ${formatMinor(record.approvedTotalMinor)}? This posts to the customer ledger and cannot be edited afterwards.`,
                  )
                ) {
                  void act('credit-note', {}, 'Credit note issued and posted to the ledger.');
                }
              }}
            >
              {busy === 'credit-note' ? 'Issuing...' : 'Issue credit note'}
            </button>
          ) : null}
          {canCancel ? (
            <button
              className="danger-button"
              disabled={Boolean(busy)}
              onClick={() => {
                const reason = window.prompt('Why is this return being cancelled?');
                if (reason && reason.trim().length >= 5) {
                  void act('cancel', { reason: reason.trim() }, 'Return cancelled.');
                }
              }}
            >
              {busy === 'cancel' ? 'Cancelling...' : 'Cancel return'}
            </button>
          ) : null}
          {!canCollect && !canCredit && !canCancel && !canReview && !canReceive ? (
            <p className="muted">No further action is available to your role at this stage.</p>
          ) : null}
        </div>
      </section>

      <ActivityTimeline entityType={ActivityEntityType.RETURN} entityId={record._id} />
    </main>
  );
}
