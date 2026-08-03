import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { RealtimeEvent, type NotificationRecord } from '@medsupply/shared-types';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from '../../../src/notifications/api';
import { onRealtime } from '../../../src/notifications/realtime';
import { routeForPush } from '../../../src/notifications/push';
import { formatFinanceDateTime } from '../../../src/finance/date';

export default function NotificationsScreen() {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        const page = await fetchNotifications(1, unreadOnly);
        setItems(page.items);
        setError('');
      } catch {
        setError('Unable to load notifications.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [unreadOnly],
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

  const readAll = async () => {
    setStatus('Marking all as read...');
    try {
      await markAllNotificationsRead();
      await load(true);
      setStatus('All notifications marked as read.');
    } catch {
      setStatus('');
      setError('Unable to mark notifications as read.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading notifications...</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.secondary} onPress={() => void load()}>
            <Text style={styles.secondaryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {status ? <Text style={styles.success}>{status}</Text> : null}

      <View style={styles.toolbar}>
        <Pressable
          style={[styles.filter, unreadOnly ? styles.filterActive : null]}
          onPress={() => setUnreadOnly((value) => !value)}
        >
          <Text style={unreadOnly ? styles.filterActiveText : styles.filterText}>Unread only</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => void readAll()}>
          <Text style={styles.secondaryText}>Mark all read</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={() => router.push('/(protected)/notification-preferences')}
        >
          <Text style={styles.secondaryText}>Preferences</Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item._id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text>
              {unreadOnly ? 'You have read everything.' : 'No notifications have arrived yet.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, item.readAt ? null : styles.unread]}
            onPress={() => void open(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.readAt ? 'Read' : 'Unread'}: ${item.title}`}
          >
            <View style={styles.row}>
              <Text style={styles.title}>{item.title}</Text>
              {item.readAt ? null : <View style={styles.dot} />}
            </View>
            <Text>{item.body}</Text>
            <Text style={styles.muted}>
              {item.category} · {formatFinanceDateTime(item.createdAt)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5', padding: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filter: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d9e3dd',
  },
  filterActive: { backgroundColor: '#16724a', borderColor: '#16724a' },
  filterText: { color: '#17211b', fontWeight: '600' },
  filterActiveText: { color: '#fff', fontWeight: '700' },
  secondary: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d9e3dd',
  },
  secondaryText: { color: '#16724a', fontWeight: '700' },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 10 },
  unread: { borderLeftWidth: 4, borderLeftColor: '#16724a' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontWeight: '700', fontSize: 16, flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#16724a', marginLeft: 10 },
  muted: { color: '#718077', marginTop: 6 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 10 },
  error: { color: '#8b2525', flexShrink: 1 },
  success: { color: '#16724a', paddingBottom: 10 },
});
