import { useCallback, useEffect, useState } from 'react';
import { Linking, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Trip } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { currentTrip, fetchMyTrips, orderedStops, startTrip } from '../../src/delivery/trips';
import { formatFinanceDate } from '../../src/finance/date';
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
  SectionTitle,
  StatusPill,
  toast,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Today's round, in the order it is meant to be driven.
 *
 * A rider had no view of their day at all: deliveries were assigned one at a
 * time and the round lived on paper. Every stop still opens the delivery screen
 * that already works — this adds the sequence and the running count, and takes
 * nothing away.
 */
export default function TripScreen() {
  const { t, language } = useLanguage();
  const [trip, setTrip] = useState<Trip>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setTrip(currentTrip(await fetchMyTrips()));
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('trips.couldNotLoad')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function begin() {
    if (!trip || busy) return;
    setBusy(true);
    try {
      await startTrip(trip._id, trip.version);
      toast.success(t('trips.started'));
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('trips.startFailed')));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('trips.loading')} />
      </Screen>
    );
  }

  if (!trip) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <EmptyState title={t('trips.none')} description={t('trips.noneBody')} />
        )}
      </Screen>
    );
  }

  const stops = orderedStops(trip);

  return (
    <Screen
      scroll
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

      <Card>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: layout.space[2],
          }}
        >
          <SectionTitle>{trip.reference}</SectionTitle>
          <Badge tone={trip.status === 'IN_PROGRESS' ? 'brand' : 'info'}>
            {t(`tripStatus.${trip.status}`)}
          </Badge>
        </View>
        <ListRow label={t('trips.day')} value={formatFinanceDate(trip.tripDate)} />
        {trip.vehicleReference ? (
          <ListRow label={t('trips.vehicle')} value={trip.vehicleReference} />
        ) : null}
        <ListRow
          label={t('trips.stops')}
          value={trip.summary?.stopsTotal ?? stops.length}
          numeric
        />
        <ListRow label={t('trips.remaining')} value={trip.summary?.stopsRemaining ?? 0} numeric />
        <ListRow label={t('trips.packages')} value={trip.summary?.packages ?? 0} numeric />
        {trip.notes ? <Text style={{ color: colour.text }}>{trip.notes}</Text> : null}
      </Card>

      {trip.status === 'PLANNED' ? (
        <Button label={t('trips.start')} busy={busy} onPress={() => void begin()} />
      ) : null}

      <SectionTitle>{t('trips.stops')}</SectionTitle>
      {stops.map((stop, index) => {
        const delivery = stop.delivery;
        const shop = typeof delivery?.shopId === 'string' ? undefined : delivery?.shopId;
        return (
          <Card key={stop._id}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: layout.space[3],
              }}
            >
              {/*
               * The stop number, large, because a rider glances at this while
               * holding a box and needs to know which one they are on.
               */}
              <Text
                style={{
                  minWidth: layout.space[8],
                  fontSize: layout.fontSize['2xl'],
                  fontWeight: '700',
                  color: colour.brand,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {index + 1}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: colour.text }}>
                  {shop?.name ?? delivery?.reference ?? '—'}
                </Text>
                {delivery?.addressSnapshot ? (
                  <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                    {delivery.addressSnapshot.line1}, {delivery.addressSnapshot.city}
                  </Text>
                ) : null}
              </View>
              {delivery ? <StatusPill kind="delivery" status={delivery.status} /> : null}
            </View>

            {delivery?.contactSnapshot?.phone ? (
              <Button
                variant="secondary"
                label={t('delivery.callShop')}
                onPress={() => void Linking.openURL(`tel:${delivery.contactSnapshot?.phone ?? ''}`)}
              />
            ) : null}

            {delivery ? (
              <Button
                label={t('trips.openDelivery')}
                onPress={() =>
                  router.push({
                    pathname: '/(protected)/delivery-detail',
                    params: { id: delivery._id },
                  })
                }
              />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
