import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { getMyFinanceSummary } from '../../../src/finance/api';
import { formatMoneyMinor, formatPercentFromBasisPoints } from '../../../src/finance/money';
import type { ShopFinanceSummary } from '../../../src/finance/types';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Button,
  Card,
  CardLink,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  Screen,
  SectionTitle,
  StatusPill,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

export default function AccountScreen() {
  const { t, language } = useLanguage();
  const [summary, setSummary] = useState<ShopFinanceSummary>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSummary(await getMyFinanceSummary());
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('account.couldNotLoad')));
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
        <LoadingState label={t('account.loading')} />
      </Screen>
    );
  }

  if (!summary) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <EmptyState
            title={t('account.noShopLinked')}
            description={t('account.noShopLinkedBody')}
          />
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

      {summary.creditBlocked ? (
        <Card style={{ borderColor: colour.danger }}>
          <Text
            accessibilityRole="header"
            style={{ color: colour.danger, fontWeight: '700', fontSize: layout.fontSize.lg }}
          >
            {t('account.creditBlockedTitle')}
          </Text>
          <Text style={{ color: colour.text }}>
            {summary.blockReason ?? t('account.creditBlockedBody')}
          </Text>
          {/*
           * The banner used to be a dead end — a red box telling a shop owner
           * their account was blocked, with nothing to press. The statement is
           * where they can see which invoices caused it.
           */}
          <Button
            variant="secondary"
            label={t('account.seeWhatIsOwed')}
            onPress={() => router.push('/(protected)/statement')}
          />
        </Card>
      ) : null}

      <Card>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: layout.space[3],
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: layout.fontSize.xl, fontWeight: '700', color: colour.text }}>
              {summary.shop.name}
            </Text>
            <Text style={{ color: colour.textMuted }}>{summary.shop.reference}</Text>
          </View>
          <StatusPill kind="shop" status={summary.shop.status} />
        </View>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
        <Metric
          label={t('account.currentDue')}
          value={formatMoneyMinor(summary.outstandingBalanceMinor)}
          tone={summary.outstandingBalanceMinor > 0 ? 'warning' : 'normal'}
        />
        <Metric
          label={t('account.overdue')}
          value={formatMoneyMinor(summary.overdueBalanceMinor)}
          tone={summary.overdueBalanceMinor > 0 ? 'warning' : 'normal'}
        />
        <Metric
          label={t('account.availableCredit')}
          value={formatMoneyMinor(summary.availableCreditMinor)}
        />
        <Metric
          label={t('account.creditLimit')}
          value={formatMoneyMinor(summary.creditLimitMinor)}
        />
        <Metric
          label={t('account.creditUsed')}
          value={formatPercentFromBasisPoints(summary.creditUtilisationBps)}
        />
        <Metric
          label={t('account.paymentTerms')}
          value={t('account.days', { count: summary.paymentTermsDays })}
        />
      </View>

      <SectionTitle>{t('account.records')}</SectionTitle>
      <CardLink
        accessibilityLabel={t('account.invoices')}
        onPress={() => router.push('/(protected)/invoices')}
      >
        <Text style={{ color: colour.text, fontWeight: '600' }}>{t('account.invoices')}</Text>
      </CardLink>
      <CardLink
        accessibilityLabel={t('account.paymentHistory')}
        onPress={() => router.push('/(protected)/payments')}
      >
        <Text style={{ color: colour.text, fontWeight: '600' }}>{t('account.paymentHistory')}</Text>
      </CardLink>
      <CardLink
        accessibilityLabel={t('account.statement')}
        onPress={() => router.push('/(protected)/statement')}
      >
        <Text style={{ color: colour.text, fontWeight: '600' }}>{t('account.statement')}</Text>
      </CardLink>
    </ScrollView>
  );
}
