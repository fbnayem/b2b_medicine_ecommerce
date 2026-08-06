import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { Order } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../api/client';
import { getMyFinanceSummary } from '../finance/api';
import type { ShopFinanceSummary } from '../finance/types';
import { formatMoneyMinor } from '../finance/money';
import { stillComing, worthRepeating } from './openOrders';
import { useCart, type CartLine } from '../store/useCart';
import { useLanguage } from '../i18n/useLanguage';
import {
  Button,
  Card,
  CardLink,
  ErrorState,
  ListRow,
  LoadingState,
  Metric,
  Screen,
  SectionTitle,
  StatusPill,
  toast,
} from '../components';
import { colour, layout } from '../theme';

/**
 * The first screen a pharmacy owner sees, and it now says something.
 *
 * It used to be a list of buttons to other screens — a signpost, built from raw
 * `Pressable` and `StyleSheet` rather than the primitives, with every word
 * hard-coded in English ("Welcome, Rahim", "Money", "Sign out") on the screen
 * that opens most often. It also announced the reader's own role back to them,
 * which is a thing a staff tool does and a shop does not care about.
 *
 * Three questions instead, in the order somebody opens the application to ask
 * them:
 *
 *   1. **What do I owe** — including the credit block, which is the one thing
 *      that stops them ordering at all.
 *   2. **What is coming** — the orders that have not arrived, and only those.
 *   3. **Can I just have that again** — one tap to refill the basket from the
 *      last order that actually arrived.
 *
 * The menu stays underneath, because everything else a shop can reach has to be
 * reachable from somewhere.
 */
export function CustomerHome({ menu }: { menu: React.ReactNode }) {
  const { t, language } = useLanguage();
  const replaceBasket = useCart((state) => state.replace);
  const [summary, setSummary] = useState<ShopFinanceSummary>();
  const [orders, setOrders] = useState<Order[]>();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [repeating, setRepeating] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      /*
       * Both together, and a failure of either is one message. Two independent
       * spinners on a home screen is how a phone looks broken on a slow
       * connection.
       */
      const [money, placed] = await Promise.all([getMyFinanceSummary(), apiClient.get('/orders')]);
      setSummary(money);
      setOrders(placed.data.data);
    } catch (caught) {
      setError(errorMessage(caught, language, t('account.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, t]);

  // Refreshed on focus, so coming back from sending an order shows it arriving
  // in "on its way" rather than a figure from before it existed.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const repeat = useCallback(
    async (order: Order) => {
      setRepeating(true);
      try {
        const response = await apiClient.post(`/orders/${order._id}/duplicate`);
        const draft = response.data.data as Order;
        const lines: CartLine[] = draft.items.map((item) => ({
          medicineId: String(item.medicineId),
          quantity: item.requestedQuantity,
          snapshot: {
            brandName: item.medicineSnapshot.brandName,
            strength: item.medicineSnapshot.strength,
            minimum: 1,
          },
        }));
        replaceBasket(lines, String(draft._id));
        toast.success(t('orders.reorderReady'));
        router.push('/(protected)/(tabs)/cart');
      } catch (caught) {
        toast.error(errorMessage(caught, language, t('orders.reorderFailed')));
      } finally {
        setRepeating(false);
      }
    },
    [language, replaceBasket, t],
  );

  if (!summary && !orders && !error) {
    return (
      <Screen>
        <LoadingState label={t('home.loading')} />
      </Screen>
    );
  }

  const coming = stillComing(orders ?? []);
  const again = worthRepeating(orders ?? []);

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
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {summary ? (
        <>
          <Text
            accessibilityRole="header"
            style={{ fontSize: layout.fontSize.xl, fontWeight: '700', color: colour.text }}
          >
            {summary.shop.name}
          </Text>

          {summary.creditBlocked ? (
            <Card style={{ borderColor: colour.danger }}>
              <Text
                accessibilityRole="header"
                style={{ color: colour.danger, fontWeight: '700', fontSize: layout.fontSize.lg }}
              >
                {t('account.creditBlockedTitle')}
              </Text>
              <Text style={{ color: colour.text }}>
                {summary.blockReason ?? t('account.creditBlockedBody')}
              </Text>
              <Button
                variant="secondary"
                label={t('account.seeWhatIsOwed')}
                onPress={() => router.push('/(protected)/statement')}
              />
            </Card>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
            <Metric
              label={t('account.currentDue')}
              value={formatMoneyMinor(summary.outstandingBalanceMinor)}
              tone={summary.outstandingBalanceMinor > 0 ? 'warning' : 'normal'}
            />
            <Metric
              label={t('account.overdue')}
              value={formatMoneyMinor(summary.overdueBalanceMinor)}
              tone={summary.overdueBalanceMinor > 0 ? 'warning' : 'normal'}
            />
            <Metric
              label={t('account.availableCredit')}
              value={formatMoneyMinor(summary.availableCreditMinor)}
            />
          </View>
        </>
      ) : null}

      <SectionTitle>{t('home.onItsWay')}</SectionTitle>
      {coming.length === 0 ? (
        <Card>
          <Text style={{ color: colour.textMuted }}>{t('home.nothingComing')}</Text>
        </Card>
      ) : (
        coming.slice(0, 5).map((order) => (
          <CardLink
            key={order._id}
            accessibilityLabel={order.reference}
            onPress={() =>
              router.push({ pathname: '/(protected)/order-detail', params: { id: order._id } })
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
              <Text style={{ color: colour.text, fontWeight: '600' }}>{order.reference}</Text>
              <StatusPill kind="order" status={order.status} />
            </View>
            <ListRow
              label={t('orders.estimate')}
              value={formatMoneyMinor(order.estimatedTotalMinor)}
              numeric
            />
          </CardLink>
        ))
      )}

      {again ? (
        <Card>
          <SectionTitle>{t('home.orderAgain')}</SectionTitle>
          <Text style={{ color: colour.textMuted }}>
            {t('home.orderAgainBody', { reference: again.reference, count: again.items.length })}
          </Text>
          <Button label={t('orders.repeat')} busy={repeating} onPress={() => void repeat(again)} />
        </Card>
      ) : null}

      {menu}
    </ScrollView>
  );
}
