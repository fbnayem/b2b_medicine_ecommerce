import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Delivery, User } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { formatFinanceDateTime } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  StatusPill,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Where is my order — the **customer's** view of a delivery.
 *
 * Deliberately not `delivery-detail.tsx`, which is the rider's working screen:
 * it filters to a rider's active statuses, drives an offline action queue and
 * carries the buttons that move a delivery along. A shop owner sent there sees
 * a screen full of controls that are not theirs to press.
 *
 * This one only reads. It answers the three questions a pharmacy asks — has it
 * left, who is bringing it, and what happened.
 *
 * **No telephone number for the rider.** `permittedDelivery` populates
 * `assignedTo` with `firstName lastName email` and no phone, which is a
 * decision rather than an oversight: a rider's personal number handed to every
 * customer they deliver to is not something to add from a screen. The name is
 * the useful part — somebody is expecting a person, and now they know which.
 */
export default function DeliveryTrackScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { t, language } = useLanguage();
  const [delivery, setDelivery] = useState<Delivery | null>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get(`/deliveries/order/${orderId}`);
      setDelivery(response.data.data);
    } catch (caught) {
      const status = (caught as { response?: { status?: number } }).response?.status;
      /*
       * A 404 here is not a failure. `getOrderDelivery` answers "Delivery not
       * created yet" until one is assigned, and an order still in the warehouse
       * is the ordinary case rather than something going wrong. It gets an
       * empty state, not an error card with a retry button that changes nothing.
       */
      if (status === 404) {
        setDelivery(null);
        return;
      }
      setError(errorMessage(caught, language, t('delivery.couldNotLoad')));
    }
  }, [orderId, language, t]);

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

  if (delivery === undefined) {
    return (
      <Screen>
        <LoadingState label={t('delivery.loadingOne')} />
      </Screen>
    );
  }

  if (delivery === null) {
    return (
      <Screen>
        <EmptyState
          title={t('delivery.notDispatched')}
          description={t('delivery.notDispatchedBody')}
        />
      </Screen>
    );
  }

  const rider = typeof delivery.assignedTo === 'object' ? (delivery.assignedTo as User) : undefined;
  const riderName = rider ? `${rider.firstName} ${rider.lastName}`.trim() : '';

  return (
    <Screen>
      <Text style={{ color: colour.brand, fontSize: layout.fontSize.sm }}>
        {delivery.reference}
      </Text>
      <StatusPill kind="delivery" status={delivery.status} />

      <Card>
        <SectionTitle>{t('delivery.whoIsBringingIt')}</SectionTitle>
        {riderName ? (
          <ListRow label={t('delivery.rider')} value={riderName} />
        ) : (
          <Text style={{ color: colour.textMuted }}>{t('delivery.riderNotAssigned')}</Text>
        )}
        {delivery.expectedDeliveryDate ? (
          <ListRow
            label={t('delivery.expected')}
            value={formatFinanceDateTime(delivery.expectedDeliveryDate)}
          />
        ) : null}
      </Card>

      <Card>
        <SectionTitle>{t('delivery.progress')}</SectionTitle>
        {delivery.history.length === 0 ? (
          <Text style={{ color: colour.textMuted }}>{t('delivery.noProgressYet')}</Text>
        ) : (
          delivery.history.map((entry, index) => (
            <ListRow
              key={`${entry.to}-${index}`}
              label={formatFinanceDateTime(entry.at)}
              value={<StatusPill kind="delivery" status={entry.to} />}
            />
          ))
        )}
      </Card>

      {delivery.proof ? (
        <Card>
          <SectionTitle>{t('delivery.delivered')}</SectionTitle>
          <ListRow
            label={t('delivery.deliveredAt')}
            value={formatFinanceDateTime(delivery.proof.deliveredAt)}
          />
          <ListRow label={t('finance.receivedBy')} value={delivery.proof.receiverName} />
        </Card>
      ) : null}

      {delivery.failure ? (
        <Card style={{ borderColor: colour.danger }}>
          <SectionTitle>{t('delivery.whatWentWrong')}</SectionTitle>
          <ListRow
            label={t('delivery.reason')}
            value={t(`deliveryFailureReason.${delivery.failure.reason}`)}
          />
          <Text style={{ color: colour.text }}>{delivery.failure.notes}</Text>
          <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
            {formatFinanceDateTime(delivery.failure.reportedAt)}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
