import { Link } from 'react-router-dom';
import { OrderStatus } from '@medsupply/shared-types';
import type { Order, Shop } from '@medsupply/shared-types';
import {
  DataTable,
  EmptyState,
  FilterTabs,
  PageHeader,
  Resource,
  StatusPill,
  type Column,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useSavedFilter } from '../lib/savedFilter';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDateTime, formatMinor } from '../lib/finance';

/** The states a manager triages, in the order they are worked. */
const STATES = [
  OrderStatus.SUBMITTED,
  OrderStatus.UNDER_REVIEW,
  OrderStatus.ON_HOLD,
  OrderStatus.APPROVED,
  OrderStatus.PARTIALLY_APPROVED,
  OrderStatus.REJECTED,
];

export function ApprovalQueue() {
  const { t } = useLanguage();
  const [status, setStatus] = useSavedFilter('approvals', '');

  const queue = useApiCollection<Order>(
    ['approval-queue', status],
    `/approvals/queue${status ? `?status=${status}` : ''}`,
  );

  const columns: ReadonlyArray<Column<Order>> = [
    {
      key: 'reference',
      header: t('approvals.order'),
      cell: (order) => (
        <Link className="font-medium text-brand underline" to={`/approvals/${order._id}`}>
          {order.reference}
        </Link>
      ),
    },
    {
      key: 'shop',
      header: t('fields.shop'),
      cell: (order) => (order.shopId as Shop).name,
    },
    {
      key: 'status',
      header: t('fields.status'),
      cell: (order) => <StatusPill kind="order" status={order.status} />,
    },
    {
      key: 'estimate',
      header: t('approvals.estimate'),
      numeric: true,
      cell: (order) => formatMinor(order.estimatedTotalMinor),
    },
    {
      key: 'submitted',
      header: t('approvals.submitted'),
      cell: (order) => (order.submittedAt ? formatFinanceDateTime(order.submittedAt) : '—'),
    },
  ];

  return (
    <>
      <PageHeader
        routeId="approvals"
        title={t('approvals.title')}
        description={t('approvals.subtitle')}
      />

      <div className="mb-4">
        <FilterTabs
          label={t('approvals.filterLabel')}
          options={[
            { value: '', label: t('approvals.allStatuses') },
            ...STATES.map((value) => ({ value, label: t(`orderStatus.${value}`) })),
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>

      <Resource
        query={queue}
        loadingLabel={t('approvals.loading')}
        errorMessageFallback={t('approvals.couldNotLoad')}
        empty={<EmptyState title={t('approvals.none')} description={t('approvals.noneBody')} />}
      >
        {(page) => (
          <DataTable
            caption={t('approvals.title')}
            columns={columns}
            rows={page.items}
            rowKey={(order) => order._id}
            rowTest={(order) => order.reference}
          />
        )}
      </Resource>
    </>
  );
}
