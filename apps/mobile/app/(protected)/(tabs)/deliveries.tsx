import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { DeliveryStatus, UserRole } from '@medsupply/shared-types';
import type { Delivery } from '@medsupply/shared-types';
import { apiClient } from '../../../src/api/client';
import { formatFinanceDate } from '../../../src/finance/date';
import {
  cacheAssignedDeliveries,
  loadCachedDeliveries,
  loadDeliveryQueue,
  syncDeliveryQueue,
} from '../../../src/delivery/offlineQueue';
import { useLanguage } from '../../../src/i18n/useLanguage';
import { useAuthStore } from '../../../src/store/useAuth';
import { CustomerDeliveries } from '../../../src/delivery/CustomerDeliveries';
import { Badge, Button, CardLink, EmptyState, Screen, StatusPill } from '../../../src/components';
import { colour, layout } from '../../../src/theme';

const activeStatuses = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.HANDED_OVER,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.OUT_FOR_DELIVERY,
  DeliveryStatus.ARRIVED,
  DeliveryStatus.FAILED,
  DeliveryStatus.RETURNING,
] as DeliveryStatus[];

export default function DeliveriesScreen() {
  /*
   * Two audiences, one route.
   *
   * Everything below this line is a rider's working screen — their round, their
   * offline cache, their queue of unsynced actions. A shop owner reached it
   * from their own menu and got all of it. In the shipped applications only one
   * branch is ever taken, because a build admits one set of roles: the Shop
   * application only ever renders the customer's list, and the Rider
   * application only ever renders the rider's.
   */
  const role = useAuthStore((state) => state.user?.role);
  if (role === UserRole.SHOP_OWNER) return <CustomerDeliveries />;
  return <RiderDeliveries />;
}

function RiderDeliveries() {
  const { t } = useLanguage();
  const [data, setData] = useState<Delivery[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [unsynced, setUnsynced] = useState(0);

  const load = useCallback(async () => {
    try {
      await syncDeliveryQueue();
      const values: Delivery[] = (await apiClient.get('/deliveries')).data.data;
      setData(values.filter((delivery) => activeStatuses.includes(delivery.status)));
      await cacheAssignedDeliveries(values);
      setOffline(false);
    } catch {
      /*
       * Falling back to the cache is not an error, so it does not use
       * `ErrorState`: a rider halfway down a lane with no signal is still
       * working, and a red failure box telling them to try again would be both
       * wrong and alarming. It is a notice, and the round below it is real.
       */
      const cached = await loadCachedDeliveries();
      setData(cached.filter((delivery) => activeStatuses.includes(delivery.status)));
      setOffline(true);
    } finally {
      setUnsynced((await loadDeliveryQueue()).length);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen scroll={false}>
      {offline ? (
        <View
          accessible
          accessibilityRole="alert"
          style={{
            backgroundColor: colour.surface,
            borderColor: colour.warning,
            borderWidth: 1,
            borderRadius: layout.radius.md,
            padding: layout.space[3],
          }}
        >
          <Text style={{ color: colour.text }}>{t('delivery.offlineNotice')}</Text>
        </View>
      ) : null}

      {unsynced ? (
        <Button
          variant="secondary"
          label={t('delivery.unsynced', { count: unsynced })}
          onPress={() => void load()}
        />
      ) : null}

      {/*
       * The round, which is the view a rider actually plans their day from.
       * It sits above the list rather than replacing it: the list is what
       * works offline, and a round needs the server.
       */}
      <Button
        variant="secondary"
        label={t('trips.myTitle')}
        onPress={() => router.push('/(protected)/trip')}
      />

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
            title={offline ? t('delivery.noCached') : t('delivery.noneActive')}
            description={offline ? t('delivery.noCachedBody') : t('delivery.noneActiveBody')}
          />
        }
        renderItem={({ item }) => {
          const shop = typeof item.shopId === 'string' ? undefined : item.shopId;
          const pack = typeof item.packageId === 'string' ? undefined : item.packageId;
          return (
            <CardLink
              accessibilityLabel={item.reference}
              onPress={() =>
                router.push({ pathname: '/(protected)/delivery-detail', params: { id: item._id } })
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
                <Text style={{ color: colour.brand, fontWeight: '600' }}>{item.reference}</Text>
                <StatusPill kind="delivery" status={item.status} />
              </View>
              <Text style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}>
                {shop?.name ?? item.contactSnapshot.name}
              </Text>
              <Text style={{ color: colour.text }}>
                {item.addressSnapshot.line1}, {item.addressSnapshot.city}
              </Text>
              {pack ? (
                <Badge>
                  {pack.reference} · {t('delivery.packages', { count: pack.packageCount ?? 0 })}
                </Badge>
              ) : null}
              {item.expectedDeliveryDate ? (
                <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                  {t('delivery.expected')} {formatFinanceDate(item.expectedDeliveryDate)}
                </Text>
              ) : null}
            </CardLink>
          );
        }}
      />
    </Screen>
  );
}
