import { Link } from 'react-router-dom';
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
import { keys } from '../lib/queryKeys';
import { useSavedFilter } from '../lib/savedFilter';
import { useLanguage } from '../lib/useLanguage';
import { approvalsQueue } from '../lib/workQueues';
import { formatFinanceDateTime, formatMinor } from '../lib/finance';

export function ApprovalQueue() {
  const { t } = useLanguage();
  /*
   * Opens on the orders that still need deciding, not on every order that has
   * ever passed through here.
   *
   * The endpoint's default returns approved and rejected ones too, so this
   * screen used to open showing three rows of which one was actually waiting —
   * and the home screen, counting the same unfiltered request, said "3 orders
   * waiting for your decision". Both are now the outstanding set, from the one
   * constant in `workQueues.ts`, so the number and the list agree.
   *
   * Everything decided is still one tab away, and `useSavedFilter` means
   * somebody who prefers that view keeps it.
   */
  const [status, setStatus] = useSavedFilter('approvals', approvalsQueue.outstanding);

  const queue = useApiCollection<Order>(keys.approvals.queue(status), approvalsQueue.url(status));

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
          options={approvalsQueue.filters.map((value) => ({
            value,
            label:
              value === ''
                ? t('approvals.allStatuses')
                : value === approvalsQueue.outstanding
                  ? t('approvals.stillWaiting')
                  : t(`orderStatus.${value}`),
          }))}
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
