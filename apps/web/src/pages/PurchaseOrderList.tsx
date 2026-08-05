import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PurchaseOrderStatus } from '@medsupply/shared-types';
import type { PurchaseOrder } from '@medsupply/shared-types';
import {
  Badge,
  DataTable,
  EmptyState,
  Field,
  LinkButton,
  PageHeader,
  Pagination,
  Resource,
  Select,
  type BadgeTone,
  type Column,
} from '../components/ui';
import { usePagedCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatMinor } from '../lib/finance';

/**
 * `Record<PurchaseOrderStatus, BadgeTone>`, so adding a status to the shared
 * types is a compile error here until it has a colour — the same guarantee
 * `StatusPill` gives the statuses that live in `@medsupply/shared-types`.
 */
const TONE: Record<PurchaseOrderStatus, BadgeTone> = {
  [PurchaseOrderStatus.DRAFT]: 'neutral',
  [PurchaseOrderStatus.ISSUED]: 'info',
  [PurchaseOrderStatus.PARTIALLY_RECEIVED]: 'warning',
  [PurchaseOrderStatus.RECEIVED]: 'success',
  [PurchaseOrderStatus.CANCELLED]: 'neutral',
};

export function orderTotalMinor(order: PurchaseOrder): number {
  return order.lines.reduce((sum, line) => sum + line.orderedQuantity * line.unitCostMinor, 0);
}

export function outstandingUnits(order: PurchaseOrder): number {
  return order.lines.reduce(
    (sum, line) => sum + Math.max(0, line.orderedQuantity - line.receivedQuantity),
    0,
  );
}

export function PurchaseOrderList() {
  const { t } = useLanguage();
  const [status, setStatus] = useState('');

  const orders = usePagedCollection<PurchaseOrder>(
    ['purchase-orders', status],
    `/purchasing/orders${status ? `?status=${status}` : ''}`,
  );

  const columns: ReadonlyArray<Column<PurchaseOrder>> = [
    {
      key: 'reference',
      header: t('fields.reference'),
      cell: (order) => (
        <Link className="font-medium text-brand underline" to={`/purchasing/orders/${order._id}`}>
          {order.reference}
        </Link>
      ),
    },
    {
      key: 'supplier',
      header: t('purchasing.supplier'),
      cell: (order) =>
        typeof order.supplierId === 'string' ? '—' : (order.supplierId?.name ?? '—'),
    },
    {
      key: 'lines',
      header: t('purchasing.orderLines'),
      numeric: true,
      cell: (order) => order.lines.length,
    },
    {
      key: 'outstanding',
      header: t('purchasing.outstanding'),
      numeric: true,
      cell: (order) => {
        const remaining = outstandingUnits(order);
        return remaining > 0 ? <span className="text-warning">{remaining}</span> : 0;
      },
    },
    {
      key: 'total',
      header: t('purchasing.orderTotal'),
      numeric: true,
      cell: (order) => formatMinor(orderTotalMinor(order)),
    },
    {
      key: 'expected',
      header: t('purchasing.expectedDate'),
      cell: (order) => (order.expectedDate ? formatFinanceDate(order.expectedDate) : '—'),
    },
    {
      key: 'status',
      header: t('fields.status'),
      cell: (order) => (
        <Badge tone={TONE[order.status] ?? 'neutral'}>
          {t(`purchaseOrderStatus.${order.status}`)}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        routeId="purchase-orders"
        title={t('purchasing.ordersTitle')}
        description={t('purchasing.ordersSubtitle')}
        actions={
          <LinkButton variant="primary" to="/purchasing/orders/new">
            {t('purchasing.raiseOrder')}
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t('fields.status')} className="min-w-56">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t('purchasing.allStatuses')}</option>
            {Object.values(PurchaseOrderStatus).map((value) => (
              <option key={value} value={value}>
                {t(`purchaseOrderStatus.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Resource
        query={orders}
        loadingLabel={t('purchasing.ordersLoading')}
        errorMessageFallback={t('purchasing.ordersCouldNotLoad')}
        empty={
          <EmptyState
            title={t('purchasing.ordersNone')}
            description={t('purchasing.ordersNoneBody')}
          />
        }
      >
        {(page) => (
          <>
            <DataTable
              caption={t('purchasing.ordersTitle')}
              columns={columns}
              rows={page.items}
              rowKey={(order) => order._id}
              rowTest={(order) => order.reference}
            />
            <Pagination
              page={page.page}
              limit={page.limit}
              total={page.total}
              onPage={orders.setPage}
            />
          </>
        )}
      </Resource>
    </>
  );
}
