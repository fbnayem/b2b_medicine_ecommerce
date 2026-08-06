import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text } from 'react-native';
import { router } from 'expo-router';
import type { Delivery, Order } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../api/client';
import { formatFinanceDate } from '../finance/date';
import { useLanguage } from '../i18n/useLanguage';
import {
  CardLink,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
} from '../components';
import { colour, layout } from '../theme';

/**
 * What is on its way to this shop.
 *
 * The deliveries tab was written for a rider and nothing else: it filters to a
 * rider's active statuses, offers "my round", caches for a lane with no signal
 * and shows a queue of unsynced actions. A shop owner reached it from their own
 * menu and got all of that — a screen of controls that are not theirs, over a
 * concept ("my round") they do not have.
 *
 * A customer wants one thing from this list: which of my orders is coming, and
 * how far has it got. Tapping one opens `delivery-track`, the read-only view,
 * rather than the rider's working screen.
 *
 * **No offline cache here.** A rider is halfway down a lane; a pharmacy is
 * behind a counter with the same connection they placed the order on. Caching
 * would be machinery serving nobody.
 */
export function CustomerDeliveries() {
  const { t, language } = useLanguage();
  const [data, setData] = useState<Delivery[]>();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      // Scoped server-side to this owner's shop, exactly as the order list is.
      setData((await apiClient.get('/deliveries')).data.data);
    } catch (caught) {
      setError(errorMessage(caught, language, t('delivery.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <LoadingState label={t('delivery.loading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <FlatList
        data={data}
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
          <EmptyState
            title={t('delivery.nothingComing')}
            description={t('delivery.nothingComingBody')}
          />
        }
        renderItem={({ item }) => {
          const order = typeof item.orderId === 'string' ? undefined : (item.orderId as Order);
          return (
            <CardLink
              accessibilityLabel={order?.reference ?? item.reference}
              onPress={() =>
                router.push({
                  pathname: '/(protected)/delivery-track',
                  params: { orderId: String(order?._id ?? item.orderId) },
                })
              }
            >
              <Text style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}>
                {order?.reference ?? item.reference}
              </Text>
              <StatusPill kind="delivery" status={item.status} />
              {item.expectedDeliveryDate ? (
                <ListRow
                  label={t('delivery.expected')}
                  value={formatFinanceDate(item.expectedDeliveryDate)}
                />
              ) : null}
            </CardLink>
          );
        }}
      />
    </Screen>
  );
}
