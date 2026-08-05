import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { OrderStatus } from '@medsupply/shared-types';
import type { Order, Shop } from '@medsupply/shared-types';
import { parseMoney, toMoneyInputValue } from '@medsupply/utilities';
import { apiClient, errorMessage } from '../api/client';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Field,
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
import { formatMinor } from '../lib/finance';

interface Stock {
  _id: string;
  available: number;
  batches: Array<{ batchNumber: string; expiryDate: string; available: number }>;
}

/** What the server will actually enforce, rather than what this page can guess. */
interface Credit {
  creditLimitMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  reservedExposureMinor: number;
  availableCreditMinor: number;
  projectedExposureMinor: number;
  orderBlocked: boolean;
  blockReasons: string[];
}

interface ReviewData {
  order: Order;
  stock: Stock[];
  history: Order[];
  credit?: Credit;
  canOverrideCredit?: boolean;
  approvals: unknown[];
}

/**
 * A line as the manager is editing it.
 *
 * Money is held as the **typed string** and converted through `parseMoney` on
 * submit. The previous version asked for "Unit price (paisa)" and posted the
 * number typed — so a manager entering 12.50 sent twelve paisa, and the word
 * "paisa" is one `AGENTS.md` bans from user-facing text anyway.
 */
interface Line {
  orderItemId: string;
  approvedQuantity: number;
  unitPrice: string;
  lineDiscount: string;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card>
      <p className="text-sm text-text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-text">{value}</p>
    </Card>
  );
}

/** `0` for anything unparseable; the submit path refuses before it gets here. */
function minor(value: string): number {
  const parsed = parseMoney(value);
  return parsed.ok ? parsed.minor : 0;
}

export function ApprovalReview() {
  const ask = useAsk();
  const { id } = useParams();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();

  const query = useApiResource<ReviewData>(['approval', id], `/approvals/${id}`);
  const data = query.data;

  const [lines, setLines] = useState<Line[]>([]);
  const [orderDiscount, setOrderDiscount] = useState('0');
  const [delivery, setDelivery] = useState('0');
  const [internal, setInternal] = useState('');
  const [ownerNote, setOwnerNote] = useState('');
  const [overrideCredit, setOverrideCredit] = useState(false);

  useEffect(() => {
    if (!data) return;
    setLines(
      data.order.items.map((item) => ({
        orderItemId: String((item as { _id?: string })._id ?? item.medicineId),
        approvedQuantity: item.requestedQuantity,
        unitPrice: toMoneyInputValue(item.estimatedUnitPriceMinor),
        lineDiscount: '0',
      })),
    );
  }, [data]);

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, line) =>
          sum + line.approvedQuantity * minor(line.unitPrice) - minor(line.lineDiscount),
        0,
      ) -
      minor(orderDiscount) +
      minor(delivery),
    [lines, orderDiscount, delivery],
  );

  const reload = () => queryClient.invalidateQueries({ queryKey: ['approval', id] });

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
      title: approve ? t('approvals.cancelAskTitle') : t('approvals.refuseAskTitle'),
      description: approve ? t('approvals.cancelAskBody') : t('approvals.refuseAskBody'),
      label: approve ? t('approvals.cancelAskLabel') : t('approvals.refuseAskLabel'),
      multiline: true,
      confirmLabel: approve ? t('approvals.cancelTheOrder') : t('approvals.refuseConfirm'),
      danger: approve,
      validate: requireReason(t),
    });
    if (!reason) return;

    try {
      const response = await apiClient.post(`/orders/${data.order._id}/cancellation-decision`, {
        approve,
        reason,
        version: data.order.version,
      });
      const meta = (response.data?.meta ?? {}) as {
        releasedCreditMinor?: number;
        releasedStockUnits?: number;
      };
      await reload();
      toast.success(
        approve
          ? t('approvals.cancelled', {
              credit: formatMinor(meta.releasedCreditMinor ?? 0),
              units: meta.releasedStockUnits ?? 0,
            })
          : t('approvals.refused'),
      );
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('approvals.decisionFailed')));
    }
  }

  async function action(name: 'start' | 'hold' | 'reject' | 'approve') {
    if (!data) return;
    try {
      let body: Record<string, unknown> = { version: data.order.version };

      if (name === 'approve') {
        const bad = [
          ...lines.map((line) => line.unitPrice),
          ...lines.map((l) => l.lineDiscount),
          orderDiscount,
          delivery,
        ].find((value) => !parseMoney(value).ok);
        if (bad !== undefined) {
          toast.error(t('approvals.badAmount'));
          return;
        }
        body = {
          ...body,
          lines: lines.map((line) => ({
            orderItemId: line.orderItemId,
            approvedQuantity: line.approvedQuantity,
            unitPriceMinor: minor(line.unitPrice),
            lineDiscountMinor: minor(line.lineDiscount),
          })),
          orderDiscountMinor: minor(orderDiscount),
          deliveryChargeMinor: minor(delivery),
          internalNotes: internal || undefined,
          shopOwnerNotes: ownerNote || undefined,
          // Was hard-coded `false` on both clients, so a manager facing a
          // blocked order had no path forward at all — the service supported an
          // override that nothing could ever ask for.
          creditOverride: overrideCredit,
        };
      } else if (name !== 'start') {
        const reason = await ask.prompt({
          title: name === 'hold' ? t('approvals.holdTitle') : t('approvals.rejectTitle'),
          description: name === 'hold' ? t('approvals.holdBody') : t('approvals.rejectBody'),
          label: t('actions.reason'),
          multiline: true,
          confirmLabel: name === 'hold' ? t('approvals.holdConfirm') : t('approvals.rejectConfirm'),
          danger: name !== 'hold',
          validate: requireReason(t),
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
      await reload();
      toast.success(
        {
          start: t('approvals.started'),
          hold: t('approvals.held'),
          reject: t('approvals.rejected'),
          approve: t('approvals.approved'),
        }[name],
      );
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('approvals.actionFailed')));
    }
  }

  function itemColumns(review: ReviewData): ReadonlyArray<Column<Order['items'][number]>> {
    const update = (index: number, patch: Partial<Line>) =>
      setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
    const numberInput =
      'min-h-11 w-24 rounded-md border border-border bg-surface px-2 text-end tabular-nums text-text';

    return [
      {
        key: 'medicine',
        header: t('fields.medicine'),
        cell: (item) => (
          <div>
            <p className="font-medium text-text">{item.medicineSnapshot.brandName}</p>
            <p className="text-sm text-text-muted">{item.medicineSnapshot.genericName}</p>
          </div>
        ),
      },
      {
        key: 'requested',
        header: t('approvals.columnRequested'),
        numeric: true,
        cell: (item) => item.requestedQuantity,
      },
      {
        key: 'stock',
        header: t('approvals.columnStock'),
        numeric: true,
        cell: (item) => {
          const available =
            review.stock.find((value) => value._id === item.medicineId)?.available ?? 0;
          return (
            <span className={available < item.requestedQuantity ? 'font-semibold text-danger' : ''}>
              {available}
            </span>
          );
        },
      },
      {
        key: 'approved',
        header: t('approvals.columnApproved'),
        numeric: true,
        cell: (item) => {
          const index = review.order.items.indexOf(item);
          return (
            <input
              aria-label={t('approvals.approvedFor', { brand: item.medicineSnapshot.brandName })}
              type="number"
              min={0}
              max={item.requestedQuantity}
              value={lines[index]?.approvedQuantity ?? 0}
              onChange={(event) => update(index, { approvedQuantity: Number(event.target.value) })}
              className={numberInput}
            />
          );
        },
      },
      {
        key: 'price',
        header: t('approvals.columnUnitPrice'),
        numeric: true,
        cell: (item) => {
          const index = review.order.items.indexOf(item);
          return (
            <input
              aria-label={t('approvals.priceFor', { brand: item.medicineSnapshot.brandName })}
              inputMode="decimal"
              value={lines[index]?.unitPrice ?? ''}
              onChange={(event) => update(index, { unitPrice: event.target.value })}
              className={numberInput}
            />
          );
        },
      },
      {
        key: 'discount',
        header: t('approvals.columnLineDiscount'),
        numeric: true,
        cell: (item) => {
          const index = review.order.items.indexOf(item);
          return (
            <input
              aria-label={t('approvals.discountFor', { brand: item.medicineSnapshot.brandName })}
              inputMode="decimal"
              value={lines[index]?.lineDiscount ?? ''}
              onChange={(event) => update(index, { lineDiscount: event.target.value })}
              className={numberInput}
            />
          );
        },
      },
    ];
  }

  return (
    <>
      <Resource
        query={query}
        loadingLabel={t('approvals.loadingOne')}
        errorMessageFallback={t('approvals.couldNotLoadOne')}
      >
        {(review) => {
          const { order, credit, history } = review;
          const shop = order.shopId as Shop;
          /*
           * From the server, which counts `reservedCreditMinor` — the exposure
           * of orders already approved and not yet invoiced. This page used to
           * compute `creditLimit - outstandingBalance` locally and could
           * therefore show comfortable headroom on an order the server was
           * about to refuse.
           */
          const availableCredit =
            credit?.availableCreditMinor ?? shop.creditLimit - shop.outstandingBalance;

          return (
            <>
              <PageHeader
                routeId="approval-review"
                title={order.reference}
                description={
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill kind="order" status={order.status} />
                    {shop.name}
                  </span>
                }
                actions={<LinkButton to="/approvals">{t('approvals.backToQueue')}</LinkButton>}
              />

              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Metric label={t('approvals.creditLimit')} value={formatMinor(shop.creditLimit)} />
                <Metric
                  label={t('approvals.outstanding')}
                  value={formatMinor(shop.outstandingBalance)}
                />
                <Metric
                  label={t('approvals.availableCredit')}
                  value={formatMinor(availableCredit)}
                />
                <Metric
                  label={t('approvals.alreadyCommitted')}
                  value={formatMinor(credit?.reservedExposureMinor ?? 0)}
                />
                <Metric
                  label={t('approvals.paymentTerms')}
                  value={t('approvals.days', { days: shop.paymentTermsDays })}
                />
              </div>

              {order.cancellationRequestedAt && (
                <Card className="mb-4 border-warning bg-warning-subtle">
                  <h2 className="text-lg font-semibold text-text">
                    {t('approvals.cancellationAsked')}
                  </h2>
                  <p className="mt-1 text-text">{order.cancellationReason}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="danger" onClick={() => void decideCancellation(true)}>
                      {t('approvals.cancelTheOrder')}
                    </Button>
                    <Button onClick={() => void decideCancellation(false)}>
                      {t('approvals.refuseAndCarryOn')}
                    </Button>
                  </div>
                </Card>
              )}

              {credit?.orderBlocked && (
                <Card className="mb-4 border-danger bg-danger-subtle">
                  <h2 className="text-lg font-semibold text-text">{t('approvals.blocked')}</h2>
                  <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-text">
                    {credit.blockReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm text-text-muted">
                    {t('approvals.blockedBody', {
                      shop: shop.name,
                      projected: formatMinor(credit.projectedExposureMinor),
                      limit: formatMinor(credit.creditLimitMinor),
                    })}
                  </p>

                  {review.canOverrideCredit ? (
                    <label className="mt-3 flex items-start gap-2 text-text">
                      <input
                        type="checkbox"
                        checked={overrideCredit}
                        onChange={(event) => setOverrideCredit(event.target.checked)}
                      />
                      <span>
                        <strong>{t('approvals.overrideLabel')}</strong>{' '}
                        {t('approvals.overrideBody')}
                      </span>
                    </label>
                  ) : (
                    <p className="mt-3 text-text">
                      <Badge tone="warning">{t('approvals.adminOnly')}</Badge>{' '}
                      {t('approvals.adminOnlyBody')}
                    </p>
                  )}
                </Card>
              )}

              <Card className="mb-4">
                <h2 className="mb-2 text-lg font-semibold text-text">{t('approvals.requested')}</h2>
                <DataTable
                  caption={t('approvals.requested')}
                  columns={itemColumns(review)}
                  rows={order.items}
                  rowKey={(item) => item.medicineId}
                  rowTest={(item) => item.medicineSnapshot.brandName}
                />
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {t('approvals.adjustments')}
                  </h2>
                  <div className="flex flex-col gap-3">
                    <Field label={t('approvals.orderDiscount')}>
                      <input
                        inputMode="decimal"
                        value={orderDiscount}
                        onChange={(event) => setOrderDiscount(event.target.value)}
                        className="min-h-11 w-full rounded-md border border-border bg-surface px-3 tabular-nums text-text"
                      />
                    </Field>
                    <Field label={t('approvals.deliveryCharge')}>
                      <input
                        inputMode="decimal"
                        value={delivery}
                        onChange={(event) => setDelivery(event.target.value)}
                        className="min-h-11 w-full rounded-md border border-border bg-surface px-3 tabular-nums text-text"
                      />
                    </Field>
                    <Field label={t('approvals.internalNotes')}>
                      <Textarea
                        value={internal}
                        onChange={(event) => setInternal(event.target.value)}
                      />
                    </Field>
                    <Field label={t('approvals.shopNotes')}>
                      <Textarea
                        value={ownerNote}
                        onChange={(event) => setOwnerNote(event.target.value)}
                      />
                    </Field>
                  </div>
                  <p className="mt-3 flex items-baseline justify-between gap-4">
                    <strong className="text-text">{t('approvals.approvalTotal')}</strong>
                    <strong className="text-lg tabular-nums text-text">{formatMinor(total)}</strong>
                  </p>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {order.status === OrderStatus.SUBMITTED && (
                      <Button onClick={() => void action('start')}>
                        {t('approvals.startReview')}
                      </Button>
                    )}
                    <Button onClick={() => void action('hold')}>{t('approvals.hold')}</Button>
                    <Button variant="danger" onClick={() => void action('reject')}>
                      {t('approvals.reject')}
                    </Button>
                    <Button variant="primary" onClick={() => void action('approve')}>
                      {t('approvals.confirmApproval')}
                    </Button>
                  </div>
                </Card>

                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {t('approvals.previousOrders')}
                  </h2>
                  {history.length ? (
                    <ul className="m-0 list-none p-0">
                      {history.map((previous) => (
                        <li
                          key={previous._id}
                          className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0"
                        >
                          <span className="text-text">{previous.reference}</span>
                          <StatusPill kind="order" status={previous.status} />
                          <span className="tabular-nums text-text">
                            {formatMinor(previous.estimatedTotalMinor)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-text-muted">{t('approvals.noPreviousOrders')}</p>
                  )}
                  <p className="mt-3 text-sm text-text-muted">
                    {t('approvals.decisionRecords', { count: review.approvals.length })}
                  </p>
                </Card>
              </div>
            </>
          );
        }}
      </Resource>
    </>
  );
}
