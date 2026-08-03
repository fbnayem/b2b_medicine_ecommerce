import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AnalyticsOverview } from '@medsupply/shared-types';
import { FinanceState } from '../../../src/finance/components';
import { apiErrorMessage } from '../../../src/finance/api';
import { formatMoneyMinor } from '../../../src/finance/money';
import { getAnalyticsOverview } from '../../../src/returns/api';

/** Asia/Dhaka, matching the server's report calendar. */
function dhakaToday() {
  return new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
}

function rangeFor(preset: 'MONTH' | 'WEEK' | 'QUARTER') {
  const to = dhakaToday();
  if (preset === 'MONTH') return { from: `${to.slice(0, 8)}01`, to, granularity: 'DAY' as const };
  const days = preset === 'WEEK' ? 6 : 89;
  const from = new Date(Date.parse(`${to}T00:00:00.000+06:00`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { from, to, granularity: preset === 'WEEK' ? ('DAY' as const) : ('WEEK' as const) };
}

const PRESETS = [
  { value: 'WEEK', label: 'Last 7 days' },
  { value: 'MONTH', label: 'This month' },
  { value: 'QUARTER', label: 'Last 90 days' },
] as const;

const percent = (basisPoints: number) => `${(basisPoints / 100).toFixed(1)}%`;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export default function AnalyticsScreen() {
  const [preset, setPreset] = useState<'MONTH' | 'WEEK' | 'QUARTER'>('MONTH');
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await getAnalyticsOverview(rangeFor(preset)));
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load business analytics.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [preset]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <FinanceState loading />;
  if (!data)
    return <FinanceState error={error || 'No analytics available.'} onRetry={() => void load()} />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      <View style={styles.filters}>
        {PRESETS.map((entry) => (
          <Pressable
            accessibilityRole="button"
            key={entry.value}
            style={[styles.filter, preset === entry.value ? styles.filterActive : null]}
            onPress={() => {
              setLoading(true);
              setPreset(entry.value);
            }}
          >
            <Text style={preset === entry.value ? styles.filterTextActive : styles.filterText}>
              {entry.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.heading}>Sales</Text>
        <View style={styles.metricRow}>
          <Metric label="Net sales" value={formatMoneyMinor(data.sales.netMinor)} />
          <Metric label="After returns" value={formatMoneyMinor(data.sales.netAfterReturnsMinor)} />
        </View>
        <View style={styles.metricRow}>
          <Metric label="Invoices" value={String(data.sales.invoiceCount)} />
          <Metric
            label="Average invoice"
            value={formatMoneyMinor(data.sales.averageInvoiceMinor)}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Receivables</Text>
        <View style={styles.metricRow}>
          <Metric label="Outstanding" value={formatMoneyMinor(data.receivables.outstandingMinor)} />
          <Metric label="Overdue" value={formatMoneyMinor(data.receivables.overdueMinor)} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Orders</Text>
        <View style={styles.metricRow}>
          <Metric label="Submitted" value={String(data.orders.submitted)} />
          <Metric label="Approved" value={String(data.orders.approved)} />
        </View>
        <View style={styles.metricRow}>
          <Metric label="Delivered" value={String(data.orders.delivered)} />
          <Metric label="Cancelled" value={String(data.orders.cancelled)} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Delivery</Text>
        <View style={styles.metricRow}>
          <Metric label="Success rate" value={percent(data.delivery.successBasisPoints)} />
          <Metric label="On time" value={percent(data.delivery.onTimeBasisPoints)} />
        </View>
        <View style={styles.metricRow}>
          <Metric label="Failed" value={String(data.delivery.failed)} />
          <Metric
            label="Average cycle"
            value={
              data.delivery.averageCycleHours === null
                ? '—'
                : `${data.delivery.averageCycleHours} h`
            }
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Returns</Text>
        <View style={styles.metricRow}>
          <Metric label="Credited" value={formatMoneyMinor(data.returns.creditedMinor)} />
          <Metric
            label="Awaiting credit"
            value={formatMoneyMinor(data.returns.pendingCreditMinor)}
          />
        </View>
        <View style={styles.metricRow}>
          <Metric label="Return rate" value={percent(data.returns.returnRateBasisPoints)} />
          <Metric label="Open requests" value={String(data.returns.pendingCount)} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Top medicines</Text>
        {data.topMedicines.length === 0 ? (
          <Text style={styles.muted}>Nothing was sold in this period.</Text>
        ) : (
          data.topMedicines.map((row) => (
            <View key={row.key} style={styles.listRow}>
              <Text style={styles.listLabel}>{row.label}</Text>
              <Text style={styles.listValue}>{formatMoneyMinor(row.netMinor)}</Text>
            </View>
          ))
        )}
      </View>

      <Text style={styles.footnote}>
        Periods use the Asia/Dhaka business calendar, the same boundary the ledger uses.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 14, gap: 12, paddingBottom: 34 },
  filters: { flexDirection: 'row', gap: 7 },
  filter: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff' },
  filterActive: { backgroundColor: '#126b45' },
  filterText: { color: '#274b3b', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#fff', fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 15, gap: 9 },
  heading: { color: '#173f2e', fontWeight: '900', fontSize: 15 },
  metricRow: { flexDirection: 'row', gap: 10 },
  metric: { flex: 1, backgroundColor: '#f4f7f5', borderRadius: 9, padding: 11 },
  metricLabel: { color: '#66756d', fontSize: 11 },
  metricValue: { color: '#173f2e', fontWeight: '900', fontSize: 17, marginTop: 3 },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  listLabel: { flex: 1, color: '#274b3b' },
  listValue: { fontWeight: '700', color: '#173f2e' },
  muted: { color: '#66756d' },
  footnote: { color: '#66756d', fontSize: 12, textAlign: 'center' },
  error: { color: '#8b2525', backgroundColor: '#fff0ee', padding: 10, borderRadius: 8 },
});
