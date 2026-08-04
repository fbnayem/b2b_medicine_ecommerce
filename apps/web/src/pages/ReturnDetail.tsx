import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ActivityEntityType, RealtimeEvent, ReturnStatus, UserRole } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { useAuthStore } from '../store/useAuth';
import { useRealtimeEvent } from '../realtime/useRealtime';
import {
  Button,
  Card,
  DataTable,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Resource,
  StatusPill,
  Textarea,
  requireReason,
  toast,
  useAsk,
  type Column,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import {
  createActionKey,
  formatFinanceDate,
  formatFinanceDateTime,
  formatMinor,
} from '../lib/finance';

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

type ReceiptEntry = { restock: string; damaged: string; expired: string; quarantined: string };

const lineId = (line: DetailLine) => `${line.medicineId}:${line.batchId}`;
const number = (value: string) => Math.max(0, Math.trunc(Number(value) || 0));
const MANAGEMENT: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
const EMPTY_RECEIPT: ReceiptEntry = { restock: '0', damaged: '0', expired: '0', quarantined: '0' };

/** A figure with its name above it, used for the four credit totals. */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-sm text-text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-text">{value}</p>
    </Card>
  );
}

export function ReturnDetail() {
  const ask = useAsk();
  const { id = '' } = useParams();
  const { t, language } = useLanguage();
  const role = useAuthStore((state) => state.user?.role);
  const queryClient = useQueryClient();

  const query = useApiResource<ReturnDetailData>(['return', id], `/returns/${id}`);
  const record = query.data;

  const [decision, setDecision] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<Record<string, ReceiptEntry>>({});
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [busy, setBusy] = useState('');

  // The editable quantities are seeded from the server's answer and then owned
  // locally, so a background revalidation cannot overwrite figures a reviewer
  // is halfway through typing.
  useEffect(() => {
    if (!record) return;
    setDecision(
      Object.fromEntries(
        record.lines.map((line) => [
          lineId(line),
          String(line.approvedQuantity || line.requestedQuantity),
        ]),
      ),
    );
    setReceipt(
      Object.fromEntries(
        record.lines.map((line) => [
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
  }, [record]);

  useRealtimeEvent<{ entityId?: string }>(RealtimeEvent.RETURN_UPDATED, (payload) => {
    if (!payload?.entityId || payload.entityId === id) {
      void queryClient.invalidateQueries({ queryKey: ['return', id] });
    }
  });

  async function act(action: string, body: Record<string, unknown>, done: string) {
    if (!record) return;
    setBusy(action);
    try {
      await apiClient.post(`/returns/${record._id}/${action}`, {
        version: record.version,
        idempotencyKey: createActionKey(`return-${action}`),
        ...body,
      });
      await queryClient.invalidateQueries({ queryKey: ['return', id] });
      toast.success(done);
    } catch (caught) {
      // A stale version means somebody else moved it on. Reload before saying
      // so, or the reviewer reads the complaint against figures that are
      // already out of date.
      await queryClient.invalidateQueries({ queryKey: ['return', id] });
      toast.error(errorMessage(caught, language, t('returnDetail.actionFailed')));
    } finally {
      setBusy('');
    }
  }

  const itemColumns: ReadonlyArray<Column<DetailLine>> = [
    {
      key: 'item',
      header: t('returns.columnItem'),
      cell: (line) => (
        <div>
          <p className="font-medium text-text">{line.medicineSnapshot.brandName}</p>
          <p className="text-sm text-text-muted">
            {line.medicineSnapshot.strength} · {t(`returnReason.${line.reason}`)}
          </p>
        </div>
      ),
    },
    {
      key: 'batch',
      header: t('fields.batch'),
      cell: (line) => (
        <div>
          <p className="text-text">{line.batchNumber}</p>
          <p className="text-sm text-text-muted">
            {t('returns.expires', { date: formatFinanceDate(line.expiryDate) })}
          </p>
        </div>
      ),
    },
    {
      key: 'invoiced',
      header: t('returnDetail.columnInvoiced'),
      numeric: true,
      cell: (line) => line.invoicedQuantity,
    },
    {
      key: 'requested',
      header: t('returnDetail.columnRequested'),
      numeric: true,
      cell: (line) => line.requestedQuantity,
    },
    {
      key: 'approved',
      header: t('returnDetail.columnApproved'),
      numeric: true,
      cell: (line) => line.approvedQuantity,
    },
    {
      key: 'received',
      header: t('returnDetail.columnReceived'),
      numeric: true,
      cell: (line) => line.receivedQuantity,
    },
    {
      key: 'disposition',
      header: t('returnDetail.columnDisposition'),
      cell: (line) =>
        line.receivedQuantity
          ? [
              line.restockQuantity && t('returnDetail.restocked', { count: line.restockQuantity }),
              line.damagedQuantity && t('returnDetail.damaged', { count: line.damagedQuantity }),
              line.expiredQuantity &&
                t('returnDetail.expiredUnits', { count: line.expiredQuantity }),
              line.quarantinedQuantity &&
                t('returnDetail.quarantined', { count: line.quarantinedQuantity }),
            ]
              .filter(Boolean)
              .join(', ')
          : '—',
    },
    {
      key: 'credit',
      header: t('returnDetail.columnCredit'),
      numeric: true,
      cell: (line) => <strong>{formatMinor(line.refundMinor)}</strong>,
    },
  ];

  return (
    <main>
      <Resource
        query={query}
        loadingLabel={t('returnDetail.loading')}
        errorMessageFallback={t('returnDetail.couldNotLoad')}
      >
        {(data) => {
          const isManagement = role ? MANAGEMENT.includes(role) : false;
          const isOwner = role === UserRole.SHOP_OWNER;
          const approved =
            data.status === ReturnStatus.APPROVED ||
            data.status === ReturnStatus.PARTIALLY_APPROVED;
          const canReview =
            isManagement &&
            (data.status === ReturnStatus.REQUESTED || data.status === ReturnStatus.UNDER_REVIEW);
          const canCollect = (isManagement || role === UserRole.DELIVERY_PERSON) && approved;
          const canReceive =
            (isManagement || role === UserRole.STOREKEEPER) &&
            (approved || data.status === ReturnStatus.COLLECTED);
          const canCredit = isManagement && data.status === ReturnStatus.RECEIVED;
          const canCancel =
            (isManagement || isOwner) &&
            (
              [
                ReturnStatus.REQUESTED,
                ReturnStatus.UNDER_REVIEW,
                ReturnStatus.APPROVED,
                ReturnStatus.PARTIALLY_APPROVED,
              ] as string[]
            ).includes(data.status);

          const who = data.requestedBy
            ? `${data.requestedBy.firstName} ${data.requestedBy.lastName}`
            : undefined;

          return (
            <>
              <PageHeader
                routeId="return-detail"
                title={data.reference}
                description={
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill kind="return" status={data.status} />
                    {who
                      ? t('returnDetail.requestedBy', {
                          when: formatFinanceDateTime(data.requestedAt),
                          who,
                        })
                      : t('returnDetail.requestedOn', {
                          when: formatFinanceDateTime(data.requestedAt),
                        })}
                  </span>
                }
                actions={<LinkButton to="/returns">{t('returnDetail.all')}</LinkButton>}
              />

              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label={t('returnDetail.requestedValue')}
                  value={formatMinor(data.requestedTotalMinor)}
                />
                <Metric
                  label={t('returnDetail.creditSubtotal')}
                  value={formatMinor(data.approvedSubtotalMinor)}
                />
                <Metric
                  label={t('returnDetail.creditTax')}
                  value={formatMinor(data.approvedTaxMinor)}
                />
                <Metric
                  label={t('returnDetail.creditTotal')}
                  value={formatMinor(data.approvedTotalMinor)}
                />
              </div>

              <div className="mb-4 grid gap-4 lg:grid-cols-2">
                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {t('returnDetail.references')}
                  </h2>
                  <p className="text-text">
                    {t('returns.columnInvoice')}:{' '}
                    {data.invoiceId ? (
                      <Link
                        className="text-brand underline"
                        to={`/orders/${data.orderId?._id ?? ''}`}
                      >
                        {data.invoiceId.reference}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </p>
                  <p className="text-text">
                    {t('returnDetail.order')}: {data.orderId?.reference ?? '—'}
                  </p>
                  {!isOwner && (
                    <p className="text-text">
                      {t('fields.shop')}: {data.shopId?.name ?? '—'}{' '}
                      <span className="text-sm text-text-muted">{data.shopId?.reference}</span>
                    </p>
                  )}
                  <p className="text-text">
                    {t('returnDetail.mainReason')}: {t(`returnReason.${data.primaryReason}`)}
                  </p>
                </Card>

                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {t('returnDetail.progress')}
                  </h2>
                  <p className="text-text">
                    {t('returnDetail.reviewed')}:{' '}
                    {data.reviewedAt
                      ? formatFinanceDateTime(data.reviewedAt)
                      : t('returnDetail.notYet')}
                  </p>
                  <p className="text-text">
                    {t('returnDetail.collected')}:{' '}
                    {data.collectedAt
                      ? formatFinanceDateTime(data.collectedAt)
                      : t('returnDetail.notYet')}
                  </p>
                  <p className="text-text">
                    {t('returnDetail.received')}:{' '}
                    {data.receivedAt
                      ? formatFinanceDateTime(data.receivedAt)
                      : t('returnDetail.notYet')}
                  </p>
                  <p className="text-text">
                    {t('returnDetail.creditNote')}:{' '}
                    {data.creditNote ? (
                      <a
                        className="text-brand underline"
                        href={`/api/v1/returns/credit-notes/${data.creditNote._id}?format=pdf`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {data.creditNote.reference}
                      </a>
                    ) : (
                      t('returnDetail.notIssued')
                    )}
                  </p>
                </Card>
              </div>

              {data.shopNotes && (
                <Card className="mb-4">
                  <h2 className="mb-1 text-lg font-semibold text-text">
                    {t('returnDetail.customerNotes')}
                  </h2>
                  <p className="text-text-muted">{data.shopNotes}</p>
                </Card>
              )}
              {data.rejectionReason && (
                <Card className="mb-4">
                  <h2 className="mb-1 text-lg font-semibold text-text">
                    {t('returnDetail.rejectionReason')}
                  </h2>
                  <p className="text-text-muted">{data.rejectionReason}</p>
                </Card>
              )}
              {data.internalNotes && !isOwner && (
                <Card className="mb-4">
                  <h2 className="mb-1 text-lg font-semibold text-text">
                    {t('returnDetail.internalNotes')}
                  </h2>
                  <p className="text-text-muted">{data.internalNotes}</p>
                </Card>
              )}

              <Card className="mb-4">
                <h2 className="mb-2 text-lg font-semibold text-text">{t('returnDetail.items')}</h2>
                <DataTable
                  caption={t('returnDetail.items')}
                  columns={itemColumns}
                  rows={data.lines}
                  rowKey={lineId}
                  rowTest={(line) => line.batchNumber}
                />
              </Card>

              {canReview && (
                <Card className="mb-4">
                  <h2 className="mb-1 text-lg font-semibold text-text">
                    {t('returnDetail.reviewTitle')}
                  </h2>
                  <p className="mb-3 max-w-prose text-text-muted">{t('returnDetail.reviewBody')}</p>
                  <DataTable
                    caption={t('returnDetail.reviewTitle')}
                    columns={[
                      {
                        key: 'item',
                        header: t('returns.columnItem'),
                        cell: (line) => line.medicineSnapshot.brandName,
                      },
                      {
                        key: 'requested',
                        header: t('returnDetail.columnRequested'),
                        numeric: true,
                        cell: (line) => line.requestedQuantity,
                      },
                      {
                        key: 'approve',
                        header: t('returnDetail.approveColumn'),
                        numeric: true,
                        cell: (line) => (
                          <input
                            aria-label={t('returnDetail.approvedFor', {
                              brand: line.medicineSnapshot.brandName,
                            })}
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
                            className="min-h-11 w-24 rounded-md border border-border bg-surface px-3 text-end tabular-nums text-text"
                          />
                        ),
                      },
                    ]}
                    rows={data.lines}
                    rowKey={(line) => `decide-${lineId(line)}`}
                  />
                  <div className="mt-3 flex flex-col gap-3">
                    <Field label={t('returnDetail.reviewNotes')}>
                      <Textarea
                        rows={2}
                        maxLength={1000}
                        value={reviewNotes}
                        onChange={(event) => setReviewNotes(event.target.value)}
                      />
                    </Field>
                    <Field label={t('returnDetail.rejectionLabel')}>
                      <Input
                        value={rejectionReason}
                        onChange={(event) => setRejectionReason(event.target.value)}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      {data.status === ReturnStatus.REQUESTED && (
                        <Button
                          busy={busy === 'review'}
                          disabled={Boolean(busy)}
                          onClick={() => void act('review', {}, t('returnDetail.claimed'))}
                        >
                          {busy === 'review'
                            ? t('returnDetail.claiming')
                            : t('returnDetail.startReview')}
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        busy={busy === 'decision'}
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void act(
                            'decision',
                            {
                              reviewNotes: reviewNotes.trim() || undefined,
                              lines: data.lines.map((line) => ({
                                medicineId: line.medicineId,
                                batchId: line.batchId,
                                approvedQuantity: Math.min(
                                  line.requestedQuantity,
                                  number(decision[lineId(line)] ?? '0'),
                                ),
                              })),
                            },
                            t('returnDetail.decisionSaved'),
                          )
                        }
                      >
                        {busy === 'decision'
                          ? t('returnDetail.saving')
                          : t('returnDetail.saveDecision')}
                      </Button>
                      <Button
                        variant="danger"
                        busy={busy === 'reject'}
                        disabled={Boolean(busy) || rejectionReason.trim().length < 5}
                        onClick={() =>
                          void act(
                            'reject',
                            { rejectionReason: rejectionReason.trim() },
                            t('returnDetail.rejected'),
                          )
                        }
                      >
                        {busy === 'reject'
                          ? t('returnDetail.rejecting')
                          : t('returnDetail.rejectReturn')}
                      </Button>
                    </div>
                  </div>
                </Card>
              )}

              {canReceive && (
                <Card className="mb-4">
                  <h2 className="mb-1 text-lg font-semibold text-text">
                    {t('returnDetail.receiveTitle')}
                  </h2>
                  <p className="mb-3 max-w-prose text-text-muted">
                    {t('returnDetail.receiveBody')}
                  </p>
                  <DataTable
                    caption={t('returnDetail.receiveTitle')}
                    columns={[
                      {
                        key: 'item',
                        header: t('returns.columnItem'),
                        cell: (line) => (
                          <div>
                            <p className="text-text">{line.medicineSnapshot.brandName}</p>
                            <p className="text-sm text-text-muted">{line.batchNumber}</p>
                          </div>
                        ),
                      },
                      {
                        key: 'counted',
                        header: t('returnDetail.columnApproved'),
                        numeric: true,
                        cell: (line) => {
                          const entry = receipt[lineId(line)] ?? EMPTY_RECEIPT;
                          const counted =
                            number(entry.restock) +
                            number(entry.damaged) +
                            number(entry.expired) +
                            number(entry.quarantined);
                          return (
                            <span className={counted > line.approvedQuantity ? 'text-danger' : ''}>
                              {t('returnDetail.countedOf', {
                                counted,
                                approved: line.approvedQuantity,
                              })}
                            </span>
                          );
                        },
                      },
                      ...(
                        [
                          ['restock', 'returnDetail.restock'],
                          ['damaged', 'returnDetail.damagedColumn'],
                          ['expired', 'returnDetail.expiredColumn'],
                          ['quarantined', 'returnDetail.quarantineColumn'],
                        ] as const
                      ).map(([field, key]) => ({
                        key: field,
                        header: t(key),
                        numeric: true,
                        cell: (line: DetailLine) => {
                          const entry = receipt[lineId(line)] ?? EMPTY_RECEIPT;
                          return (
                            <input
                              aria-label={t('returnDetail.dispositionFor', {
                                field: t(key),
                                brand: line.medicineSnapshot.brandName,
                              })}
                              type="number"
                              min={0}
                              max={line.approvedQuantity}
                              value={entry[field]}
                              onChange={(event) =>
                                setReceipt((current) => ({
                                  ...current,
                                  [lineId(line)]: { ...entry, [field]: event.target.value },
                                }))
                              }
                              className="min-h-11 w-20 rounded-md border border-border bg-surface px-2 text-end tabular-nums text-text"
                            />
                          );
                        },
                      })),
                    ]}
                    rows={data.lines.filter((line) => line.approvedQuantity > 0)}
                    rowKey={(line) => `receive-${lineId(line)}`}
                  />
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="primary"
                      busy={busy === 'receive'}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void act(
                          'receive',
                          {
                            lines: data.lines
                              .filter((line) => line.approvedQuantity > 0)
                              .map((line) => {
                                const entry = receipt[lineId(line)] ?? EMPTY_RECEIPT;
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
                          t('returnDetail.receivedDone'),
                        )
                      }
                    >
                      {busy === 'receive'
                        ? t('returnDetail.bookingIn')
                        : t('returnDetail.confirmReceipt')}
                    </Button>
                  </div>
                </Card>
              )}

              <Card className="mb-4">
                <h2 className="mb-2 text-lg font-semibold text-text">
                  {t('returnDetail.actions')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {canCollect && (
                    <Button
                      busy={busy === 'collect'}
                      disabled={Boolean(busy)}
                      onClick={() => void act('collect', {}, t('returnDetail.collectedDone'))}
                    >
                      {t('returnDetail.markCollected')}
                    </Button>
                  )}
                  {canCredit && (
                    <Button
                      variant="primary"
                      busy={busy === 'credit-note'}
                      disabled={Boolean(busy)}
                      onClick={() => {
                        void (async () => {
                          const agreed = await ask.confirm({
                            title: t('returnDetail.confirmCreditTitle', {
                              amount: formatMinor(data.approvedTotalMinor),
                            }),
                            description: t('returnDetail.confirmCreditBody'),
                            confirmLabel: t('returnDetail.issueCreditNote'),
                          });
                          if (agreed) {
                            await act('credit-note', {}, t('returnDetail.creditIssued'));
                          }
                        })();
                      }}
                    >
                      {busy === 'credit-note'
                        ? t('returnDetail.issuing')
                        : t('returnDetail.issueCreditNote')}
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      variant="danger"
                      busy={busy === 'cancel'}
                      disabled={Boolean(busy)}
                      onClick={() => {
                        void (async () => {
                          const reason = await ask.prompt({
                            title: t('returnDetail.cancelTitle'),
                            description: t('returnDetail.cancelBody'),
                            label: t('actions.reason'),
                            multiline: true,
                            confirmLabel: t('returnDetail.cancelConfirm'),
                            danger: true,
                            validate: requireReason(),
                          });
                          if (reason && reason.trim().length >= 5) {
                            await act(
                              'cancel',
                              { reason: reason.trim() },
                              t('returnDetail.cancelled'),
                            );
                          }
                        })();
                      }}
                    >
                      {busy === 'cancel'
                        ? t('returnDetail.cancelling')
                        : t('returnDetail.cancelReturn')}
                    </Button>
                  )}
                  {!canCollect && !canCredit && !canCancel && !canReview && !canReceive && (
                    <p className="text-text-muted">{t('returnDetail.noActions')}</p>
                  )}
                </div>
              </Card>

              <ActivityTimeline entityType={ActivityEntityType.RETURN} entityId={data._id} />
            </>
          );
        }}
      </Resource>
    </main>
  );
}
