import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  DeliveryFailureReason,
  DeliveryStatus,
  RealtimeEvent,
  UserRole,
} from '@medsupply/shared-types';
import type { Delivery } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { isSafeOfflineDeliveryAction, queueDeliveryAction } from '../../src/delivery/offlineQueue';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { useAuthStore } from '../../src/store/useAuth';
import { ActivityTimelineView } from '../../src/notifications/ActivityTimelineView';
import { onRealtime } from '../../src/notifications/realtime';
import { formatFinanceDateTime } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  StatusPill,
  requireReason,
  statusLabel,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

type ApiFailure = { response?: { status?: number } };

/** The statuses from which a rider can still report that it did not work. */
const FAILABLE: readonly DeliveryStatus[] = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.HANDED_OVER,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.OUT_FOR_DELIVERY,
  DeliveryStatus.ARRIVED,
];

export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const role = useAuthStore((state) => state.user?.role);
  const isDriver = role === UserRole.DELIVERY_PERSON;
  const isStorekeeper = role === UserRole.STOREKEEPER;
  const canManageReturn =
    role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN || role === UserRole.MANAGER;

  const [delivery, setDelivery] = useState<Delivery>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  /**
   * One key per action, held until the server has an opinion.
   *
   * It was built inline from `Date.now()` on every attempt, so a rider whose
   * reply was lost — which on a cellular round is the normal failure, not the
   * unusual one — retried under a **new** key and the server had no way to
   * recognise the repeat. Replaced only after a 4xx, which means the request
   * was understood and refused, so the next attempt is a genuinely new one.
   */
  const keys = useRef(new Map<string, string>());
  const keyFor = (path: string) => {
    const held = keys.current.get(path);
    if (held) return held;
    const next = createFinancialIdempotencyKey(`delivery-${path}`, String(id ?? 'unknown'));
    keys.current.set(path, next);
    return next;
  };

  const load = useCallback(async () => {
    try {
      setDelivery((await apiClient.get(`/deliveries/${id}`)).data.data);
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('deliveryDetail.couldNotLoad')));
    } finally {
      setLoading(false);
    }
  }, [id, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // A storekeeper handover or manager reassignment refreshes this screen live.
  useEffect(
    () =>
      onRealtime(RealtimeEvent.DELIVERY_UPDATED, (payload) => {
        if ((payload as { entityId?: string })?.entityId === id) void load();
      }),
    [id, load],
  );

  async function act(path: string, body: Record<string, unknown>, confirmation: string) {
    if (!delivery || busy) return;
    setBusy(path);
    try {
      await apiClient.post(`/deliveries/${id}/${path}`, {
        version: delivery.version,
        idempotencyKey: keyFor(path),
        ...body,
      });
      keys.current.delete(path);
      toast.success(confirmation);
      setError('');
      await load();
    } catch (caught) {
      const status = (caught as ApiFailure).response?.status ?? 0;
      const unreachable = !(caught as ApiFailure).response || status >= 500;
      if (unreachable && isSafeOfflineDeliveryAction(path)) {
        await queueDeliveryAction(delivery._id, path, delivery.version, body);
        toast.info(t('delivery.savedOffline'));
      } else if (unreachable) {
        toast.error(t('delivery.needsConnection'));
      } else {
        // Understood and refused: the next attempt is a new one.
        keys.current.delete(path);
        toast.error(errorMessage(caught, language, t('delivery.rejected')));
      }
    } finally {
      setBusy('');
    }
  }

  /**
   * Reporting a failed attempt.
   *
   * The notes were a free `TextInput` guarded by `length >= 3`, so "no"
   * explained a delivery that did not happen — on the record management reads
   * to decide whether to send the rider back.
   */
  async function reportFailure() {
    const reason = await ask.choose({
      title: t('delivery.recordFailure'),
      description: t('delivery.failureReason'),
      options: Object.values(DeliveryFailureReason).map((value) => ({
        value,
        label: t(`deliveryFailureReason.${value}`),
      })),
    });
    if (!reason) return;

    const notes = await ask.prompt({
      title: t(`deliveryFailureReason.${reason}`),
      description: t('delivery.notes'),
      label: t('delivery.notes'),
      multiline: true,
      confirmLabel: t('delivery.recordFailure'),
      danger: true,
      validate: requireReason(t),
    });
    if (!notes) return;

    await act('fail', { reason, notes }, t('deliveryDetail.failedAttempt'));
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('deliveryDetail.loading')} />
      </Screen>
    );
  }

  if (!delivery) {
    return (
      <Screen>
        <ErrorState
          message={error || t('deliveryDetail.couldNotLoad')}
          onRetry={() => void load()}
        />
      </Screen>
    );
  }

  const pack = typeof delivery.packageId === 'string' ? undefined : delivery.packageId;
  const invoice = typeof delivery.invoiceId === 'string' ? undefined : delivery.invoiceId;
  const address = `${delivery.addressSnapshot.line1}, ${delivery.addressSnapshot.city}, ${delivery.addressSnapshot.district}`;

  return (
    <Screen>
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
          <SectionTitle>{delivery.reference}</SectionTitle>
          <StatusPill kind="delivery" status={delivery.status} />
        </View>
        <ListRow label={t('delivery.contact')} value={delivery.contactSnapshot.name} />
        <ListRow label={t('fields.phone')} value={delivery.contactSnapshot.phone} />
        <ListRow label={t('delivery.address')} value={address} />
        {pack ? (
          <ListRow
            label={t('deliveryDetail.package')}
            value={`${pack.reference} · ${t('deliveryDetail.packageCount', {
              count: pack.packageCount ?? 0,
            })}`}
          />
        ) : null}
        {invoice ? <ListRow label={t('fields.reference')} value={invoice.reference} /> : null}
        {delivery.instructions ? (
          <ListRow label={t('delivery.instruction')} value={delivery.instructions} />
        ) : null}

        <View style={{ flexDirection: 'row', gap: layout.space[2] }}>
          <Button
            variant="secondary"
            style={{ flex: 1 }}
            label={t('delivery.callShop')}
            onPress={() => void Linking.openURL(`tel:${delivery.contactSnapshot.phone}`)}
          />
          <Button
            variant="secondary"
            style={{ flex: 1 }}
            label={t('delivery.openMap')}
            onPress={() =>
              void Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
              )
            }
          />
        </View>
      </Card>

      {isStorekeeper && delivery.status === DeliveryStatus.ASSIGNED && pack && invoice ? (
        <Button
          label={t('deliveryDetail.confirmHandover')}
          busy={busy === 'handover'}
          onPress={() =>
            void act(
              'handover',
              {
                packageReference: pack.reference,
                invoiceReference: invoice.reference,
                packageCount: pack.packageCount,
              },
              t('deliveryDetail.handoverDone'),
            )
          }
        />
      ) : null}

      {isStorekeeper && delivery.status === DeliveryStatus.RETURNING ? (
        <Button
          label={t('deliveryDetail.confirmReturned')}
          busy={busy === 'returned'}
          onPress={() => void act('returned', {}, t('deliveryDetail.returnConfirmed'))}
        />
      ) : null}

      {isDriver &&
      delivery.status === DeliveryStatus.HANDED_OVER &&
      !delivery.handover?.acknowledgedAt ? (
        <Button
          label={t('delivery.acknowledge')}
          busy={busy === 'acknowledge'}
          onPress={() => void act('acknowledge', {}, t('delivery.acknowledged'))}
        />
      ) : null}

      {isDriver &&
      delivery.status === DeliveryStatus.HANDED_OVER &&
      delivery.handover?.acknowledgedAt ? (
        <Button
          label={t('delivery.confirmPickup')}
          busy={busy === 'pickup'}
          onPress={() => void act('pickup', {}, t('delivery.pickedUp'))}
        />
      ) : null}

      {isDriver && delivery.status === DeliveryStatus.PICKED_UP ? (
        <Button
          label={t('delivery.startRoute')}
          busy={busy === 'start'}
          onPress={() => void act('start', {}, t('delivery.routeStarted'))}
        />
      ) : null}

      {isDriver && delivery.status === DeliveryStatus.OUT_FOR_DELIVERY ? (
        <Button
          label={t('delivery.markArrived')}
          busy={busy === 'arrived'}
          onPress={() => void act('arrived', {}, t('delivery.arrived'))}
        />
      ) : null}

      {isDriver && delivery.status === DeliveryStatus.ARRIVED ? (
        <Card>
          <SectionTitle>{t('delivery.atTheShop')}</SectionTitle>
          <Button
            variant="secondary"
            label={t('delivery.sendOtp')}
            busy={busy === 'send-otp'}
            onPress={() => void act('send-otp', {}, t('delivery.otpSent'))}
          />
          <Button
            label={t('delivery.captureProof')}
            onPress={() =>
              router.push({ pathname: '/(protected)/delivery-proof', params: { id: delivery._id } })
            }
          />
        </Card>
      ) : null}

      {isDriver && FAILABLE.includes(delivery.status) ? (
        <Button
          variant="danger"
          label={t('delivery.recordFailure')}
          busy={busy === 'fail'}
          onPress={() => void reportFailure()}
        />
      ) : null}

      {(isDriver || canManageReturn) && delivery.status === DeliveryStatus.FAILED ? (
        <Button
          label={t('deliveryDetail.startReturn')}
          busy={busy === 'returning'}
          onPress={() => void act('returning', {}, t('deliveryDetail.returnStarted'))}
        />
      ) : null}

      <Card>
        <SectionTitle>{t('deliveryDetail.timeline')}</SectionTitle>
        {delivery.history.map((entry, index) => (
          <ListRow
            key={`${entry.to}-${index}`}
            // Was `entry.to.replaceAll('_', ' ')` — `OUT FOR DELIVERY` shouted
            // at a rider, and English whatever the app was set to.
            label={statusLabel(t, 'delivery', entry.to)}
            value={formatFinanceDateTime(entry.at)}
          />
        ))}
        {delivery.history.length === 0 ? (
          <Text style={{ color: colour.textMuted }}>{t('common.nothingHere')}</Text>
        ) : null}
      </Card>

      <ActivityTimelineView
        entityType="Delivery"
        entityId={String(delivery._id)}
        title={t('deliveryDetail.activity')}
      />
    </Screen>
  );
}
