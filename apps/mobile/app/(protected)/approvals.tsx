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
import type { Order, Shop } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';
export default function ApprovalsScreen() {
  const [data, setData] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      setData((await apiClient.get('/approvals/queue')).data.data);
      setError('');
    } catch {
      setError('Unable to load approvals.');
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
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  return (
    <View style={s.screen}>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <FlatList
        data={data}
        keyExtractor={(item) => item._id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
        ListEmptyComponent={
          <View style={s.center}>
            <Text>No approvals waiting.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const shop = item.shopId as Shop;
          return (
            <Pressable
              style={s.card}
              onPress={() =>
                router.push({ pathname: '/(protected)/approval-review', params: { id: item._id } })
              }
            >
              <View style={s.row}>
                <Text style={s.title}>{item.reference}</Text>
                <Text>{item.status.replaceAll('_', ' ')}</Text>
              </View>
              <Text>{shop.name}</Text>
              <Text>৳{(item.estimatedTotalMinor / 100).toFixed(2)}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5', padding: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 9 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontWeight: '700' },
  error: { color: '#8b2525', padding: 12 },
});
