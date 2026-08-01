import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { FinanceState, StatusBadge } from '../../src/finance/components';
import { apiErrorMessage, failPayment, getPayments, postPayment } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { formatMoneyMinor } from '../../src/finance/money';
import type { FinancePayment, ReferenceSnapshot } from '../../src/finance/types';

function reference(value?: string | ReferenceSnapshot) {
  return typeof value === 'string' ? value : value?.reference;
}

export default function CollectionReviewScreen() {
  const [items, setItems] = useState<FinancePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyId, setBusyId] = useState('');
  const [rejectingId, setRejectingId] = useState('');
  const [reason, setReason] = useState('');
  const actionKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    try {
      setItems(
        (
          await getPayments({
            status: 'PENDING',
            source: 'DELIVERY_COLLECTION',
            page: 1,
            limit: 100,
          })
        ).items,
      );
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load pending delivery collections.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function keyFor(action: string, id: string) {
    const index = `${action}:${id}`;
    const existing = actionKeys.current.get(index);
    if (existing) return existing;
    const next = createFinancialIdempotencyKey(action, id);
    actionKeys.current.set(index, next);
    return next;
  }

  async function approve(item: FinancePayment) {
    setBusyId(item._id);
    try {
      await postPayment(item._id, keyFor('post', item._id));
      actionKeys.current.delete(`post:${item._id}`);
      setSuccess(`${item.reference} posted successfully.`);
      setError('');
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Posting failed. Reconnect and retry safely.'));
    } finally {
      setBusyId('');
    }
  }

  async function reject(item: FinancePayment) {
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      setError('Enter at least three characters explaining the failed collection.');
      return;
    }
    setBusyId(item._id);
    try {
      await failPayment(item._id, cleanReason, keyFor('fail', item._id));
      actionKeys.current.delete(`fail:${item._id}`);
      setSuccess(`${item.reference} marked failed.`);
      setRejectingId('');
      setReason('');
      setError('');
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'The failure could not be recorded. Reconnect and retry.'));
    } finally {
      setBusyId('');
    }
  }

  if (loading) return <FinanceState loading />;
  if (!items.length && error) return <FinanceState error={error} onRetry={() => void load()} />;

  return (
    <View style={styles.screen}>
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
        ListEmptyComponent={<FinanceState empty="No delivery collections are awaiting review." />}
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
                Invoice {reference(item.invoiceId) ?? '—'} · Delivery{' '}
                {reference(item.deliveryId) ?? '—'}
              </Text>
              <Text style={styles.muted}>
                Collected {formatFinanceDate(item.collectionTime ?? item.createdAt)}
              </Text>
              {item.transactionReference ? (
                <Text>Transaction {item.transactionReference}</Text>
              ) : null}
              <Text style={styles.proof}>
                {item.attachmentFileId ? 'Payment proof attached' : 'No payment-proof attachment'}
              </Text>
            </Pressable>
            {rejectingId === item._id ? (
              <View style={styles.rejectBox}>
                <Text style={styles.label}>Failure reason</Text>
                <TextInput
                  style={styles.input}
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Required reason"
                  multiline
                  maxLength={500}
                />
                <View style={styles.actions}>
                  <Pressable
                    style={styles.secondary}
                    onPress={() => {
                      setRejectingId('');
                      setReason('');
                    }}
                  >
                    <Text>Cancel</Text>
                  </Pressable>
                  <Pressable
                    disabled={busyId === item._id}
                    style={styles.danger}
                    onPress={() => void reject(item)}
                  >
                    <Text style={styles.actionText}>
                      {busyId === item._id ? 'Saving…' : 'Confirm failure'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.actions}>
                <Pressable
                  style={styles.secondary}
                  onPress={() => {
                    setRejectingId(item._id);
                    setReason('');
                  }}
                >
                  <Text>Reject</Text>
                </Pressable>
                <Pressable
                  disabled={busyId === item._id}
                  style={styles.primary}
                  onPress={() =>
                    Alert.alert(
                      'Post collection?',
                      `Post ${formatMoneyMinor(item.amountMinor)} to the customer ledger? This cannot be edited silently.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Post', onPress: () => void approve(item) },
                      ],
                    )
                  }
                >
                  <Text style={styles.actionText}>
                    {busyId === item._id ? 'Posting…' : 'Verify and post'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  list: { padding: 14, gap: 10 },
  emptyList: { flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 15, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  reference: { color: '#126b45', fontWeight: '900', fontSize: 17 },
  amount: { color: '#173f2e', fontWeight: '900', fontSize: 22, marginTop: 5 },
  muted: { color: '#66756d', marginTop: 3 },
  proof: {
    color: '#274b3b',
    backgroundColor: '#eef6f1',
    padding: 7,
    borderRadius: 6,
    marginTop: 5,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  primary: {
    backgroundColor: '#126b45',
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  secondary: {
    backgroundColor: '#e6eee9',
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  danger: {
    backgroundColor: '#8b2525',
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  actionText: { color: '#fff', fontWeight: '900' },
  rejectBox: { gap: 7, borderTopWidth: 1, borderTopColor: '#e7ede9', paddingTop: 10 },
  label: { fontWeight: '800' },
  input: {
    borderWidth: 1,
    borderColor: '#bdcbc2',
    borderRadius: 8,
    padding: 10,
    minHeight: 65,
    textAlignVertical: 'top',
  },
  error: {
    color: '#8b2525',
    backgroundColor: '#fff0ee',
    padding: 10,
    margin: 14,
    marginBottom: 0,
    borderRadius: 8,
  },
  success: {
    color: '#126b45',
    backgroundColor: '#e9f7ef',
    padding: 10,
    margin: 14,
    marginBottom: 0,
    borderRadius: 8,
  },
});
