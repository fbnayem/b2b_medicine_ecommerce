import { Link } from 'react-router-dom';
import type { Order } from '@medsupply/shared-types';
import {
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  Pagination,
  Resource,
  StatusPill,
  type Column,
} from '../components/ui';
import { usePagedCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatMinor } from '../lib/finance';

/**
 * The list a shop owner opens most often.
 *
 * It was a hand-rolled `useEffect` fetch with its own loading boolean, its own
 * error sentence and a raw `<table>` that became a horizontal scroll strip on a
 * phone — the same shape as thirty-four other pages. What it says has not
 * changed; what has is that the wait, the failure and the empty list are now
 * the ones every other screen shows, the row stacks into a readable block below
 * the table breakpoint, and the status reads "Awaiting approval" rather than
 * `SUBMITTED`.
 */
export function OrderList() {
  const { t } = useLanguage();
  const query = usePagedCollection<Order>(['orders'], '/orders');

  const columns: ReadonlyArray<Column<Order>> = [
    {
      key: 'reference',
      header: t('fields.reference'),
      cell: (order) => (
        <Link className="font-medium text-brand underline" to={`/orders/${order._id}`}>
          {order.reference}
        </Link>
      ),
    },
    { key: 'date', header: t('fields.date'), cell: (order) => formatFinanceDate(order.createdAt) },
    {
      key: 'status',
      header: t('fields.status'),
      cell: (order) => <StatusPill kind="order" status={order.status} />,
    },
    {
      key: 'items',
      header: t('orders.itemCount'),
      numeric: true,
      cell: (order) => order.items.length,
    },
    {
      key: 'estimate',
      header: t('orders.estimate'),
      numeric: true,
      cell: (order) => formatMinor(order.estimatedTotalMinor),
    },
  ];

  return (
    <>
      <PageHeader
        routeId="orders"
        title={t('orders.title')}
        description={t('orders.subtitle')}
        actions={
          <LinkButton variant="primary" to="/medicines">
            {t('orders.start')}
          </LinkButton>
        }
      />
      <Resource
        query={query}
        loadingLabel={t('orders.loading')}
        errorMessageFallback={t('orders.couldNotLoad')}
        empty={
          <EmptyState
            title={t('orders.none')}
            description={t('orders.noneBody')}
            action={
              <LinkButton variant="primary" to="/medicines">
                {t('orders.start')}
              </LinkButton>
            }
          />
        }
      >
        {(orders) => (
          <>
            <DataTable
              caption={t('orders.title')}
              columns={columns}
              rows={orders.items}
              rowKey={(order) => order._id}
              rowTest={(order) => order.reference}
            />
            {/*
              `/orders` answers twenty rows by default and this screen showed
              exactly those, with nothing to say more existed. A shop owner with
              a month of trading saw their most recent twenty and no way to
              reach the rest.
            */}
            <Pagination
              page={orders.page}
              limit={orders.limit}
              total={orders.total}
              onPage={query.setPage}
            />
          </>
        )}
      </Resource>
    </>
  );
}
