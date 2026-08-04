import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Order } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { ActivityTimelineView } from '../../src/notifications/ActivityTimelineView';
import { formatMoneyMinor } from '../../src/finance/money';
import { formatFinanceDateTime } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  StatusPill,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

export default function OrderDetailScreen() {
  const { id, submitted } = useLocalSearchParams<{ id: string; submitted?: string }>();
  const { t, language } = useLanguage();
  const [order, setOrder] = useState<Order>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get(`/orders/${id}`);
      setOrder(response.data.data);
    } catch (caught) {
      setError(errorMessage(caught, language, t('orders.couldNotLoadOne')));
    }
  }, [id, language, t]);

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

  if (!order) {
    return (
      <Screen>
        <LoadingState label={t('orders.loadingOne')} />
      </Screen>
    );
  }

  return (
    <Screen>
      {submitted ? (
        <View
          accessible
          accessibilityRole="alert"
          style={{
            backgroundColor: colour.brandSubtle,
            borderRadius: layout.radius.md,
            padding: layout.space[3],
          }}
        >
          <Text style={{ color: colour.text, fontWeight: '600' }}>{t('orders.submitted')}</Text>
        </View>
      ) : null}

      <Text style={{ color: colour.brand, fontSize: layout.fontSize.sm }}>{order.reference}</Text>
      <StatusPill kind="order" status={order.status} />

      <Card>
        <SectionTitle>{t('orders.whatYouOrdered')}</SectionTitle>
        {order.items.map((item) => (
          <ListRow
            key={item.medicineId}
            label={`${item.medicineSnapshot.brandName} × ${item.requestedQuantity}`}
            value={formatMoneyMinor(item.estimatedLineTotalMinor)}
            numeric
          />
        ))}
        <ListRow
          label={t('orders.estimatedTotal')}
          value={formatMoneyMinor(order.estimatedTotalMinor)}
          numeric
        />
      </Card>

      <Card>
        <SectionTitle>{t('orders.timeline')}</SectionTitle>
        {order.statusHistory.map((entry, index) => (
          <ListRow
            key={`${entry.to}-${index}`}
            label={formatFinanceDateTime(entry.at)}
            value={<StatusPill kind="order" status={entry.to} />}
          />
        ))}
      </Card>

      <ActivityTimelineView
        entityType="Order"
        entityId={String(order._id)}
        title={t('orders.activity')}
      />
    </Screen>
  );
}
