import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Order, Shop } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../../src/api/client';
import { formatMoneyMinor } from '../../../src/finance/money';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  CardLink,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

export default function ApprovalsScreen() {
  const { t, language } = useLanguage();
  const [data, setData] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        setData((await apiClient.get('/approvals/queue')).data.data);
        setError('');
      } catch (caught) {
        setError(errorMessage(caught, language, t('approvals.couldNotLoad')));
      } finally {
        setLoading(false);
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
        <LoadingState label={t('approvals.loading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <FlatList
        data={data}
        keyExtractor={(item) => item._id}
        contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
        ListEmptyComponent={
          <EmptyState title={t('approvals.none')} description={t('approvals.noneBody')} />
        }
        renderItem={({ item }) => {
          const shop = item.shopId as Shop;
          return (
            <CardLink
              accessibilityLabel={item.reference}
              onPress={() =>
                router.push({ pathname: '/(protected)/approval-review', params: { id: item._id } })
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
                  style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}
                >
                  {item.reference}
                </Text>
                <StatusPill kind="order" status={item.status} />
              </View>
              <Text style={{ color: colour.text }}>{shop.name}</Text>
              <ListRow
                label={t('approvals.estimate')}
                value={formatMoneyMinor(item.estimatedTotalMinor)}
                numeric
              />
            </CardLink>
          );
        }}
      />
    </Screen>
  );
}
