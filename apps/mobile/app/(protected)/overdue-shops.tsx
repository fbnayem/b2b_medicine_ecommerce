import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FinanceState, StatusBadge } from '../../src/finance/components';
import { apiErrorMessage, getOverdueShops } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import type { OverdueShop } from '../../src/finance/types';

export default function OverdueShopsScreen() {
  const [items, setItems] = useState<OverdueShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setItems((await getOverdueShops()).items);
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load overdue shops.'));
    } finally {
      setLoading(false);
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
        keyExtractor={(item) => item.shopId}
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
        ListEmptyComponent={<FinanceState empty="No shops currently have an overdue balance." />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.nameBlock}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.reference}>{item.reference}</Text>
              </View>
              <StatusBadge value={`${item.daysOverdue} DAYS`} />
            </View>
            <View style={styles.moneyRow}>
              <Amount label="Outstanding" amount={item.outstandingBalanceMinor} />
              <Amount label="Overdue" amount={item.overdueBalanceMinor} warning />
            </View>
            <Text style={styles.muted}>
              Oldest due date {formatFinanceDate(item.oldestDueDate)}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

function Amount({
  label,
  amount,
  warning = false,
}: {
  label: string;
  amount: number;
  warning?: boolean;
}) {
  return (
    <View>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text style={[styles.amount, warning && styles.warning]}>{formatMoneyMinor(amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  list: { padding: 14, gap: 10 },
  emptyList: { flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 15, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  nameBlock: { flex: 1 },
  name: { fontWeight: '900', fontSize: 17 },
  reference: { color: '#126b45', marginTop: 2 },
  moneyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e7ede9',
  },
  amountLabel: { color: '#66756d', fontSize: 11 },
  amount: { fontWeight: '900', marginTop: 3 },
  warning: { color: '#9b2c2c' },
  muted: { color: '#66756d' },
  error: {
    color: '#8b2525',
    backgroundColor: '#fff0ee',
    padding: 10,
    margin: 14,
    marginBottom: 0,
    borderRadius: 8,
  },
});
