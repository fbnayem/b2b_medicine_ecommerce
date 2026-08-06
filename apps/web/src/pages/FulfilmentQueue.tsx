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
import { keys } from '../lib/queryKeys';
import { useSavedFilter } from '../lib/savedFilter';
import { useLanguage } from '../lib/useLanguage';
import { pickingQueue } from '../lib/workQueues';

interface PickingList {
  _id: string;
  status: string;
  items: unknown[];
  orderId: { reference: string; shopId: { name: string } };
}

export function FulfilmentQueue() {
  const { t } = useLanguage();
  /*
   * Opens on the work still to do, not on every picking list ever made.
   *
   * The endpoint's default returns packed ones too, so this screen opened
   * showing fifteen rows of which one was outstanding — and the home screen,
   * counting the same unfiltered request, said "15 orders to pick". Both now
   * read the outstanding set from `workQueues.ts`.
   */
  const [status, setStatus] = useSavedFilter('fulfilment', pickingQueue.outstanding);

  const queue = useApiCollection<PickingList>(
    keys.fulfilment.queue(status),
    pickingQueue.url(status),
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
          options={pickingQueue.filters.map((value) => ({
            value,
            label:
              value === pickingQueue.outstanding
                ? t('pickingStatus.OUTSTANDING')
                : t(`pickingStatus.${value || 'ALL'}`),
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
