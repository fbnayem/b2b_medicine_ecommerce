import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { getFinanceReportSummary } from '../../../src/finance/api';
import { formatMoneyMinor } from '../../../src/finance/money';
import type { FinanceReportSummary } from '../../../src/finance/types';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Card,
  CardLink,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  Screen,
  SectionTitle,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

export default function FinanceDashboardScreen() {
  const { t, language } = useLanguage();
  const [summary, setSummary] = useState<FinanceReportSummary>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSummary(await getFinanceReportSummary());
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('finance.couldNotLoadSummary')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('finance.loadingSummary')} />
      </Screen>
    );
  }

  if (!summary) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <EmptyState title={t('finance.noSummary')} description={t('finance.noSummaryBody')} />
        )}
      </Screen>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colour.canvas }}
      contentContainerStyle={{ padding: layout.space[4], gap: layout.space[3] }}
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
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
        <Metric
          label={t('finance.totalOutstanding')}
          value={formatMoneyMinor(summary.totalOutstandingMinor)}
        />
        <Metric
          label={t('finance.totalOverdue')}
          value={formatMoneyMinor(summary.totalOverdueMinor)}
          tone={summary.totalOverdueMinor > 0 ? 'warning' : 'normal'}
        />
        <Metric
          label={t('finance.pendingCollections')}
          value={formatMoneyMinor(summary.pendingCollectionsMinor)}
        />
        <Metric label={t('finance.collectionsToReview')} value={summary.pendingCollectionsCount} />
        <Metric
          label={t('finance.overdueShopCount')}
          value={summary.overdueShopCount}
          tone={summary.overdueShopCount > 0 ? 'warning' : 'normal'}
        />
      </View>

      <Card>
        <SectionTitle>{t('finance.actions')}</SectionTitle>
      </Card>
      <CardLink
        accessibilityLabel={t('finance.reviewOverdueShops')}
        onPress={() => router.push('/(protected)/overdue-shops')}
      >
        <Text style={{ color: colour.text, fontWeight: '600' }}>
          {t('finance.reviewOverdueShops')}
        </Text>
      </CardLink>
      <CardLink
        accessibilityLabel={t('finance.verifyCollections')}
        onPress={() => router.push('/(protected)/collection-review')}
      >
        <Text style={{ color: colour.text, fontWeight: '600' }}>
          {t('finance.verifyCollections')}
        </Text>
      </CardLink>

      <Text style={{ color: colour.textMuted, textAlign: 'center', lineHeight: 19 }}>
        {t('finance.ledgerNotice')}
      </Text>
    </ScrollView>
  );
}
