import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { toDateInputValue } from '@medsupply/utilities';
import { REPORTS, getReport, type ReportView } from '../../src/reports/api';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  Input,
  ListRow,
  LoadingState,
  Metric,
  Screen,
  SectionTitle,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * One report at a time, chosen with a chip row.
 *
 * Seven shared navigation ids land here — the five `analytics-*` destinations
 * plus the order funnel and stock movements, both of which had **no caller on
 * any client**. On a monitor each of those is a page of charts; on a phone the
 * useful thing is a few headline figures and one list, so that is what each is
 * reduced to in `reports/api.ts`.
 *
 * Said plainly on the screen: this is the shape of it, and the breakdown is on
 * the web application. A phone that pretends to be a dashboard is a phone
 * somebody makes a decision from without the detail.
 */
const KINDS = ['sales', 'orders', 'returns', 'inventory', 'deliveries', 'receivables', 'movements'];

export default function AnalyticsReportScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const { t, language } = useLanguage();
  const [chosen, setChosen] = useState(kind && REPORTS[kind] ? kind : 'sales');
  const today = toDateInputValue(new Date());
  const monthAgo = toDateInputValue(new Date(Date.now() - 30 * 86_400_000));
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [view, setView] = useState<ReportView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setView(await getReport(chosen, from, to));
    } catch (caught) {
      setError(errorMessage(caught, language, t('reportsMobile.couldNotLoad')));
    } finally {
      setBusy(false);
    }
  }, [chosen, from, language, t, to]);

  useEffect(() => {
    void load();
    // Re-runs when the chosen report changes. The dates are applied by the
    // button, so a half-typed year does not fire a request per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  const ranged = REPORTS[chosen]?.ranged ?? false;

  return (
    <Screen>
      <FilterChips
        label={t('reportsMobile.whichReport')}
        value={chosen}
        onChange={setChosen}
        options={KINDS.map((value) => ({ value, label: t(`reportsMobile.kind.${value}`) }))}
      />

      {/*
        Only where the report has a period. Inventory valuation and receivables
        ageing are "as of now" — offering dates for them would invite somebody
        to set a range and believe the answer changed.
      */}
      {ranged ? (
        <Card>
          <Field label={t('purchasing.from')} hint={t('purchasing.dateHint')}>
            <Input label={t('purchasing.from')} value={from} onChangeText={setFrom} />
          </Field>
          <Field label={t('purchasing.to')} hint={t('purchasing.dateHint')}>
            <Input label={t('purchasing.to')} value={to} onChangeText={setTo} />
          </Field>
          <Button busy={busy} label={t('purchasing.apply')} onPress={() => void load()} />
        </Card>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {busy && !view ? <LoadingState label={t('reportsMobile.loading')} /> : null}

      {view ? (
        <>
          <View style={{ gap: layout.space[2] }}>
            {view.headlines.map((headline) => (
              <Metric key={headline.labelKey} label={t(headline.labelKey)} value={headline.value} />
            ))}
          </View>

          <SectionTitle>{t('reportsMobile.breakdown')}</SectionTitle>
          {view.rows.length === 0 ? (
            <EmptyState title={t('reportsMobile.nothingInPeriod')} />
          ) : (
            <Card>
              {view.rows.map((row) => (
                <ListRow key={row.key} label={row.label} value={row.value} numeric />
              ))}
            </Card>
          )}

          <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
            {t('reportsMobile.fullDetailOnWeb')}
          </Text>
        </>
      ) : null}
    </Screen>
  );
}
