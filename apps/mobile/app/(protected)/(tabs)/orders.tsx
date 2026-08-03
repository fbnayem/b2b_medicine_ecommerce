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
import type { Order } from '@medsupply/shared-types';
import { apiClient } from '../../../src/api/client';
import { formatMoneyMinor } from '../../../src/finance/money';
import { formatFinanceDate } from '../../../src/finance/date';
export default function OrdersScreen() {
  const [data, setData] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      setData((await apiClient.get('/orders')).data.data);
      setError('');
    } catch {
      setError('Unable to load orders.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={data}
        keyExtractor={(item) => item._id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text>No orders yet.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() =>
              router.push({ pathname: '/(protected)/order-detail', params: { id: item._id } })
            }
          >
            <View style={styles.row}>
              <Text style={styles.title}>{item.reference}</Text>
              <Text>{item.status.replaceAll('_', ' ')}</Text>
            </View>
            <Text>
              {item.items.length} items / {formatMoneyMinor(item.estimatedTotalMinor)}
            </Text>
            <Text style={styles.muted}>{formatFinanceDate(item.createdAt)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5', padding: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontWeight: '700', fontSize: 17 },
  muted: { color: '#718077', marginTop: 6 },
  error: { color: '#8b2525', padding: 12 },
});
