import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  NotificationCategory,
  RealtimeEvent,
  type NotificationRecord,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useNotificationStore } from '../store/useNotifications';
import { useRealtimeEvent } from '../realtime/useRealtime';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterTabs,
  LinkButton,
  PageHeader,
  Pagination,
  Resource,
  toast,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDateTime } from '../lib/finance';

const PAGE_SIZE = 20;

export function Notifications() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const loadUnread = useNotificationStore((state) => state.loadUnread);
  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const search = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (category) search.set('category', category);
  if (unreadOnly) search.set('unreadOnly', 'true');

  const notifications = useApiCollection<NotificationRecord>(
    ['notifications', category, unreadOnly, page],
    `/notifications?${search.toString()}`,
  );

  useRealtimeEvent(RealtimeEvent.NOTIFICATION_CREATED, () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });

  async function refreshBoth() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      loadUnread(),
    ]);
  }

  async function act(request: Promise<unknown>, done: string) {
    try {
      await request;
      await refreshBoth();
      toast.success(done);
    } catch {
      toast.error(t('notifications.updateFailed'));
    }
  }

  const markRead = (ids: string[]) =>
    ids.length
      ? act(
          apiClient.post('/notifications/read', { notificationIds: ids }),
          t('notifications.markedRead'),
        )
      : Promise.resolve();

  const markAllRead = () =>
    act(
      apiClient.post('/notifications/read-all', {
        ...(category ? { category } : {}),
        before: new Date().toISOString(),
      }),
      t('notifications.markedRead'),
    );

  const archive = (id: string) =>
    act(
      apiClient.post('/notifications/archive', { notificationIds: [id] }),
      t('notifications.archived'),
    );

  const options = [
    { value: '', label: t('notifications.allCategories') },
    ...Object.values(NotificationCategory).map((value) => ({
      value,
      label: t(`notificationCategory.${value}`),
    })),
  ];

  return (
    <>
      <PageHeader
        routeId="notifications"
        title={t('notifications.title')}
        description={t('notifications.subtitle')}
        actions={
          <LinkButton to="/notifications/preferences">{t('notifications.preferences')}</LinkButton>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <FilterTabs
          label={t('notifications.category')}
          options={options}
          value={category}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2 text-text">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => {
                setUnreadOnly(event.target.checked);
                setPage(1);
              }}
            />
            {t('notifications.unreadOnly')}
          </label>
          <Button
            disabled={!(notifications.data?.items ?? []).some((item) => !item.readAt)}
            onClick={() =>
              void markRead(
                (notifications.data?.items ?? [])
                  .filter((item) => !item.readAt)
                  .map((item) => item._id),
              )
            }
          >
            {t('notifications.markPageRead')}
          </Button>
          <Button onClick={() => void markAllRead()}>{t('notifications.markAllRead')}</Button>
        </div>
      </div>

      <Resource
        query={notifications}
        loadingLabel={t('notifications.loading')}
        errorMessageFallback={t('notifications.couldNotLoad')}
        empty={
          <EmptyState
            title={unreadOnly ? t('notifications.allCaughtUp') : t('notifications.noneInCategory')}
            description={t('notifications.noneBody')}
          />
        }
      >
        {(result) => (
          <>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {result.items.map((notification) => (
                <li key={notification._id}>
                  <Card
                    data-test={`row-${notification._id}`}
                    className={
                      notification.readAt
                        ? 'flex flex-wrap items-start justify-between gap-4'
                        : 'flex flex-wrap items-start justify-between gap-4 border-s-4 border-s-brand'
                    }
                  >
                    <div className="min-w-64 flex-1">
                      <p className="font-medium text-text">
                        {notification.link ? (
                          <Link className="text-brand underline" to={notification.link}>
                            {notification.title}
                          </Link>
                        ) : (
                          notification.title
                        )}
                      </p>
                      <p className="text-text-muted">{notification.body}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                        <Badge>{t(`notificationCategory.${notification.category}`)}</Badge>
                        {formatFinanceDateTime(notification.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {notification.readAt ? (
                        <Badge tone="success">{t('notifications.read')}</Badge>
                      ) : (
                        <Button size="sm" onClick={() => void markRead([notification._id])}>
                          {t('notifications.markRead')}
                        </Button>
                      )}
                      <Button size="sm" onClick={() => void archive(notification._id)}>
                        {t('notifications.archive')}
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
            <Pagination
              page={result.page}
              limit={result.limit}
              total={result.total}
              onPage={setPage}
            />
          </>
        )}
      </Resource>
    </>
  );
}
