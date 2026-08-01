import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { FinanceState, StatusBadge } from '../../src/finance/components';
import { apiErrorMessage, getMyCollections, handoverPayment } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { formatMoneyMinor } from '../../src/finance/money';
import type { CollectionSummary, FinancePayment, ReferenceSnapshot } from '../../src/finance/types';

function reference(value?: string | ReferenceSnapshot) {
  return typeof value === 'string' ? value : value?.reference;
}

export default function CollectionsScreen() {
  const [items, setItems] = useState<FinancePayment[]>([]);
  const [summary, setSummary] = useState<CollectionSummary>({
    todayCollectedMinor: 0,
    pendingHandoverMinor: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const handoverKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    try {
      const result = await getMyCollections(1, 100);
      setItems(result.items);
      setSummary(result.summary);
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load your collection history.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handover(item: FinancePayment) {
    let key = handoverKeys.current.get(item._id);
    if (!key) {
      key = createFinancialIdempotencyKey('handover', item._id);
      handoverKeys.current.set(item._id, key);
    }
    setBusyId(item._id);
    try {
      await handoverPayment(item._id, key);
      handoverKeys.current.delete(item._id);
      setSuccess(`${item.reference} handover submitted and confirmed by the server.`);
      setError('');
      await load();
    } catch (caught) {
      setError(
        apiErrorMessage(caught, 'Handover requires a server connection. Reconnect and retry.'),
      );
    } finally {
      setBusyId('');
    }
  }

  if (loading) return <FinanceState loading />;
  if (!items.length && error) return <FinanceState error={error} onRetry={() => void load()} />;

  return (
    <View style={styles.screen}>
      <View style={styles.summaryRow}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Collected today</Text>
          <Text style={styles.metricValue}>{formatMoneyMinor(summary.todayCollectedMinor)}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Pending handover</Text>
          <Text style={styles.metricValue}>{formatMoneyMinor(summary.pendingHandoverMinor)}</Text>
          {summary.pendingHandoverCount !== undefined ? (
            <Text style={styles.metricCount}>{summary.pendingHandoverCount} record(s)</Text>
          ) : null}
        </View>
      </View>
      <Text style={styles.timeNotice}>Today uses the server’s Asia/Dhaka business date.</Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item._id}
        contentContainerStyle={items.length ? styles.list : styles.emptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        ListEmptyComponent={<FinanceState empty="No collections have been recorded yet." />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: '/(protected)/payment-detail', params: { id: item._id } })
              }
            >
              <View style={styles.row}>
                <Text style={styles.reference}>{item.reference}</Text>
                <StatusBadge value={item.status} />
              </View>
              <Text style={styles.amount}>{formatMoneyMinor(item.amountMinor)}</Text>
              <Text>{item.method.replaceAll('_', ' ')}</Text>
              <Text>
                Delivery {reference(item.deliveryId) ?? '—'} · Invoice{' '}
                {reference(item.invoiceId) ?? '—'}
              </Text>
              <Text style={styles.muted}>
                {formatFinanceDate(item.collectionTime ?? item.createdAt)}
              </Text>
              <Text style={styles.handover}>
                Handover: {(item.handoverStatus ?? 'NOT REQUIRED').replaceAll('_', ' ')}
              </Text>
            </Pressable>
            {item.handoverStatus === 'PENDING' ? (
              <Pressable
                disabled={busyId === item._id}
                style={styles.action}
                onPress={() =>
                  Alert.alert(
                    'Confirm collection handover?',
                    `Submit handover of ${formatMoneyMinor(item.amountMinor)} for ${item.reference}?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Confirm', onPress: () => void handover(item) },
                    ],
                  )
                }
              >
                <Text style={styles.actionText}>
                  {busyId === item._id ? 'Confirming…' : 'Confirm handover'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  summaryRow: { flexDirection: 'row', gap: 10, padding: 14, paddingBottom: 7 },
  metric: { flex: 1, backgroundColor: '#fff', borderRadius: 11, padding: 13 },
  metricLabel: { color: '#66756d', fontSize: 11 },
  metricValue: { color: '#173f2e', fontWeight: '900', fontSize: 18, marginTop: 4 },
  metricCount: { color: '#66756d', fontSize: 11, marginTop: 3 },
  timeNotice: { color: '#66756d', textAlign: 'center', fontSize: 12, paddingBottom: 6 },
  list: { padding: 14, gap: 10 },
  emptyList: { flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 15, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  reference: { color: '#126b45', fontWeight: '900', fontSize: 17 },
  amount: { color: '#173f2e', fontWeight: '900', fontSize: 22, marginTop: 5 },
  muted: { color: '#66756d', marginTop: 3 },
  handover: {
    backgroundColor: '#eef6f1',
    color: '#274b3b',
    borderRadius: 6,
    padding: 7,
    marginTop: 6,
  },
  action: { backgroundColor: '#126b45', padding: 12, borderRadius: 8 },
  actionText: { color: '#fff', textAlign: 'center', fontWeight: '900' },
  error: {
    color: '#8b2525',
    backgroundColor: '#fff0ee',
    padding: 10,
    marginHorizontal: 14,
    borderRadius: 8,
  },
  success: {
    color: '#126b45',
    backgroundColor: '#e9f7ef',
    padding: 10,
    marginHorizontal: 14,
    borderRadius: 8,
  },
});
