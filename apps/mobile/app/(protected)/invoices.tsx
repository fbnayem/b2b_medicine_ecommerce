import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FinanceState, StatusBadge } from '../../src/finance/components';
import { apiErrorMessage, getMyInvoices } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import type { FinanceInvoice } from '../../src/finance/types';

export default function InvoicesScreen() {
  const [items, setItems] = useState<FinanceInvoice[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (targetPage = 1, append = false) => {
    try {
      const result = await getMyInvoices(targetPage);
      setItems((current) => (append ? [...current, ...result.items] : result.items));
      setPage(result.page);
      setPages(result.pages);
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load invoices.'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
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
        ListEmptyComponent={<FinanceState empty="No invoices have been issued yet." />}
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
        renderItem={({ item }) => {
          const overdue = item.amountDueMinor > 0 && new Date(item.dueDate).getTime() < Date.now();
          return (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.reference}>{item.reference}</Text>
                <StatusBadge value={overdue ? 'OVERDUE' : item.status} />
              </View>
              <Text>Issued {formatFinanceDate(item.invoiceDate)}</Text>
              <Text>Due {formatFinanceDate(item.dueDate)}</Text>
              <View style={styles.amounts}>
                <Amount label="Total" value={item.grandTotalMinor} />
                <Amount label="Paid" value={item.amountPaidMinor} />
                <Amount label="Due" value={item.amountDueMinor} warning={item.amountDueMinor > 0} />
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

function Amount({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <View>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text style={[styles.amount, warning && styles.due]}>{formatMoneyMinor(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  list: { padding: 14, gap: 10 },
  emptyList: { flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 15, gap: 7 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  reference: { color: '#126b45', fontWeight: '900', fontSize: 17 },
  amounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 7,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: '#e7ede9',
  },
  amountLabel: { color: '#66756d', fontSize: 11 },
  amount: { fontWeight: '800', marginTop: 3 },
  due: { color: '#9b2c2c' },
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
