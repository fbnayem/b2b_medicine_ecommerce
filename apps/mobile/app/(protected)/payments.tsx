import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { FinanceState, StatusBadge } from '../../src/finance/components';
import { apiErrorMessage, getPayments } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import type { FinancePayment } from '../../src/finance/types';

export default function PaymentsScreen() {
  const [items, setItems] = useState<FinancePayment[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (targetPage = 1, append = false) => {
    try {
      const result = await getPayments({ page: targetPage, limit: 30 });
      setItems((current) => (append ? [...current, ...result.items] : result.items));
      setPage(result.page);
      setPages(result.pages);
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load payment history.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <FinanceState loading />;
  if (!items.length && error) return <FinanceState error={error} onRetry={() => void load()} />;

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
        ListEmptyComponent={<FinanceState empty="No payment records yet." />}
        ListFooterComponent={
          page < pages ? (
            <Pressable
              disabled={loadingMore}
              style={styles.more}
              onPress={() => {
                setLoadingMore(true);
                void load(page + 1, true);
              }}
            >
              <Text style={styles.moreText}>{loadingMore ? 'Loading…' : 'Load more'}</Text>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={styles.card}
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
            <Text style={styles.muted}>
              {formatFinanceDate(item.postingTime ?? item.collectionTime ?? item.createdAt)}
            </Text>
            {item.receiptReference ? <Text>Receipt {item.receiptReference}</Text> : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  list: { padding: 14, gap: 10 },
  emptyList: { flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 15, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  reference: { color: '#126b45', fontWeight: '900', fontSize: 17 },
  amount: { fontWeight: '900', fontSize: 21, color: '#173f2e' },
  muted: { color: '#66756d' },
  error: {
    color: '#8b2525',
    backgroundColor: '#fff0ee',
    padding: 10,
    margin: 14,
    marginBottom: 0,
    borderRadius: 8,
  },
  more: { padding: 13, alignItems: 'center' },
  moreText: { color: '#126b45', fontWeight: '800' },
});
