import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { apiClient } from '../../src/api/client';
import { useCart } from '../../src/store/useCart';
import { formatMoneyMinor } from '../../src/finance/money';
export default function CartScreen() {
  const { items, quantity, remove, draftId, recover } = useCart();
  async function save() {
    try {
      const body = {
        items: items.map((item) => ({
          medicineId: item.medicine._id,
          requestedQuantity: item.quantity,
        })),
      };
      const response = draftId
        ? await apiClient.patch(`/orders/drafts/${draftId}`, body)
        : await apiClient.post('/orders/drafts', body);
      recover(items, response.data.data._id);
      Alert.alert('Saved', 'Draft saved successfully.');
    } catch (caught: unknown) {
      Alert.alert(
        'Unable to save',
        (caught as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Try again.',
      );
    }
  }
  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.medicine._id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.title}>Your cart is empty</Text>
            <Pressable onPress={() => router.push('/(protected)/medicines')}>
              <Text style={styles.link}>Browse medicines</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>
              {item.medicine.brandName} {item.medicine.strength}
            </Text>
            <Text>{formatMoneyMinor(item.medicine.defaultSellingPriceMinor)} each</Text>
            <TextInput
              accessibilityLabel={`Quantity for ${item.medicine.brandName}`}
              style={styles.input}
              keyboardType="number-pad"
              value={String(item.quantity)}
              onChangeText={(value) => quantity(item.medicine._id, Number(value))}
            />
            <Pressable onPress={() => remove(item.medicine._id)}>
              <Text style={styles.danger}>Remove</Text>
            </Pressable>
          </View>
        )}
      />
      {items.length > 0 && (
        <View style={styles.actions}>
          <Pressable style={styles.secondary} onPress={() => void save()}>
            <Text>Save draft</Text>
          </Pressable>
          <Pressable style={styles.primary} onPress={() => router.push('/(protected)/checkout')}>
            <Text style={styles.primaryText}>Checkout</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5', padding: 14 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 10 },
  title: { fontWeight: '700', fontSize: 17 },
  input: {
    borderWidth: 1,
    borderColor: '#bdcbc2',
    borderRadius: 8,
    padding: 9,
    marginVertical: 10,
  },
  danger: { color: '#9b2929' },
  empty: { alignItems: 'center', padding: 40, gap: 12 },
  link: { color: '#126b45', fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10 },
  primary: { flex: 1, backgroundColor: '#126b45', padding: 14, borderRadius: 9 },
  primaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  secondary: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 9,
    alignItems: 'center',
  },
});
