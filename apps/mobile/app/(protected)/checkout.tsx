import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { PaymentMethod } from '@medsupply/shared-types';
import type { Shop } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';
import { useCart } from '../../src/store/useCart';
export default function CheckoutScreen() {
  const { items, draftId, clear } = useCart();
  const [shop, setShop] = useState<Shop>();
  const [addressId, setAddressId] = useState('');
  const [payment, setPayment] = useState<(typeof PaymentMethod)[keyof typeof PaymentMethod]>(
    PaymentMethod.CASH,
  );
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    apiClient
      .get('/shops/my')
      .then((response) => {
        const value = response.data.data[0];
        setShop(value);
        const address = value?.deliveryAddresses?.[0];
        setAddressId(address?._id ?? '');
      })
      .catch(() => setError('Unable to load delivery addresses.'))
      .finally(() => setLoading(false));
  }, []);
  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const body = {
        items: items.map((item) => ({
          medicineId: item.medicine._id,
          requestedQuantity: item.quantity,
        })),
        deliveryAddressId: addressId,
        requestedPaymentMethod: payment,
        shopNotes: notes || undefined,
        idempotencyKey: `${Date.now()}-${Math.random()}`,
      };
      const response = await apiClient.post(
        draftId ? `/orders/drafts/${draftId}/submit` : '/orders/submit',
        body,
      );
      clear();
      router.replace({
        pathname: '/(protected)/order-detail',
        params: { id: response.data.data._id, submitted: '1' },
      });
    } catch (caught: unknown) {
      setError(
        (caught as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Submission failed.',
      );
    } finally {
      setSubmitting(false);
    }
  }
  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.label}>Delivery address</Text>
      {shop?.deliveryAddresses.map((address) => {
        const id = (address as typeof address & { _id: string })._id;
        return (
          <Pressable
            key={id}
            style={[styles.choice, addressId === id && styles.selected]}
            onPress={() => setAddressId(id)}
          >
            <Text>
              {address.label}: {address.line1}, {address.city}
            </Text>
          </Pressable>
        );
      })}
      <Text style={styles.label}>Payment method</Text>
      {Object.values(PaymentMethod).map((value) => (
        <Pressable
          key={value}
          style={[styles.choice, payment === value && styles.selected]}
          onPress={() => setPayment(value)}
        >
          <Text>{value.replaceAll('_', ' ')}</Text>
        </Pressable>
      ))}
      <Text style={styles.label}>Delivery notes</Text>
      <TextInput style={styles.input} multiline value={notes} onChangeText={setNotes} />
      <Pressable
        disabled={submitting || !addressId}
        style={styles.primary}
        onPress={() => void submit()}
      >
        <Text style={styles.primaryText}>
          {submitting ? 'Submitting...' : 'Submit order request'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center' },
  label: { fontWeight: '700', marginTop: 18, marginBottom: 7 },
  choice: {
    backgroundColor: '#fff',
    padding: 13,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#d8e1dc',
    marginBottom: 7,
  },
  selected: { borderColor: '#126b45', backgroundColor: '#e9f6ef' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#bdcbc2',
    borderRadius: 9,
    minHeight: 80,
    padding: 12,
  },
  primary: { backgroundColor: '#126b45', padding: 15, borderRadius: 9, marginTop: 24 },
  primaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  error: { color: '#8b2525', backgroundColor: '#fff0ef', padding: 12 },
});
