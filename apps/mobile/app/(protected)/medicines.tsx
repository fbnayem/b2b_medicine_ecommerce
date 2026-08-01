import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { UserRole } from '@medsupply/shared-types';
import type { Medicine } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';
import { useCart } from '../../src/store/useCart';
import { useAuthStore } from '../../src/store/useAuth';
export default function MedicinesScreen() {
  const add = useCart((state) => state.add);
  const user = useAuthStore((state) => state.user);
  const [items, setItems] = useState<Medicine[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        setItems(
          (
            await apiClient.get('/inventory/medicines', {
              params: { search: search.trim(), limit: 100 },
            })
          ).data.data,
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to load medicines');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 300);
    return () => clearTimeout(timer);
  }, [load]);
  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading medicines...</Text>
      </View>
    );
  return (
    <View style={styles.screen}>
      <TextInput
        accessibilityLabel="Search medicines"
        style={styles.search}
        placeholder="Brand, generic, manufacturer or SKU"
        value={search}
        onChangeText={setSearch}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item._id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text>No medicines found.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() =>
              router.push({ pathname: '/(protected)/medicine-detail', params: { id: item._id } })
            }
          >
            <View style={styles.row}>
              <Text style={styles.reference}>{item.reference}</Text>
              <Text>{item.totalAvailable ? 'Available' : 'Out of stock'}</Text>
            </View>
            <Text style={styles.title}>
              {item.brandName} {item.strength}
            </Text>
            <Text>
              {item.genericName} / {item.dosageForm}
            </Text>
            <Text style={styles.muted}>
              {item.manufacturer} / {item.packSize}
            </Text>
            <Text style={styles.price}>৳{(item.defaultSellingPriceMinor / 100).toFixed(2)}</Text>
            {user?.role === UserRole.SHOP_OWNER && (
              <Pressable
                style={styles.add}
                disabled={!item.totalAvailable}
                onPress={() => add(item)}
              >
                <Text style={styles.addText}>Add to cart</Text>
              </Pressable>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5', padding: 14 },
  search: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#c8d5cd',
    borderRadius: 10,
    padding: 13,
    marginBottom: 12,
  },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 13, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  reference: { color: '#126b45' },
  title: { fontSize: 18, fontWeight: '700', marginTop: 8 },
  muted: { color: '#718077', marginTop: 4 },
  price: { fontSize: 17, fontWeight: '700', color: '#126b45', marginTop: 10 },
  add: { backgroundColor: '#126b45', padding: 11, borderRadius: 8, marginTop: 12 },
  addText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#8b2525', padding: 10 },
});
