import { Link } from 'react-router-dom';
import {
  Badge,
  Card,
  EmptyState,
  FilterTabs,
  LinkButton,
  PageHeader,
  Resource,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useSavedFilter } from '../lib/savedFilter';
import { useLanguage } from '../lib/useLanguage';

interface PickingList {
  _id: string;
  status: string;
  items: unknown[];
  orderId: { reference: string; shopId: { name: string } };
}

/** The order a storekeeper meets the work in, not the order the enum declares it. */
const QUEUES = ['', 'PENDING', 'PICKING', 'PAUSED', 'PACKING', 'BLOCKED_DISCREPANCY', 'PACKED'];

export function FulfilmentQueue() {
  const { t } = useLanguage();
  const [status, setStatus] = useSavedFilter('fulfilment', '');

  const queue = useApiCollection<PickingList>(
    ['fulfilment-queue', status],
    `/fulfilment/queue${status ? `?status=${status}` : ''}`,
  );

  return (
    <>
      <PageHeader
        routeId="fulfilment"
        title={t('fulfilment.title')}
        description={t('fulfilment.subtitle')}
        actions={<LinkButton to="/fulfilment/ready">{t('fulfilment.readyLink')}</LinkButton>}
      />

      <div className="mb-4">
        <FilterTabs
          label={t('fulfilment.filter')}
          options={QUEUES.map((value) => ({
            value,
            label: t(`pickingStatus.${value || 'ALL'}`),
          }))}
          value={status}
          onChange={setStatus}
        />
      </div>

      <Resource
        query={queue}
        loadingLabel={t('fulfilment.loading')}
        errorMessageFallback={t('fulfilment.couldNotLoad')}
        empty={<EmptyState title={t('fulfilment.none')} description={t('fulfilment.noneBody')} />}
      >
        {(page) => (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {page.items.map((list) => (
              <li key={list._id}>
                <Card className="h-full p-0">
                  {/* The whole card is the link, and `row-<reference>` uses the
                      order reference — never the picking list's ObjectId. */}
                  <Link
                    data-test={`row-${list.orderId.reference}`}
                    to={`/fulfilment/${list._id}`}
                    className="flex h-full flex-col gap-1 rounded-lg p-4 hover:bg-surface-hover"
                  >
                    <span className="text-sm text-text-muted">{list.orderId.reference}</span>
                    <span className="text-lg font-semibold text-text">
                      {list.orderId.shopId.name}
                    </span>
                    <span className="text-text-muted">
                      {t('fulfilment.lines', { count: list.items.length })}
                    </span>
                    <span className="mt-2 flex items-center justify-between gap-2">
                      <Badge tone={list.status === 'BLOCKED_DISCREPANCY' ? 'danger' : 'info'}>
                        {t(`pickingStatus.${list.status}`)}
                      </Badge>
                      <span className="font-medium text-brand">{t('fulfilment.open')} →</span>
                    </span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Resource>
    </>
  );
}
