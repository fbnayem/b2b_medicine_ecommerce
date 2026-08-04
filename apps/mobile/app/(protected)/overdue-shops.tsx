import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { errorMessage } from '@medsupply/api-client';
import { getOverdueShops } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import type { OverdueShop } from '../../src/finance/types';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

export default function OverdueShopsScreen() {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<OverdueShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setItems((await getOverdueShops()).items);
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('finance.couldNotLoadReport')));
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
        <LoadingState label={t('finance.loadingReport')} />
      </Screen>
    );
  }

  if (!items.length && error) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.shopId}
        contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
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
          <EmptyState
            title={t('finance.noOverdueShops')}
            description={t('finance.noOverdueShopsBody')}
          />
        }
        renderItem={({ item }) => (
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: layout.space[2],
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}
                >
                  {item.name}
                </Text>
                <Text style={{ color: colour.brand, fontSize: layout.fontSize.sm }}>
                  {item.reference}
                </Text>
              </View>
              {/* Was `${days} DAYS` pushed through the status badge, so a made-up
                  value rendered as though it were a status the server sent. */}
              <Badge tone="danger">{t('finance.daysOverdue', { count: item.daysOverdue })}</Badge>
            </View>
            <ListRow
              label={t('finance.outstanding')}
              value={formatMoneyMinor(item.outstandingBalanceMinor)}
              numeric
            />
            <ListRow
              label={t('finance.overdue')}
              value={formatMoneyMinor(item.overdueBalanceMinor)}
              numeric
            />
            <ListRow
              label={t('finance.oldestDueDate')}
              value={formatFinanceDate(item.oldestDueDate)}
            />
          </Card>
        )}
      />
    </Screen>
  );
}
