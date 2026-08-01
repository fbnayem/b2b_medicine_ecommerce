import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { apiClient } from '../../src/api/client';

type PickingList = {
  _id: string;
  status: string;
  items: unknown[];
  orderId: { reference: string; shopId: { name: string } };
};

export default function FulfilmentScreen() {
  const [data, setData] = useState<PickingList[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData((await apiClient.get('/fulfilment/queue')).data.data);
      setError('');
    } catch {
      setError('Unable to load queue. Pull down to retry.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
            <Text>No fulfilment work.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={styles.card}
            onPress={() =>
              router.push({ pathname: '/(protected)/picking', params: { id: item._id } })
            }
          >
            <View style={styles.row}>
              <Text style={styles.title}>{item.orderId.reference}</Text>
              <Text>{item.status.replaceAll('_', ' ')}</Text>
            </View>
            <Text>{item.orderId.shopId.name}</Text>
            <Text>{item.items.length} batch line(s)</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5', padding: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 11, marginBottom: 9 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontWeight: '700' },
  error: { color: '#8b2525', padding: 10 },
});
