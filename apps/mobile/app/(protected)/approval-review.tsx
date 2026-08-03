import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import type { Order, Shop } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';
import { formatMoneyMinor } from '../../src/finance/money';
type Line = {
  orderItemId: string;
  approvedQuantity: number;
  unitPriceMinor: number;
  lineDiscountMinor: number;
};
export default function ApprovalReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order>();
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  async function load() {
    try {
      const value = (await apiClient.get(`/approvals/${id}`)).data.data.order;
      setOrder(value);
      setLines(
        value.items.map(
          (item: { _id: string; requestedQuantity: number; estimatedUnitPriceMinor: number }) => ({
            orderItemId: item._id,
            approvedQuantity: item.requestedQuantity,
            unitPriceMinor: item.estimatedUnitPriceMinor,
            lineDiscountMinor: 0,
          }),
        ),
      );
    } catch {
      setError('Unable to load review.');
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function action(name: 'start' | 'approve' | 'hold' | 'reject') {
    if (!order) return;
    try {
      let body: Record<string, unknown> = { version: order.version };
      if (name === 'approve')
        body = {
          ...body,
          lines,
          orderDiscountMinor: 0,
          deliveryChargeMinor: 0,
          shopOwnerNotes: note || undefined,
          creditOverride: false,
        };
      else if (name !== 'start')
        body = { ...body, reason: note || `${name} requested`, shopOwnerNotes: note || undefined };
      await apiClient.post(`/approvals/${id}/${name}`, body);
      Alert.alert('Success', `${name} completed`);
      router.back();
    } catch (caught: unknown) {
      setError(
        (caught as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Action failed',
      );
    }
  }
  if (!order)
    return (
      <View style={s.center}>
        <Text>{error || 'Loading...'}</Text>
      </View>
    );
  const shop = order.shopId as Shop;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.ref}>{order.reference}</Text>
      <Text style={s.heading}>{shop.name}</Text>
      <Text>Status: {order.status.replaceAll('_', ' ')}</Text>
      <Text>Credit: {formatMoneyMinor(shop.creditLimit - shop.outstandingBalance)}</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {order.items.map((item, index) => (
        <View style={s.card} key={item.medicineId}>
          <Text style={s.title}>{item.medicineSnapshot.brandName}</Text>
          <Text>Requested: {item.requestedQuantity}</Text>
          <TextInput
            style={s.input}
            keyboardType="number-pad"
            value={String(lines[index]?.approvedQuantity ?? 0)}
            onChangeText={(value) =>
              setLines((current) =>
                current.map((line, i) =>
                  i === index ? { ...line, approvedQuantity: Number(value) } : line,
                ),
              )
            }
          />
        </View>
      ))}
      <TextInput
        style={s.notes}
        placeholder="Manager / Shop Owner note"
        multiline
        value={note}
        onChangeText={setNote}
      />
      <Pressable style={s.primary} onPress={() => void action('approve')}>
        <Text style={s.primaryText}>Approve selected quantities</Text>
      </Pressable>
      <View style={s.row}>
        <Pressable style={s.secondary} onPress={() => void action('start')}>
          <Text>Start review</Text>
        </Pressable>
        <Pressable style={s.secondary} onPress={() => void action('hold')}>
          <Text>Hold</Text>
        </Pressable>
        <Pressable style={s.secondary} onPress={() => void action('reject')}>
          <Text>Reject</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  ref: { color: '#126b45' },
  heading: { fontSize: 24, fontWeight: '800', marginVertical: 8 },
  card: { backgroundColor: '#fff', padding: 14, borderRadius: 10, marginTop: 10 },
  title: { fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#bdcbc2', borderRadius: 8, padding: 9, marginTop: 8 },
  notes: { backgroundColor: '#fff', minHeight: 80, padding: 12, marginTop: 15, borderRadius: 9 },
  primary: { backgroundColor: '#126b45', padding: 14, borderRadius: 9, marginTop: 15 },
  primaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  secondary: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginTop: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  error: { color: '#8b2525', padding: 10 },
});
