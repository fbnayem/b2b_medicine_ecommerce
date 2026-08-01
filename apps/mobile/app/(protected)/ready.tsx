import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../src/api/client';

type ReadyPackage = {
  _id: string;
  reference: string;
  barcode: string;
  packageCount: number;
  orderId: { reference: string };
  invoiceId: { reference: string; grandTotalMinor: number };
};

export default function ReadyScreen() {
  const [data, setData] = useState<ReadyPackage[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setData((await apiClient.get('/fulfilment/ready')).data.data);
      setError('');
    } catch {
      setError('Unable to load ready packages. Pull down to retry.');
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
            <Text>No packages ready.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>{item.reference}</Text>
            <Text>{item.orderId.reference}</Text>
            <Text>
              {item.invoiceId.reference} · ৳{(item.invoiceId.grandTotalMinor / 100).toFixed(2)}
            </Text>
            <Text style={styles.barcode}>{item.barcode}</Text>
            <Text>{item.packageCount} package(s)</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5', padding: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 11, marginBottom: 9 },
  title: { fontWeight: '800', color: '#126b45' },
  barcode: { fontFamily: 'monospace', marginTop: 7 },
  error: { color: '#8b2525', padding: 10 },
});
