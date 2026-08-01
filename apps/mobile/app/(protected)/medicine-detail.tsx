import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Medicine } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';

export default function MedicineDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<Medicine>();
  const [error, setError] = useState('');
  useEffect(() => {
    apiClient
      .get(`/inventory/medicines/${id}`)
      .then((response) => setItem(response.data.data))
      .catch((caught: Error) => setError(caught.message));
  }, [id]);
  if (error)
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  if (!item)
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading details…</Text>
      </View>
    );
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.reference}>
        {item.reference} · {item.sku}
      </Text>
      <Text style={styles.heading}>
        {item.brandName} {item.strength}
      </Text>
      <Text style={styles.sub}>
        {item.genericName} · {item.dosageForm}
      </Text>
      <View style={styles.panel}>
        {[
          ['Manufacturer', item.manufacturer],
          ['Pack size', item.packSize],
          ['Category', item.category],
          ['Classification', item.classification],
          ['Cold chain', item.coldChain ? 'Required' : 'No'],
          ['General availability', (item.totalAvailable ?? 0) > 0 ? 'Available' : 'Out of stock'],
        ].map(([label, value]) => (
          <View style={styles.detail} key={label}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
        <Text style={styles.price}>৳{(item.defaultSellingPriceMinor / 100).toFixed(2)}</Text>
      </View>
      {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 18 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  reference: { color: '#176b47', fontFamily: 'monospace' },
  heading: { fontSize: 28, fontWeight: '800', color: '#17211b', marginTop: 8 },
  sub: { color: '#607067', marginTop: 5, fontSize: 16 },
  panel: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginTop: 22,
    borderWidth: 1,
    borderColor: '#dce5df',
  },
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#edf1ee',
  },
  label: { color: '#718077' },
  value: { fontWeight: '600', flex: 1, textAlign: 'right' },
  price: { fontSize: 24, fontWeight: '800', color: '#126b45', marginTop: 20 },
  description: { lineHeight: 22, marginTop: 18, color: '#3e4b44' },
  error: { color: '#8b2525' },
});
