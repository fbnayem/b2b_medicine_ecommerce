import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { UserRole } from '@medsupply/shared-types';
import { FinanceState } from '../../../src/finance/components';
import { apiErrorMessage } from '../../../src/finance/api';
import { formatFinanceDate } from '../../../src/finance/date';
import { formatMoneyMinor } from '../../../src/finance/money';
import { getReturns, returnStatusLabel, type ReturnSummary } from '../../../src/returns/api';
import { useAuthStore } from '../../../src/store/useAuth';

const named = (value: ReturnSummary['shopId']) =>
  typeof value === 'object' && value ? value : undefined;

/** Each role opens on the queue it actually works, not the full list. */
function defaultStatus(role?: UserRole) {
  if (role === UserRole.STOREKEEPER) return 'COLLECTED';
  if (role === UserRole.DELIVERY_PERSON) return 'APPROVED';
  return '';
}

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'COLLECTED', label: 'Collected' },
  { value: 'RECEIVED', label: 'Awaiting credit' },
  { value: 'COMPLETED', label: 'Completed' },
];

export default function ReturnsScreen() {
  const role = useAuthStore((state) => state.user?.role);
  const [items, setItems] = useState<ReturnSummary[]>([]);
  const [status, setStatus] = useState(() => defaultStatus(role));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await getReturns({ limit: 50, ...(status ? { status } : {}) });
      setItems(result.items);
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load returns.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <FinanceState loading />;
  if (!items.length && error) return <FinanceState error={error} onRetry={() => void load()} />;

  return (
    <View style={styles.screen}>
      <View style={styles.filters}>
        {FILTERS.map((filter) => (
          <Pressable
            accessibilityRole="button"
            key={filter.value || 'all'}
            style={[styles.filter, status === filter.value ? styles.filterActive : null]}
            onPress={() => {
              setLoading(true);
              setStatus(filter.value);
            }}
          >
            <Text style={status === filter.value ? styles.filterTextActive : styles.filterText}>
              {filter.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
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
        ListEmptyComponent={
          <FinanceState
            empty={status ? 'No returns are in this state.' : 'No returns have been requested yet.'}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={styles.card}
            onPress={() =>
              router.push({ pathname: '/(protected)/return-detail', params: { id: item._id } })
            }
          >
            <View style={styles.row}>
              <Text style={styles.reference}>{item.reference}</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{returnStatusLabel(item.status)}</Text>
              </View>
            </View>
            <Text style={styles.amount}>
              {formatMoneyMinor(
                item.approvedTotalMinor > 0 ? item.approvedTotalMinor : item.requestedTotalMinor,
              )}
            </Text>
            {role === UserRole.SHOP_OWNER ? null : (
              <Text>{named(item.shopId)?.name ?? 'Unknown shop'}</Text>
            )}
            <Text>Invoice {named(item.invoiceId)?.reference ?? '—'}</Text>
            <Text style={styles.muted}>
              {item.primaryReason.replaceAll('_', ' ').toLowerCase()} ·{' '}
              {formatFinanceDate(item.requestedAt)}
            </Text>
            {item.creditNoteReference ? (
              <Text style={styles.credit}>Credit note {item.creditNoteReference}</Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, padding: 12 },
  filter: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: '#fff' },
  filterActive: { backgroundColor: '#126b45' },
  filterText: { color: '#274b3b', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#fff', fontSize: 12, fontWeight: '700' },
  list: { padding: 14, gap: 10 },
  emptyList: { flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 15, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  reference: { color: '#126b45', fontWeight: '900', fontSize: 17 },
  amount: { color: '#173f2e', fontWeight: '900', fontSize: 21, marginTop: 3 },
  badge: {
    backgroundColor: '#eef6f1',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: { color: '#274b3b', fontSize: 11, fontWeight: '700' },
  muted: { color: '#66756d', marginTop: 3 },
  credit: { color: '#126b45', fontWeight: '700', marginTop: 4 },
  error: {
    color: '#8b2525',
    backgroundColor: '#fff0ee',
    padding: 10,
    marginHorizontal: 14,
    borderRadius: 8,
  },
});
