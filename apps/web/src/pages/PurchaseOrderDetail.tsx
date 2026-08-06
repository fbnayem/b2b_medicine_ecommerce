import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { parseMoney, toMoneyInputValue } from '@medsupply/utilities';
import type { GoodsReceipt, PurchaseOrder, PurchaseOrderLine } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Resource,
  toast,
  type Column,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatFinanceDateTime, formatMinor } from '../lib/finance';

interface OrderPayload {
  order: PurchaseOrder;
  receipts: GoodsReceipt[];
}

/** One line as the storekeeper is booking it in, standing at the bay. */
interface ReceiptDraft {
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  receivedQuantity: string;
  warehouseLocation: string;
  supplierBatchReference: string;
  varianceReason: string;
  unitCost: string;
}

const emptyDraft = (line: PurchaseOrderLine): ReceiptDraft => ({
  batchNumber: '',
  manufacturingDate: '',
  expiryDate: '',
  // Pre-filled with what is still outstanding, because that is what usually
  // turns up — and it is the number the storekeeper is checking against.
  receivedQuantity: String(Math.max(0, line.orderedQuantity - line.receivedQuantity)),
  warehouseLocation: '',
  supplierBatchReference: '',
  varianceReason: '',
  unitCost: toMoneyInputValue(line.unitCostMinor),
});

const units = (value: string) => {
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

export function PurchaseOrderDetail() {
  const { id } = useParams();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();

  const query = useApiResource<OrderPayload>(
    keys.purchasing.order(id!),
    `/purchasing/orders/${id}`,
  );
  const [drafts, setDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [supplierInvoiceReference, setSupplierInvoiceReference] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const draftFor = (line: PurchaseOrderLine) => drafts[line._id] ?? emptyDraft(line);
  const patch = (line: PurchaseOrderLine, next: Partial<ReceiptDraft>) =>
    setDrafts((current) => ({ ...current, [line._id]: { ...draftFor(line), ...next } }));

  /**
   * Booking in what actually arrived.
   *
   * Only lines the storekeeper has entered a batch number and a quantity for
   * are sent: a receipt is a record of a physical event, and an untouched line
   * means nothing turned up for it rather than that zero of it did.
   */
  async function receive(order: PurchaseOrder) {
    const lines = order.lines
      .map((line) => ({ line, draft: draftFor(line) }))
      .filter(({ draft }) => draft.batchNumber.trim() && units(draft.receivedQuantity) > 0);

    if (lines.length === 0) {
      toast.error(t('purchasing.nothingToReceive'));
      return;
    }

    const shortWithoutReason = lines.find(
      ({ line, draft }) =>
        units(draft.receivedQuantity) < line.orderedQuantity - line.receivedQuantity &&
        draft.varianceReason.trim().length === 0,
    );
    if (shortWithoutReason) {
      toast.error(t('purchasing.varianceReasonHint'));
      return;
    }

    const badCost = lines.find(({ draft }) => draft.unitCost && !parseMoney(draft.unitCost).ok);
    if (badCost) {
      toast.error(t('purchasing.badAmount'));
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post(`/purchasing/orders/${order._id}/receipts`, {
        supplierInvoiceReference: supplierInvoiceReference || undefined,
        lines: lines.map(({ line, draft }) => {
          const cost = parseMoney(draft.unitCost);
          return {
            purchaseOrderLineId: line._id,
            batchNumber: draft.batchNumber.trim(),
            manufacturingDate: draft.manufacturingDate,
            expiryDate: draft.expiryDate,
            receivedQuantity: units(draft.receivedQuantity),
            unitCostMinor: cost.ok ? cost.minor : undefined,
            warehouseLocation: draft.warehouseLocation.trim(),
            supplierBatchReference: draft.supplierBatchReference || undefined,
            varianceReason: draft.varianceReason || undefined,
          };
        }),
      });
      toast.success(t('purchasing.receiptSaved'));
      setDrafts({});
      setSupplierInvoiceReference('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.purchasing.all }),
        queryClient.invalidateQueries({ queryKey: keys.stock.all }),
        queryClient.invalidateQueries({ queryKey: keys.medicines.all }),
      ]);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('purchasing.receiptFailed')));
    } finally {
      setSubmitting(false);
    }
  }

  const lineColumns: ReadonlyArray<Column<PurchaseOrderLine>> = [
    {
      key: 'medicine',
      header: t('fields.medicine'),
      cell: (line) => (
        <div>
          <p className="font-medium text-text">{line.medicineSnapshot?.brandName ?? '—'}</p>
          <p className="text-sm text-text-muted">
            {line.medicineSnapshot?.genericName} {line.medicineSnapshot?.strength}
          </p>
        </div>
      ),
    },
    {
      key: 'ordered',
      header: t('purchasing.ordered'),
      numeric: true,
      cell: (line) => line.orderedQuantity,
    },
    {
      key: 'received',
      header: t('purchasing.received'),
      numeric: true,
      cell: (line) => line.receivedQuantity,
    },
    {
      key: 'outstanding',
      header: t('purchasing.outstanding'),
      numeric: true,
      cell: (line) => {
        const remaining = Math.max(0, line.orderedQuantity - line.receivedQuantity);
        return remaining > 0 ? <span className="text-warning">{remaining}</span> : 0;
      },
    },
    {
      key: 'cost',
      header: t('purchasing.unitCost'),
      numeric: true,
      cell: (line) => formatMinor(line.unitCostMinor),
    },
    {
      key: 'total',
      header: t('purchasing.lineTotal'),
      numeric: true,
      cell: (line) => formatMinor(line.orderedQuantity * line.unitCostMinor),
    },
  ];

  return (
    <>
      <PageHeader
        routeId="purchase-order-detail"
        title={t('purchasing.ordersTitle')}
        actions={<LinkButton to="/purchasing/orders">{t('purchasing.backToOrders')}</LinkButton>}
      />

      <Resource
        query={query}
        loadingLabel={t('purchasing.orderLoading')}
        errorMessageFallback={t('purchasing.orderCouldNotLoad')}
      >
        {({ order, receipts }) => {
          const supplier = typeof order.supplierId === 'string' ? undefined : order.supplierId;
          const outstanding = order.lines.reduce(
            (sum, line) => sum + Math.max(0, line.orderedQuantity - line.receivedQuantity),
            0,
          );
          const total = order.lines.reduce(
            (sum, line) => sum + line.orderedQuantity * line.unitCostMinor,
            0,
          );

          return (
            <>
              <Card className="mb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold text-text">{order.reference}</p>
                    <p className="text-text-muted">{supplier?.name ?? '—'}</p>
                  </div>
                  <Badge tone={outstanding > 0 ? 'warning' : 'success'}>
                    {t(`purchaseOrderStatus.${order.status}`)}
                  </Badge>
                </div>
                <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-sm text-text-muted">{t('purchasing.expectedDate')}</dt>
                    <dd className="text-text">
                      {order.expectedDate ? formatFinanceDate(order.expectedDate) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-text-muted">{t('purchasing.supplierReference')}</dt>
                    <dd className="text-text">{order.supplierReference || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-text-muted">{t('purchasing.orderTotal')}</dt>
                    <dd className="tabular-nums text-text">{formatMinor(total)}</dd>
                  </div>
                </dl>
              </Card>

              <Card className="mb-4">
                <h2 className="mb-2 text-lg font-semibold text-text">
                  {t('purchasing.orderLines')}
                </h2>
                <DataTable
                  caption={t('purchasing.orderLines')}
                  columns={lineColumns}
                  rows={order.lines}
                  rowKey={(line) => line._id}
                />
              </Card>

              {outstanding > 0 ? (
                <Card className="mb-4">
                  <h2 className="text-lg font-semibold text-text">
                    {t('purchasing.receiveTitle')}
                  </h2>
                  <p className="mb-3 text-text-muted">{t('purchasing.receiveBody')}</p>

                  <Field
                    label={t('purchasing.supplierInvoiceReference')}
                    className="mb-4 max-w-md"
                    hint={t('hints.supplierInvoiceRef')}
                  >
                    <Input
                      value={supplierInvoiceReference}
                      onChange={(event) => setSupplierInvoiceReference(event.target.value)}
                    />
                  </Field>

                  <div className="flex flex-col gap-5">
                    {order.lines
                      .filter((line) => line.orderedQuantity > line.receivedQuantity)
                      .map((line) => {
                        const draft = draftFor(line);
                        const remaining = line.orderedQuantity - line.receivedQuantity;
                        const short = units(draft.receivedQuantity) < remaining;
                        return (
                          <fieldset key={line._id} className="border-t border-border pt-3">
                            <legend className="px-1 text-sm font-medium text-text">
                              {t('purchasing.receiveLine', {
                                brand: line.medicineSnapshot?.brandName ?? '',
                              })}
                            </legend>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <Field
                                label={t('purchasing.batchNumber')}
                                hint={t('hints.batchNumber')}
                              >
                                <Input
                                  value={draft.batchNumber}
                                  onChange={(event) =>
                                    patch(line, { batchNumber: event.target.value })
                                  }
                                />
                              </Field>
                              <Field
                                label={t('purchasing.manufacturingDate')}
                                hint={t('hints.manufacturingDate')}
                              >
                                <Input
                                  type="date"
                                  value={draft.manufacturingDate}
                                  onChange={(event) =>
                                    patch(line, { manufacturingDate: event.target.value })
                                  }
                                />
                              </Field>
                              <Field
                                label={t('purchasing.expiryDate')}
                                hint={t('hints.expiryDate')}
                              >
                                <Input
                                  type="date"
                                  value={draft.expiryDate}
                                  onChange={(event) =>
                                    patch(line, { expiryDate: event.target.value })
                                  }
                                />
                              </Field>
                              <Field
                                label={t('purchasing.receivedQuantity')}
                                hint={t('hints.receivedQuantity')}
                              >
                                <Input
                                  inputMode="numeric"
                                  value={draft.receivedQuantity}
                                  onChange={(event) =>
                                    patch(line, { receivedQuantity: event.target.value })
                                  }
                                />
                              </Field>
                              <Field
                                label={t('purchasing.warehouseLocation')}
                                hint={t('hints.warehouseLocation')}
                              >
                                <Input
                                  value={draft.warehouseLocation}
                                  onChange={(event) =>
                                    patch(line, { warehouseLocation: event.target.value })
                                  }
                                />
                              </Field>
                              <Field
                                label={t('purchasing.supplierBatchReference')}
                                hint={t('hints.supplierBatchRef')}
                              >
                                <Input
                                  value={draft.supplierBatchReference}
                                  onChange={(event) =>
                                    patch(line, { supplierBatchReference: event.target.value })
                                  }
                                />
                              </Field>
                              <Field label={t('purchasing.unitCost')} hint={t('hints.unitCost')}>
                                <Input
                                  inputMode="decimal"
                                  value={draft.unitCost}
                                  onChange={(event) =>
                                    patch(line, { unitCost: event.target.value })
                                  }
                                />
                              </Field>
                              {/*
                               * Shown only when less arrived than was ordered.
                               * The server requires it in that case, and a
                               * short delivery is a conversation with the
                               * supplier rather than something to book quietly.
                               */}
                              {short && (
                                <Field
                                  label={t('purchasing.varianceReason')}
                                  hint={t('purchasing.varianceReasonHint')}
                                  required
                                  className="sm:col-span-2"
                                >
                                  <Input
                                    value={draft.varianceReason}
                                    onChange={(event) =>
                                      patch(line, { varianceReason: event.target.value })
                                    }
                                  />
                                </Field>
                              )}
                            </div>
                          </fieldset>
                        );
                      })}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button variant="primary" busy={submitting} onClick={() => void receive(order)}>
                      {t('purchasing.confirmReceipt')}
                    </Button>
                  </div>
                </Card>
              ) : (
                <Card className="mb-4">
                  <p className="text-text-muted">{t('purchasing.nothingToReceive')}</p>
                </Card>
              )}

              <Card>
                <h2 className="mb-2 text-lg font-semibold text-text">{t('purchasing.receipts')}</h2>
                {receipts.length === 0 ? (
                  <EmptyState title={t('purchasing.noReceipts')} />
                ) : (
                  <ul className="flex flex-col gap-3">
                    {receipts.map((receipt) => (
                      <li key={receipt._id} className="border-t border-border pt-3">
                        <p className="font-medium text-text">
                          {receipt.reference} ·{' '}
                          {t('purchasing.receiptOn', {
                            when: formatFinanceDateTime(receipt.receivedAt),
                          })}
                        </p>
                        {receipt.supplierInvoiceReference && (
                          <p className="text-sm text-text-muted">
                            {t('purchasing.supplierInvoiceReference')}:{' '}
                            {receipt.supplierInvoiceReference}
                          </p>
                        )}
                        <ul className="mt-1 text-sm text-text">
                          {receipt.lines.map((line) => (
                            <li key={`${receipt._id}-${line.batchId}`} className="tabular-nums">
                              {line.batchNumber} · {line.receivedQuantity}
                              {line.varianceQuantity !== 0 && (
                                <span className="ms-2 text-warning">
                                  ({t('purchasing.variance')} {line.varianceQuantity}
                                  {line.varianceReason ? ` — ${line.varianceReason}` : ''})
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          );
        }}
      </Resource>
    </>
  );
}
