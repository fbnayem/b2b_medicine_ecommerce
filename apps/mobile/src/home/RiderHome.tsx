import { useCallback, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { Delivery, Trip } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { loadCachedDeliveries, loadDeliveryQueue } from '../delivery/offlineQueue';
import { fetchMyTrips } from '../delivery/trips';
import { getMyCollections } from '../finance/api';
import { formatMoneyMinor } from '../finance/money';
import { useLanguage } from '../i18n/useLanguage';
import {
  currentTrip,
  goodsToReturn,
  nextStop,
  remainingStops,
  roundFacts,
  type RoundFact,
  type Stop,
} from './round';
import { Button, Card, CardLink, EmptyState, LoadingState, SectionTitle } from '../components';
import { colour, layout } from '../theme';

/**
 * A rider's home: where they are going next, and what they are still carrying.
 *
 * It was the third branch of `dashboard.tsx` — a notifications button and a list
 * of links, which is the signpost a pharmacy lost in Phase 37 and a manager in
 * Phase 39. The comment defending it argued that a rider's five tabs already
 * carry their day. The tabs carry the *lists*; they do not answer "where next",
 * "how much cash am I holding" or "what has this phone not managed to send", and
 * those are the three reasons a rider opens it.
 *
 * The next stop is a card rather than a row, with **Call** and **Navigate** on
 * it, because the two things a rider does before driving anywhere are ring the
 * shop and open the map. Both were two screens away.
 */
export function RiderHome({ menu }: { menu: React.ReactNode }) {
  const { t } = useLanguage();
  const [stop, setStop] = useState<Stop>();
  const [facts, setFacts] = useState<RoundFact[]>();
  const [carryingMinor, setCarryingMinor] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    /*
     * Four questions, and any of them may fail without taking the screen with
     * it — `allSettled` for the reason `StaffHome` uses it, and more so here: a
     * rider is often on one bar of signal, and a home screen that shows nothing
     * because the collections request timed out is a home screen that appears
     * broken exactly when it is most needed.
     *
     * The deliveries fall back to the cache the deliveries tab already keeps,
     * so a rider with no signal at all still sees their round.
     */
    const [round, deliveries, collections, queued] = await Promise.allSettled([
      fetchMyTrips(),
      apiClient.get('/deliveries'),
      getMyCollections(1, 1),
      loadDeliveryQueue(),
    ]);

    const trip: Trip | undefined =
      round.status === 'fulfilled' ? currentTrip(round.value) : undefined;
    const active: Delivery[] =
      deliveries.status === 'fulfilled'
        ? (deliveries.value.data.data as Delivery[])
        : await loadCachedDeliveries();
    const pending = collections.status === 'fulfilled' ? collections.value.summary : undefined;

    setStop(nextStop(trip, active));
    setCarryingMinor(pending?.pendingHandoverMinor ?? 0);
    setFacts(
      roundFacts({
        remaining: remainingStops(trip, active),
        carryingMinor: pending?.pendingHandoverMinor ?? 0,
        unsent: queued.status === 'fulfilled' ? queued.value.length : 0,
        toReturn: goodsToReturn(active),
      }),
    );
    setRefreshing(false);
  }, []);

  // On focus rather than on mount: finishing a stop and coming back must show
  // the one after it, not the one just delivered.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!facts) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colour.canvas }}>
        <View style={{ padding: layout.space[4] }}>
          <LoadingState label={t('riderHome.loading')} />
        </View>
      </ScrollView>
    );
  }

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
      <SectionTitle>{t('riderHome.nextStop')}</SectionTitle>
      {stop ? <NextStop stop={stop} /> : <EmptyState title={t('riderHome.roundDone')} />}

      {facts.map((fact) => (
        <Fact key={fact.kind} fact={fact} carryingMinor={carryingMinor} />
      ))}

      <SectionTitle>{t('staffHome.everythingElse')}</SectionTitle>
      {menu}
    </ScrollView>
  );
}

/** Where to go, who to ring, and how far through the round it is. */
function NextStop({ stop }: { stop: Stop }) {
  const { t } = useLanguage();
  const destination = `${stop.name}, ${stop.address}`;

  return (
    <Card>
      <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
        {t('riderHome.stopOf', { position: stop.position, total: stop.total })}
      </Text>
      <Text style={{ fontSize: layout.fontSize.xl, fontWeight: '700', color: colour.text }}>
        {stop.name}
      </Text>
      <Text style={{ color: colour.text }}>{stop.address}</Text>

      <View style={{ flexDirection: 'row', gap: layout.space[2] }}>
        {stop.phone ? (
          <Button
            variant="secondary"
            style={{ flex: 1 }}
            label={t('delivery.callShop')}
            onPress={() => void Linking.openURL(`tel:${stop.phone}`)}
          />
        ) : null}
        <Button
          variant="secondary"
          style={{ flex: 1 }}
          label={t('delivery.openMap')}
          onPress={() =>
            void Linking.openURL(
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`,
            )
          }
        />
      </View>

      <Button
        label={t('riderHome.openStop')}
        onPress={() =>
          router.push({
            pathname: '/(protected)/delivery-detail',
            params: { id: stop.deliveryId },
          })
        }
      />
    </Card>
  );
}

/**
 * One fact, as a row somebody can tap.
 *
 * The figure is announced **before** the label to a screen reader — "৳12,500
 * collected and not handed in" rather than the other way round — because the
 * number is the reason to stop on this row. Same arrangement as `StaffHome`.
 */
function Fact({ fact, carryingMinor }: { fact: RoundFact; carryingMinor: number }) {
  const { t } = useLanguage();
  const figure = fact.kind === 'carrying' ? formatMoneyMinor(carryingMinor) : String(fact.value);
  const label =
    fact.kind === 'carrying'
      ? t('riderHome.fact.carrying')
      : t(`riderHome.fact.${fact.kind}`, { count: fact.value });

  return (
    <CardLink
      accessibilityLabel={`${figure} ${label}`}
      onPress={() => router.push(fact.route as never)}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: layout.space[3] }}>
        <Text
          style={{
            fontSize: layout.fontSize['2xl'],
            fontWeight: '700',
            color: fact.blocking ? colour.brand : colour.text,
            fontVariant: ['tabular-nums'],
          }}
        >
          {figure}
        </Text>
        <Text style={{ flexShrink: 1, color: colour.text, fontWeight: '600' }}>{label}</Text>
      </View>
    </CardLink>
  );
}
