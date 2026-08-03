import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { DeliveryStatus } from '@medsupply/shared-types';
import type { Delivery } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';
import { formatFinanceDate } from '../../src/finance/date';
import {
  cacheAssignedDeliveries,
  loadCachedDeliveries,
  loadDeliveryQueue,
  syncDeliveryQueue,
} from '../../src/delivery/offlineQueue';

const activeStatuses = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.HANDED_OVER,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.OUT_FOR_DELIVERY,
  DeliveryStatus.ARRIVED,
  DeliveryStatus.FAILED,
  DeliveryStatus.RETURNING,
] as DeliveryStatus[];

export default function DeliveriesScreen() {
  const [data, setData] = useState<Delivery[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [unsynced, setUnsynced] = useState(0);
  const load = useCallback(async () => {
    try {
      await syncDeliveryQueue();
      const values: Delivery[] = (await apiClient.get('/deliveries')).data.data;
      setData(values.filter((delivery) => activeStatuses.includes(delivery.status)));
      await cacheAssignedDeliveries(values);
      setOffline(false);
      setError('');
    } catch {
      const cached = await loadCachedDeliveries();
      setData(cached.filter((delivery) => activeStatuses.includes(delivery.status)));
      setOffline(true);
      setError('Offline: showing the last downloaded assignments.');
    } finally {
      setUnsynced((await loadDeliveryQueue()).length);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.warning}>{error}</Text> : null}
      {unsynced ? (
        <Pressable style={styles.unsynced} onPress={() => void load()}>
          <Text style={styles.unsyncedText}>{unsynced} unsynced action(s) · Tap to retry</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={data}
        keyExtractor={(item) => item._id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text>{offline ? 'No cached assignments.' : 'No active deliveries assigned.'}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const shop = typeof item.shopId === 'string' ? undefined : item.shopId;
          const pack = typeof item.packageId === 'string' ? undefined : item.packageId;
          return (
            <Pressable
              accessibilityRole="button"
              style={styles.card}
              onPress={() =>
                router.push({ pathname: '/(protected)/delivery-detail', params: { id: item._id } })
              }
            >
              <View style={styles.row}>
                <Text style={styles.title}>{item.reference}</Text>
                <Text style={styles.status}>{item.status.replaceAll('_', ' ')}</Text>
              </View>
              <Text style={styles.shop}>{shop?.name ?? item.contactSnapshot.name}</Text>
              <Text>
                {pack?.reference} · {pack?.packageCount ?? ''} package(s)
              </Text>
              <Text>
                {item.addressSnapshot.line1}, {item.addressSnapshot.city}
              </Text>
              {item.expectedDeliveryDate ? (
                <Text style={styles.muted}>
                  Expected {formatFinanceDate(item.expectedDeliveryDate)}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5', padding: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 10, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  title: { fontWeight: '800', color: '#126b45' },
  status: { fontSize: 11, color: '#33483d' },
  shop: { fontWeight: '700', fontSize: 17 },
  muted: { color: '#6b7d73' },
  warning: {
    color: '#7b5311',
    backgroundColor: '#fff4d6',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  unsynced: { backgroundColor: '#713b18', padding: 10, borderRadius: 8, marginBottom: 8 },
  unsyncedText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
});
