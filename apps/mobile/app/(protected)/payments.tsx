import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { getPayments } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import type { FinancePayment } from '../../src/finance/types';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  CardLink,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

export default function PaymentsScreen() {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<FinancePayment[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (targetPage = 1, append = false) => {
      try {
        const result = await getPayments({ page: targetPage, limit: 30 });
        setItems((current) => (append ? [...current, ...result.items] : result.items));
        setPage(result.page);
        setPages(result.pages);
        setError('');
      } catch (caught) {
        setError(errorMessage(caught, language, t('finance.couldNotLoadPayments')));
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [language, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('finance.loadingPayments')} />
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
        keyExtractor={(item) => item._id}
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
          <EmptyState title={t('finance.noPayments')} description={t('finance.noPaymentsBody')} />
        }
        ListFooterComponent={
          page < pages ? (
            <Button
              variant="secondary"
              busy={loadingMore}
              label={loadingMore ? t('common.loadingMore') : t('common.loadMore')}
              onPress={() => {
                setLoadingMore(true);
                void load(page + 1, true);
              }}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <CardLink
            accessibilityLabel={item.reference}
            onPress={() =>
              router.push({ pathname: '/(protected)/payment-detail', params: { id: item._id } })
            }
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: layout.space[2],
              }}
            >
              <Text
                style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.brand }}
              >
                {item.reference}
              </Text>
              <StatusPill kind="payment" status={item.status} />
            </View>
            <Text
              style={{
                fontSize: layout.fontSize['2xl'],
                fontWeight: '700',
                color: colour.text,
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatMoneyMinor(item.amountMinor)}
            </Text>
            <ListRow label={t('finance.method')} value={t(`paymentMethod.${item.method}`)} />
            <ListRow
              label={t('finance.collectedAt')}
              value={formatFinanceDate(item.postingTime ?? item.collectionTime ?? item.createdAt)}
            />
            {item.receiptReference ? (
              <ListRow label={t('finance.receipt')} value={item.receiptReference} />
            ) : null}
          </CardLink>
        )}
      />
    </Screen>
  );
}
