import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { getFinanceReport } from '../../src/reports/api';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  CardLink,
  EmptyState,
  ErrorState,
  FilterChips,
  ListRow,
  LoadingState,
  Screen,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

const KINDS = ['outstanding', 'overdue', 'collections'];

interface Row {
  shopId?: string;
  shopName?: string;
  name?: string;
  reference?: string;
  outstandingBalanceMinor?: number;
  overdueBalanceMinor?: number;
  amountMinor?: number;
  oldestDueDate?: string;
  daysOverdue?: number;
  method?: string;
  collectedBy?: string;
}

/**
 * Who owes what, and what came in.
 *
 * Three shared destinations on one screen, chosen with chips — the same trade
 * the analytics screen makes, and for the same reason: a phone shows one thing
 * at a time.
 *
 * Every row opens the customer, because the reason somebody reads an overdue
 * list on a phone is to do something about one of the names on it. A report
 * that cannot be acted on is a report somebody looks at on a monitor instead.
 */
export default function FinanceReportScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const { t, language } = useLanguage();
  const [chosen, setChosen] = useState(kind && KINDS.includes(kind) ? kind : 'overdue');
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setRows(undefined);
    try {
      const answer = await getFinanceReport(chosen);
      // Two of the three answer with an array and one wraps it, so this takes
      // whichever it was given rather than assuming.
      const list = Array.isArray(answer)
        ? answer
        : ((answer as { items?: Row[]; rows?: Row[] }).items ??
          (answer as { rows?: Row[] }).rows ??
          []);
      setRows(list as Row[]);
    } catch (caught) {
      setError(errorMessage(caught, language, t('reportsMobile.couldNotLoad')));
    }
  }, [chosen, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen scroll={false}>
      <FilterChips
        label={t('reportsMobile.whichReport')}
        value={chosen}
        onChange={setChosen}
        options={KINDS.map((value) => ({ value, label: t(`reportsMobile.finance.${value}`) }))}
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!rows && !error ? <LoadingState label={t('reportsMobile.loading')} /> : null}

      <FlatList
        data={rows ?? []}
        keyExtractor={(row, index) => row.shopId ?? row.reference ?? String(index)}
        contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
        ListEmptyComponent={rows ? <EmptyState title={t('reportsMobile.nothingHere')} /> : null}
        renderItem={({ item }) => (
          <CardLink
            accessibilityLabel={t('shops.openShop', { name: item.shopName ?? item.name ?? '' })}
            onPress={() =>
              item.shopId
                ? router.push(`/(protected)/shop-detail?id=${item.shopId}` as never)
                : undefined
            }
          >
            <Text style={{ color: colour.text, fontWeight: '600' }}>
              {item.shopName ?? item.name ?? item.reference ?? '—'}
            </Text>
            {item.outstandingBalanceMinor !== undefined ? (
              <ListRow
                label={t('shops.owed')}
                value={formatMoneyMinor(item.outstandingBalanceMinor)}
                numeric
              />
            ) : null}
            {item.overdueBalanceMinor !== undefined ? (
              <ListRow
                label={t('shops.overdue')}
                value={formatMoneyMinor(item.overdueBalanceMinor)}
                numeric
              />
            ) : null}
            {item.amountMinor !== undefined ? (
              <ListRow
                label={t('finance.amount')}
                value={formatMoneyMinor(item.amountMinor)}
                numeric
              />
            ) : null}
            {/*
              How long, not just how much. A hundred taka a week late and a
              hundred taka three months late are different conversations.
            */}
            {item.daysOverdue !== undefined ? (
              <ListRow
                label={t('reportsMobile.daysLate')}
                value={String(item.daysOverdue)}
                numeric
              />
            ) : null}
            {item.oldestDueDate ? (
              <ListRow label={t('shops.oldestDue')} value={formatFinanceDate(item.oldestDueDate)} />
            ) : null}
          </CardLink>
        )}
      />
    </Screen>
  );
}
