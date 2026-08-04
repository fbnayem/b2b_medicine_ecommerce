import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { getMyInvoices } from '../../src/finance/api';
import { errorMessage } from '@medsupply/api-client';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import type { FinanceInvoice } from '../../src/finance/types';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

export default function InvoicesScreen() {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<FinanceInvoice[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (targetPage = 1, append = false) => {
      try {
        const result = await getMyInvoices(targetPage);
        setItems((current) => (append ? [...current, ...result.items] : result.items));
        setPage(result.page);
        setPages(result.pages);
        setError('');
      } catch (caught) {
        setError(errorMessage(caught, language, t('finance.couldNotLoadInvoices')));
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
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
        <LoadingState label={t('finance.loadingInvoices')} />
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
          <EmptyState title={t('finance.noInvoices')} description={t('finance.noInvoicesBody')} />
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
        renderItem={({ item }) => {
          const overdue = item.amountDueMinor > 0 && new Date(item.dueDate).getTime() < Date.now();
          return (
            <Card>
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
                {/*
                 * "OVERDUE" was passed through the same badge as a real status,
                 * so an invented value rendered as though the server had said
                 * it. Overdue is a separate fact about a real status, and reads
                 * as one now.
                 */}
                {overdue ? (
                  <Badge tone="danger">{t('finance.overdueBadge')}</Badge>
                ) : (
                  <Badge>{t(`invoiceStatus.${item.status}`)}</Badge>
                )}
              </View>
              <ListRow label={t('finance.issued')} value={formatFinanceDate(item.invoiceDate)} />
              <ListRow label={t('finance.dueOnDate')} value={formatFinanceDate(item.dueDate)} />
              <ListRow
                label={t('finance.totalAmount')}
                value={formatMoneyMinor(item.grandTotalMinor)}
                numeric
              />
              <ListRow
                label={t('finance.paidAmount')}
                value={formatMoneyMinor(item.amountPaidMinor)}
                numeric
              />
              <ListRow
                label={t('finance.dueAmount')}
                value={formatMoneyMinor(item.amountDueMinor)}
                numeric
              />
            </Card>
          );
        }}
      />
    </Screen>
  );
}
