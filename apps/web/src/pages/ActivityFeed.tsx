import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  NotificationCategory,
  RealtimeEvent,
  type ActivityEventRecord,
} from '@medsupply/shared-types';
import { useRealtimeEvent } from '../realtime/useRealtime';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterTabs,
  PageHeader,
  Pagination,
  Resource,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDateTime } from '../lib/finance';

const PAGE_SIZE = 30;

/**
 * Organisation-wide activity stream. The server filters each record by the
 * viewer's role, so a shop owner sees only their own shop's visible events.
 */
export function ActivityFeed() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);

  const search = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (category) search.set('category', category);
  const activity = useApiCollection<ActivityEventRecord>(
    ['activity', category, page],
    `/activity?${search.toString()}`,
  );

  useRealtimeEvent(RealtimeEvent.ACTIVITY_CREATED, () => {
    // Only the first page: appending to page 7 while somebody is reading it
    // would shuffle rows out from under them.
    if (page === 1) void queryClient.invalidateQueries({ queryKey: ['activity'] });
  });

  return (
    <main>
      <PageHeader
        routeId="activity"
        title={t('activity.title')}
        description={t('activity.subtitle')}
        actions={<Button onClick={() => void activity.refetch()}>{t('activity.refresh')}</Button>}
      />

      <div className="mb-4">
        <FilterTabs
          label={t('activity.categoryLabel')}
          options={[
            { value: '', label: t('activity.all') },
            ...Object.values(NotificationCategory).map((value) => ({
              value,
              label: t(`notificationCategory.${value}`),
            })),
          ]}
          value={category}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
        />
      </div>

      <Resource
        query={activity}
        loadingLabel={t('activity.loading')}
        errorMessageFallback={t('activity.couldNotLoad')}
        empty={<EmptyState title={t('activity.none')} description={t('activity.noneBody')} />}
      >
        {(result) => (
          <>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {result.items.map((item) => (
                <li key={item._id}>
                  <Card>
                    <p className="font-medium text-text">{item.summary}</p>
                    {item.detail && <p className="text-text-muted">{item.detail}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                      <Badge>{t(`notificationCategory.${item.category}`)}</Badge>
                      {formatFinanceDateTime(item.occurredAt)}
                      {item.actorName ? ` · ${item.actorName}` : ''}
                    </p>
                  </Card>
                </li>
              ))}
            </ol>
            <Pagination
              page={result.page}
              limit={result.limit}
              total={result.total}
              onPage={setPage}
            />
          </>
        )}
      </Resource>
    </main>
  );
}
