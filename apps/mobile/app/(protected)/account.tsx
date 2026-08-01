import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { FinanceCard, FinanceState, StatusBadge } from '../../src/finance/components';
import { apiErrorMessage, getMyFinanceSummary } from '../../src/finance/api';
import { formatMoneyMinor, formatPercentFromBasisPoints } from '../../src/finance/money';
import type { ShopFinanceSummary } from '../../src/finance/types';

export default function AccountScreen() {
  const [summary, setSummary] = useState<ShopFinanceSummary>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSummary(await getMyFinanceSummary());
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load your account summary.'));
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
  if (!summary) return <FinanceState empty="No shop account is linked to this user." />;

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
      {error ? <Text style={styles.warning}>{error}</Text> : null}
      {summary.creditBlocked ? (
        <View style={styles.blocked}>
          <Text style={styles.blockedTitle}>Credit orders are blocked</Text>
          <Text style={styles.blockedText}>
            {summary.blockReason ?? 'Contact your account manager.'}
          </Text>
        </View>
      ) : null}
      <FinanceCard>
        <View style={styles.headingRow}>
          <View>
            <Text style={styles.shopName}>{summary.shop.name}</Text>
            <Text style={styles.reference}>{summary.shop.reference}</Text>
          </View>
          <StatusBadge value={summary.shop.status} />
        </View>
      </FinanceCard>
      <View style={styles.grid}>
        <Metric
          label="Current due"
          value={formatMoneyMinor(summary.outstandingBalanceMinor)}
          warning={summary.outstandingBalanceMinor > 0}
        />
        <Metric
          label="Overdue"
          value={formatMoneyMinor(summary.overdueBalanceMinor)}
          warning={summary.overdueBalanceMinor > 0}
        />
        <Metric label="Available credit" value={formatMoneyMinor(summary.availableCreditMinor)} />
        <Metric label="Credit limit" value={formatMoneyMinor(summary.creditLimitMinor)} />
        <Metric
          label="Credit used"
          value={formatPercentFromBasisPoints(summary.creditUtilisationBps)}
        />
        <Metric label="Payment terms" value={`${summary.paymentTermsDays} days`} />
      </View>
      <Text style={styles.section}>Account records</Text>
      <AccountLink label="Invoices" onPress={() => router.push('/(protected)/invoices')} />
      <AccountLink
        label="Payment history and receipts"
        onPress={() => router.push('/(protected)/payments')}
      />
      <AccountLink
        label="Account statement"
        onPress={() => router.push('/(protected)/statement')}
      />
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

function AccountLink({ label, onPress }: { label: string; onPress: () => void }) {
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
  warning: { color: '#7b5311', backgroundColor: '#fff4d6', padding: 10, borderRadius: 8 },
  blocked: {
    backgroundColor: '#fff0ee',
    borderColor: '#e4aaa3',
    borderWidth: 1,
    borderRadius: 10,
    padding: 13,
  },
  blockedTitle: { color: '#8b2525', fontWeight: '900' },
  blockedText: { color: '#71332d', marginTop: 4 },
  headingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  shopName: { fontSize: 21, fontWeight: '900', color: '#173f2e' },
  reference: { color: '#66756d', marginTop: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: {
    width: '48%',
    minWidth: 145,
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 11,
    padding: 13,
  },
  metricLabel: { color: '#66756d', fontSize: 12 },
  metricValue: { color: '#173f2e', fontWeight: '900', fontSize: 18, marginTop: 5 },
  warningValue: { color: '#9b2c2c' },
  section: { fontSize: 17, fontWeight: '900', marginTop: 5 },
  link: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  linkText: { color: '#173f2e', fontWeight: '800' },
  chevron: { color: '#126b45', fontSize: 20, lineHeight: 18 },
});
