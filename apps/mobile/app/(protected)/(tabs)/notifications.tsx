import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { RealtimeEvent, type NotificationRecord } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import {
  archiveNotifications,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from '../../../src/notifications/api';
import { onRealtime } from '../../../src/notifications/realtime';
import { routeForPush } from '../../../src/notifications/push';
import { formatFinanceDateTime } from '../../../src/finance/date';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Button,
  CardLink,
  EmptyState,
  ErrorState,
  FilterChips,
  LoadingState,
  Screen,
  toast,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

export default function NotificationsScreen() {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        const page = await fetchNotifications(1, unreadOnly);
        setItems(page.items);
        setError('');
      } catch (caught) {
        setError(errorMessage(caught, language, t('notifications.couldNotLoad')));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [unreadOnly, language, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A push that arrives while the inbox is open updates it without a pull.
  useEffect(() => onRealtime(RealtimeEvent.NOTIFICATION_CREATED, () => void load(true)), [load]);

  const open = async (notification: NotificationRecord) => {
    if (!notification.readAt) {
      await markNotificationsRead([notification._id]);
      setItems((current) =>
        current.map((entry) =>
          entry._id === notification._id ? { ...entry, readAt: new Date().toISOString() } : entry,
        ),
      );
    }
    const path = routeForPush({ link: notification.link });
    if (path && path !== '/notifications') {
      router.push(path as never);
    }
  };

  /*
   * "Marking all as read..." was set into a state variable and rendered as a
   * green line above the list, where it stayed until the next action replaced
   * it. It is a result, not a state of the screen, and a rider who is not
   * looking at the top of the list never learned that anything happened.
   */
  const readAll = async () => {
    try {
      await markAllNotificationsRead();
      await load(true);
      toast.success(t('notifications.markedRead'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('notifications.updateFailed')));
    }
  };

  /*
   * The only thing that takes anything off this list.
   *
   * Marking as read changes a dot. Without archiving, an inbox on a shop's
   * phone grows for as long as the account does, and the notification that
   * matters this morning sits under three hundred that mattered last year. The
   * row disappears immediately rather than waiting for a reload — the server
   * has already been told, and a list that redraws a second later reads as a
   * button that did nothing.
   */
  const archive = async (notification: NotificationRecord) => {
    setItems((current) => current.filter((entry) => entry._id !== notification._id));
    try {
      await archiveNotifications([notification._id]);
      toast.success(t('notifications.archived'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('notifications.updateFailed')));
      await load(true);
    }
  };

  return (
    <Screen scroll={false}>
      <FilterChips
        label={t('notifications.category')}
        value={unreadOnly ? 'unread' : 'all'}
        onChange={(next) => setUnreadOnly(next === 'unread')}
        options={[
          { value: 'all', label: t('notifications.all') },
          { value: 'unread', label: t('notifications.unreadOnly') },
        ]}
      />

      <View style={{ flexDirection: 'row', gap: layout.space[2] }}>
        <Button
          variant="secondary"
          style={{ flex: 1 }}
          label={t('notifications.markAllRead')}
          onPress={() => void readAll()}
        />
        <Button
          variant="secondary"
          style={{ flex: 1 }}
          label={t('notifications.preferences')}
          onPress={() => router.push('/(protected)/notification-preferences')}
        />
      </View>

      {loading ? (
        <LoadingState label={t('notifications.loading')} />
      ) : (
        <>
          {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
          <FlatList
            data={items}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
            }
            ListEmptyComponent={
              <EmptyState
                title={unreadOnly ? t('notifications.allCaughtUp') : t('notifications.none')}
                description={unreadOnly ? undefined : t('notifications.noneBody')}
              />
            }
            renderItem={({ item }) => (
              <CardLink
                /*
                 * Whether it has been read is said in the label rather than
                 * only drawn as a dot, which a screen reader cannot see. The
                 * words come from the catalogue for the same reason the rest
                 * of the screen's do.
                 */
                accessibilityLabel={`${
                  item.readAt ? t('notifications.read') : t('notifications.unread')
                }: ${item.title}`}
                onPress={() => void open(item)}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: layout.space[2],
                  }}
                >
                  <Text
                    style={{
                      flexShrink: 1,
                      fontSize: layout.fontSize.base,
                      fontWeight: '600',
                      color: colour.text,
                    }}
                  >
                    {item.title}
                  </Text>
                  {item.readAt ? null : (
                    <View
                      style={{
                        width: layout.space[2],
                        height: layout.space[2],
                        borderRadius: layout.radius.full,
                        backgroundColor: colour.brand,
                      }}
                    />
                  )}
                </View>
                <Text style={{ color: colour.text }}>{item.body}</Text>
                <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                  {/* Was the raw enum — a shop owner read `FINANCE`. */}
                  {t(`notificationCategory.${item.category}`)} ·{' '}
                  {formatFinanceDateTime(item.createdAt)}
                </Text>
                <Button
                  variant="secondary"
                  label={t('notifications.archive')}
                  // Named, because "Archive" repeated down a list tells a screen
                  // reader nothing about which one it would remove.
                  accessibilityLabel={`${t('notifications.archive')}: ${item.title}`}
                  onPress={() => void archive(item)}
                />
              </CardLink>
            )}
          />
        </>
      )}
    </Screen>
  );
}
