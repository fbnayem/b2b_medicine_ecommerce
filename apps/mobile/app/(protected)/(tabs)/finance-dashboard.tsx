import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { FinanceCard, FinanceState } from '../../../src/finance/components';
import { apiErrorMessage, getFinanceReportSummary } from '../../../src/finance/api';
import { formatMoneyMinor } from '../../../src/finance/money';
import type { FinanceReportSummary } from '../../../src/finance/types';

export default function FinanceDashboardScreen() {
  const [summary, setSummary] = useState<FinanceReportSummary>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSummary(await getFinanceReportSummary());
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load due and collection totals.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || (!summary && error)) {
    return <FinanceState loading={loading} error={error} onRetry={() => void load()} />;
  }
  if (!summary) return <FinanceState empty="No financial summary is available." />;

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
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.grid}>
        <Metric label="Total outstanding" value={formatMoneyMinor(summary.totalOutstandingMinor)} />
        <Metric
          label="Total overdue"
          value={formatMoneyMinor(summary.totalOverdueMinor)}
          warning={summary.totalOverdueMinor > 0}
        />
        <Metric
          label="Pending collections"
          value={formatMoneyMinor(summary.pendingCollectionsMinor)}
        />
        <Metric label="Collections to review" value={String(summary.pendingCollectionsCount)} />
        <Metric
          label="Overdue shops"
          value={String(summary.overdueShopCount)}
          warning={summary.overdueShopCount > 0}
        />
      </View>
      <FinanceCard>
        <Text style={styles.title}>Actions</Text>
        <Link
          label="Review overdue shops"
          onPress={() => router.push('/(protected)/overdue-shops')}
        />
        <Link
          label="Verify delivery collections"
          onPress={() => router.push('/(protected)/collection-review')}
        />
      </FinanceCard>
      <Text style={styles.notice}>
        Balances and due dates are calculated by the server ledger in Asia/Dhaka time.
      </Text>
    </ScrollView>
  );
}

function Metric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, warning && styles.warningValue]}>{value}</Text>
    </View>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={styles.link} onPress={onPress}>
      <Text style={styles.linkText}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 14, gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: {
    width: '48%',
    minWidth: 145,
    flexGrow: 1,
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 11,
  },
  metricLabel: { color: '#66756d', fontSize: 12 },
  metricValue: { color: '#173f2e', fontWeight: '900', fontSize: 20, marginTop: 5 },
  warningValue: { color: '#9b2c2c' },
  title: { fontWeight: '900', fontSize: 17 },
  link: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e7ede9',
  },
  linkText: { color: '#173f2e', fontWeight: '800' },
  chevron: { color: '#126b45', fontSize: 20 },
  notice: { color: '#66756d', textAlign: 'center', lineHeight: 19 },
  error: { color: '#8b2525', backgroundColor: '#fff0ee', padding: 10, borderRadius: 8 },
});
