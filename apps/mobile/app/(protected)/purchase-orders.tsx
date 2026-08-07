import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { PurchaseOrder, Supplier } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { getPurchaseOrders, outstandingOn } from '../../src/warehouse/purchasing';
import { formatFinanceDate } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  CardLink,
  EmptyState,
  ErrorState,
  FilterChips,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

const FILTERS = [
  { value: 'ISSUED', key: 'purchasing.filterDueIn' },
  { value: 'PARTIALLY_RECEIVED', key: 'purchasing.filterPartly' },
  { value: '', key: 'purchasing.allStatuses' },
];

const supplierName = (order: PurchaseOrder) =>
  typeof order.supplierId === 'string' ? '' : (order.supplierId as Supplier).name;

/**
 * What has been ordered from suppliers, and what is still to arrive.
 *
 * The list opens on **what is due in** rather than on everything, because the
 * person holding the phone is almost always standing at the goods-in door with
 * a lorry outside, looking for the order the driver has just named.
 */
export default function PurchaseOrdersScreen() {
  const { t, language } = useLanguage();
  const [orders, setOrders] = useState<PurchaseOrder[]>();
  const [status, setStatus] = useState('ISSUED');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setOrders(await getPurchaseOrders(status ? { status } : {}));
    } catch (caught) {
      setError(errorMessage(caught, language, t('purchasing.ordersCouldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, status, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!orders && !error) {
    return (
      <Screen>
        <LoadingState label={t('purchasing.ordersLoading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <FilterChips
        label={t('purchasing.showing')}
        value={status}
        onChange={setStatus}
        options={FILTERS.map((filter) => ({ value: filter.value, label: t(filter.key) }))}
      />

      <Button
        variant="secondary"
        label={t('purchasing.raiseOrder')}
        onPress={() => router.push('/(protected)/purchase-order-new')}
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <FlatList
        data={orders ?? []}
        keyExtractor={(order) => order._id}
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
            title={t('purchasing.ordersNone')}
            description={t('purchasing.ordersNoneBody')}
          />
        }
        renderItem={({ item }) => {
          const outstanding = item.lines.reduce((total, line) => total + outstandingOn(line), 0);
          return (
            <CardLink
              accessibilityLabel={t('purchasing.openOrder', { reference: item.reference })}
              onPress={() =>
                router.push(`/(protected)/purchase-order-detail?id=${item._id}` as never)
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
                <StatusPill kind="purchaseOrder" status={item.status} />
              </View>
              <Text style={{ color: colour.text }}>{supplierName(item)}</Text>
              {item.expectedDate ? (
                <ListRow
                  label={t('purchasing.expectedDate')}
                  value={formatFinanceDate(item.expectedDate)}
                />
              ) : null}
              {/*
                Units still to come, which is the number somebody at the door
                is actually holding in their head — not how many lines.
              */}
              <ListRow
                label={t('purchasing.outstanding')}
                value={t('purchasing.units', { count: outstanding })}
                numeric
              />
            </CardLink>
          );
        }}
      />
    </Screen>
  );
}
