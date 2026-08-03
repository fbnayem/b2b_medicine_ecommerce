import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Medicine, MedicineBatch, StockMovementType } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';
import { formatFinanceDate } from '../../src/finance/date';

const actions: StockMovementType[] = [
  StockMovementType.ADDITION,
  StockMovementType.DAMAGE,
  StockMovementType.EXPIRY,
  StockMovementType.QUARANTINE,
  StockMovementType.QUARANTINE_RELEASE,
];
const idempotencyKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function InventoryScreen() {
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<MedicineBatch>();
  const [operation, setOperation] = useState<StockMovementType>(StockMovementType.ADDITION);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      refresh ? setRefreshing(true) : setLoading(true);
      setError('');
      try {
        setBatches(
          (await apiClient.get('/inventory/batches', { params: warning ? { warning } : {} })).data
            .data,
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to load inventory');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [warning],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function submitOperation() {
    if (
      !selected ||
      !Number.isInteger(Number(quantity)) ||
      Number(quantity) <= 0 ||
      reason.trim().length < 3
    ) {
      setError('Enter a positive whole quantity and a reason.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiClient.post(`/inventory/batches/${selected._id}/operations`, {
        type: operation,
        quantity: Number(quantity),
        reason: reason.trim(),
        idempotencyKey: idempotencyKey(),
      });
      setSelected(undefined);
      setQuantity('');
      setReason('');
      await load();
    } catch (caught: unknown) {
      setError(
        (caught as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Stock operation failed',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading inventory...</Text>
      </View>
    );
  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {[
          ['', 'All'],
          ['low-stock', 'Low'],
          ['near-expiry', 'Near expiry'],
          ['expired', 'Expired'],
        ].map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => setWarning(value)}
            style={[styles.tab, warning === value && styles.selected]}
          >
            <Text style={warning === value && styles.selectedText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <View style={styles.error}>
          <Text style={styles.danger}>{error}</Text>
          <Pressable onPress={() => void load()}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={batches}
        keyExtractor={(batch) => batch._id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text>No batches match this view.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const medicine = item.medicineId as Medicine;
          return (
            <View style={styles.card}>
              <View style={styles.row}>
                <View>
                  <Text style={styles.title}>{medicine.brandName}</Text>
                  <Text style={styles.muted}>
                    {item.batchNumber} / {item.warehouseLocation}
                  </Text>
                </View>
                {item.isBlocked ? <Text style={styles.danger}>Blocked</Text> : null}
              </View>
              <Text style={styles.expiry}>Expires {formatFinanceDate(item.expiryDate)}</Text>
              <View style={styles.quantities}>
                {[
                  ['On hand', item.quantities.onHand],
                  ['Available', item.quantities.available],
                  ['Reserved', item.quantities.reserved],
                  ['Picking', item.quantities.picking],
                ].map(([label, value]) => (
                  <View key={label}>
                    <Text style={styles.number}>{value}</Text>
                    <Text style={styles.muted}>{label}</Text>
                  </View>
                ))}
              </View>
              <Pressable style={styles.action} onPress={() => setSelected(item)}>
                <Text style={styles.actionText}>Stock action</Text>
              </Pressable>
            </View>
          );
        }}
      />
      <Modal
        transparent
        animationType="slide"
        visible={Boolean(selected)}
        onRequestClose={() => setSelected(undefined)}
      >
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.title}>Stock action: {selected?.batchNumber}</Text>
            <View style={styles.actionList}>
              {actions.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setOperation(item)}
                  style={[styles.choice, operation === item && styles.selected]}
                >
                  <Text style={operation === item && styles.selectedText}>
                    {item.replaceAll('_', ' ')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              placeholder="Quantity"
              value={quantity}
              onChangeText={setQuantity}
            />
            <TextInput
              style={styles.input}
              placeholder="Reason"
              value={reason}
              onChangeText={setReason}
            />
            <Pressable
              disabled={saving}
              style={styles.action}
              onPress={() => void submitOperation()}
            >
              <Text style={styles.actionText}>{saving ? 'Saving...' : 'Confirm action'}</Text>
            </Pressable>
            <Pressable style={styles.cancel} onPress={() => setSelected(undefined)}>
              <Text>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5', padding: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  tabs: { flexDirection: 'row', gap: 7, marginBottom: 12 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd8d0',
  },
  selected: { backgroundColor: '#183d2d' },
  selectedText: { color: '#fff' },
  card: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#dce5df',
    marginBottom: 10,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700' },
  muted: { color: '#718077', fontSize: 12 },
  danger: { color: '#9c2525', fontWeight: '700' },
  expiry: { marginTop: 12 },
  quantities: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: '#edf1ee',
  },
  number: { fontSize: 18, fontWeight: '800', color: '#126b45' },
  error: { padding: 12, backgroundColor: '#fff0ef', borderRadius: 10, marginBottom: 10 },
  retry: { fontWeight: '700', color: '#126b45', marginTop: 5 },
  action: { backgroundColor: '#126b45', borderRadius: 8, padding: 11, marginTop: 14 },
  actionText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.35)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  actionList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 16 },
  choice: { borderWidth: 1, borderColor: '#cbd8d0', padding: 8, borderRadius: 18 },
  input: { borderWidth: 1, borderColor: '#bdcbc2', borderRadius: 8, padding: 12, marginBottom: 10 },
  cancel: { alignItems: 'center', padding: 12 },
});
