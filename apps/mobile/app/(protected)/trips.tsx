import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { Trip } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { formatFinanceDate } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
  requireReason,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Rounds, and calling one off.
 *
 * `trip.tsx` is the rider's own round; this is the planner's view of all of
 * them. Planning a new one is a desk job — it means choosing from a list of
 * plannable deliveries and putting them in an order, which is a drag-and-drop
 * on a monitor — so this screen **reads** the rounds and offers the one action
 * somebody needs away from a desk: **cancelling** one, when a van breaks down.
 *
 * Cancelling is safe to do from a phone precisely because it changes nothing
 * else: every delivery is left exactly as it was, still assigned and still
 * workable on its own.
 */
export default function TripsScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [trips, setTrips] = useState<Trip[]>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get('/trips');
      setTrips(response.data.data as Trip[]);
    } catch (caught) {
      setError(errorMessage(caught, language, t('trips.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function cancel(trip: Trip) {
    const reason = await ask.prompt({
      title: t('trips.cancelTitle'),
      description: t('trips.cancelBody'),
      label: t('actions.reason'),
      confirmLabel: t('trips.cancelConfirm'),
      multiline: true,
      danger: true,
      validate: requireReason(t),
    });
    if (reason === null) return;

    setBusy(trip._id);
    try {
      await apiClient.post(`/trips/${trip._id}/cancel`, { reason: reason.trim() });
      toast.success(t('trips.cancelled'));
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('trips.cancelFailed')));
    } finally {
      setBusy('');
    }
  }

  if (!trips && !error) {
    return (
      <Screen>
        <LoadingState label={t('trips.loading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <FlatList
        data={trips ?? []}
        keyExtractor={(trip) => trip._id}
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
          <EmptyState title={t('trips.none')} description={t('trips.noneBodyPlanner')} />
        }
        renderItem={({ item }) => (
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: layout.space[2],
              }}
            >
              <Text style={{ color: colour.brand, fontWeight: '600' }}>{item.reference}</Text>
              <StatusPill kind="trip" status={item.status} />
            </View>
            <ListRow label={t('trips.date')} value={formatFinanceDate(item.tripDate)} />
            <ListRow label={t('trips.stops')} value={item.stops?.length ?? 0} numeric />
            <Button
              variant="secondary"
              label={t('trips.open')}
              onPress={() => router.push(`/(protected)/trip?id=${item._id}` as never)}
            />
            {item.status === 'PLANNED' || item.status === 'IN_PROGRESS' ? (
              <Button
                variant="secondary"
                busy={busy === item._id}
                label={t('trips.cancel')}
                accessibilityLabel={t('trips.cancelNamed', { reference: item.reference })}
                onPress={() => void cancel(item)}
              />
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}
