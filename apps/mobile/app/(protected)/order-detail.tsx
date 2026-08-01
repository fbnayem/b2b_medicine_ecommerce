import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Order } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';
import { ActivityTimelineView } from '../../src/notifications/ActivityTimelineView';
export default function OrderDetailScreen() {
  const { id, submitted } = useLocalSearchParams<{ id: string; submitted?: string }>();
  const [order, setOrder] = useState<Order>();
  const [error, setError] = useState('');
  useEffect(() => {
    apiClient
      .get(`/orders/${id}`)
      .then((response) => setOrder(response.data.data))
      .catch(() => setError('Unable to load order.'));
  }, [id]);
  if (!order && !error)
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  if (error)
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {submitted ? <Text style={styles.success}>Order submitted successfully</Text> : null}
      <Text style={styles.reference}>{order!.reference}</Text>
      <Text style={styles.heading}>{order!.status.replaceAll('_', ' ')}</Text>
      <View style={styles.panel}>
        {order!.items.map((item) => (
          <View style={styles.row} key={item.medicineId}>
            <View>
              <Text style={styles.title}>{item.medicineSnapshot.brandName}</Text>
              <Text>
                {item.requestedQuantity} x ৳{(item.estimatedUnitPriceMinor / 100).toFixed(2)}
              </Text>
            </View>
            <Text style={styles.title}>৳{(item.estimatedLineTotalMinor / 100).toFixed(2)}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.title}>Estimated total</Text>
          <Text style={styles.title}>৳{(order!.estimatedTotalMinor / 100).toFixed(2)}</Text>
        </View>
      </View>
      <Text style={styles.heading}>Status timeline</Text>
      {order!.statusHistory.map((entry, index) => (
        <View style={styles.timeline} key={`${entry.to}-${index}`}>
          <Text style={styles.title}>{entry.to.replaceAll('_', ' ')}</Text>
          <Text>{new Date(entry.at).toLocaleString('en-BD')}</Text>
        </View>
      ))}
      <ActivityTimelineView
        entityType="Order"
        entityId={String(order!._id)}
        title="Order activity"
      />
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  success: { backgroundColor: '#e6f7ed', color: '#126b45', padding: 12, borderRadius: 9 },
  reference: { color: '#126b45', marginTop: 18 },
  heading: { fontSize: 23, fontWeight: '800', marginVertical: 10 },
  panel: { backgroundColor: '#fff', padding: 15, borderRadius: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#edf1ee',
  },
  title: { fontWeight: '700' },
  timeline: { backgroundColor: '#fff', padding: 13, borderRadius: 9, marginBottom: 8 },
  error: { color: '#8b2525' },
});
