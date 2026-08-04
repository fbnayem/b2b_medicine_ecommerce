import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import type { AnalyticsOverview } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { toDateInputValue } from '@medsupply/utilities';
import { formatMoneyMinor } from '../../../src/finance/money';
import { getAnalyticsOverview } from '../../../src/returns/api';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Card,
  EmptyState,
  ErrorState,
  FilterChips,
  ListRow,
  LoadingState,
  Metric,
  Screen,
  SectionTitle,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

type Preset = 'MONTH' | 'WEEK' | 'QUARTER';

/**
 * Today, in the tenant's configured zone.
 *
 * This was `new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10)` —
 * a hand-rolled Dhaka offset three lines from a helper that does it properly.
 * It is wrong twice over: it hard-codes +06:00 for a deployment that can now be
 * configured to any zone, and between midnight and 06:00 it reports tomorrow.
 */
function today() {
  return toDateInputValue(new Date());
}

function rangeFor(preset: Preset) {
  const to = today();
  if (preset === 'MONTH') return { from: `${to.slice(0, 8)}01`, to, granularity: 'DAY' as const };
  const days = preset === 'WEEK' ? 6 : 89;
  const from = toDateInputValue(new Date(Date.parse(`${to}T12:00:00.000Z`) - days * 86_400_000));
  return { from, to, granularity: preset === 'WEEK' ? ('DAY' as const) : ('WEEK' as const) };
}

const PRESETS: readonly Preset[] = ['WEEK', 'MONTH', 'QUARTER'];
const PRESET_KEY: Record<Preset, string> = {
  WEEK: 'analyticsMobile.last7',
  MONTH: 'analyticsMobile.thisMonth',
  QUARTER: 'analyticsMobile.last90',
};

const percent = (basisPoints: number) => `${(basisPoints / 100).toFixed(1)}%`;

export default function AnalyticsScreen() {
  const { t, language } = useLanguage();
  const [preset, setPreset] = useState<Preset>('MONTH');
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await getAnalyticsOverview(rangeFor(preset)));
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('analyticsMobile.couldNotLoad')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [preset, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('analyticsMobile.loading')} />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <EmptyState
            title={t('analyticsMobile.none')}
            description={t('analyticsMobile.noneBody')}
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
      <FilterChips
        label={t('analyticsMobile.rangeLabel')}
        value={preset}
        onChange={(next) => {
          setLoading(true);
          setPreset(next as Preset);
        }}
        options={PRESETS.map((value) => ({ value, label: t(PRESET_KEY[value]) }))}
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Card>
        <SectionTitle>{t('analyticsMobile.sales')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
          <Metric
            label={t('analyticsMobile.netSales')}
            value={formatMoneyMinor(data.sales.netMinor)}
          />
          <Metric
            label={t('analyticsMobile.afterReturns')}
            value={formatMoneyMinor(data.sales.netAfterReturnsMinor)}
          />
          <Metric label={t('analyticsMobile.invoices')} value={data.sales.invoiceCount} />
          <Metric
            label={t('analyticsMobile.averageInvoice')}
            value={formatMoneyMinor(data.sales.averageInvoiceMinor)}
          />
        </View>
      </Card>

      <Card>
        <SectionTitle>{t('analyticsMobile.receivables')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
          <Metric
            label={t('analyticsMobile.outstanding')}
            value={formatMoneyMinor(data.receivables.outstandingMinor)}
          />
          <Metric
            label={t('analyticsMobile.overdue')}
            value={formatMoneyMinor(data.receivables.overdueMinor)}
            tone={data.receivables.overdueMinor > 0 ? 'warning' : 'normal'}
          />
        </View>
      </Card>

      <Card>
        <SectionTitle>{t('analyticsMobile.orders')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
          <Metric label={t('analyticsMobile.submitted')} value={data.orders.submitted} />
          <Metric label={t('analyticsMobile.approved')} value={data.orders.approved} />
          <Metric label={t('analyticsMobile.delivered')} value={data.orders.delivered} />
          <Metric label={t('analyticsMobile.cancelled')} value={data.orders.cancelled} />
        </View>
      </Card>

      <Card>
        <SectionTitle>{t('analyticsMobile.delivery')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
          <Metric
            label={t('analyticsMobile.successRate')}
            value={percent(data.delivery.successBasisPoints)}
          />
          <Metric
            label={t('analyticsMobile.onTime')}
            value={percent(data.delivery.onTimeBasisPoints)}
          />
          <Metric
            label={t('analyticsMobile.failed')}
            value={data.delivery.failed}
            tone={data.delivery.failed > 0 ? 'warning' : 'normal'}
          />
          <Metric
            label={t('analyticsMobile.averageCycle')}
            value={
              data.delivery.averageCycleHours === null
                ? '—'
                : t('analyticsMobile.hours', { count: data.delivery.averageCycleHours })
            }
          />
        </View>
      </Card>

      <Card>
        <SectionTitle>{t('analyticsMobile.returns')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
          <Metric
            label={t('analyticsMobile.credited')}
            value={formatMoneyMinor(data.returns.creditedMinor)}
          />
          <Metric
            label={t('analyticsMobile.awaitingCredit')}
            value={formatMoneyMinor(data.returns.pendingCreditMinor)}
          />
          <Metric
            label={t('analyticsMobile.returnRate')}
            value={percent(data.returns.returnRateBasisPoints)}
          />
          <Metric label={t('analyticsMobile.openRequests')} value={data.returns.pendingCount} />
        </View>
      </Card>

      <Card>
        <SectionTitle>{t('analyticsMobile.topMedicines')}</SectionTitle>
        {data.topMedicines.length === 0 ? (
          <Text style={{ color: colour.textMuted }}>{t('analyticsMobile.nothingSold')}</Text>
        ) : (
          data.topMedicines.map((row) => (
            <ListRow
              key={row.key}
              label={row.label}
              value={formatMoneyMinor(row.netMinor)}
              numeric
            />
          ))
        )}
      </Card>
    </ScrollView>
  );
}
