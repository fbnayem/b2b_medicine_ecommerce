import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { getMyCollections, handoverPayment } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { formatMoneyMinor } from '../../src/finance/money';
import type { CollectionSummary, FinancePayment, ReferenceSnapshot } from '../../src/finance/types';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Metric,
  Screen,
  StatusPill,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

function reference(value?: string | ReferenceSnapshot) {
  return typeof value === 'string' ? value : value?.reference;
}

export default function CollectionsScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [items, setItems] = useState<FinancePayment[]>([]);
  const [summary, setSummary] = useState<CollectionSummary>({
    todayCollectedMinor: 0,
    pendingHandoverMinor: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  // One key per payment, held until the server confirms — a retry after a
  // dropped connection must carry the key the first attempt used.
  const handoverKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    try {
      const result = await getMyCollections(1, 100);
      setItems(result.items);
      setSummary(result.summary);
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('finance.couldNotLoadMyCollections')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handover(item: FinancePayment) {
    /*
     * Was `Alert.alert`, which renders outside React — untranslatable, and
     * invisible to a test, so a spec could pass while the handover never
     * happened.
     */
    const agreed = await ask.confirm({
      title: t('finance.handoverTitle'),
      description: t('finance.handoverBody', {
        amount: formatMoneyMinor(item.amountMinor),
        reference: item.reference,
      }),
      confirmLabel: t('finance.confirmHandover'),
    });
    if (!agreed) return;

    let key = handoverKeys.current.get(item._id);
    if (!key) {
      key = createFinancialIdempotencyKey('handover', item._id);
      handoverKeys.current.set(item._id, key);
    }
    setBusyId(item._id);
    try {
      await handoverPayment(item._id, key);
      handoverKeys.current.delete(item._id);
      toast.success(t('finance.handoverDone', { reference: item.reference }));
      setError('');
      await load();
    } catch (caught) {
      setError(errorMessage(caught, language, t('finance.handoverFailed')));
    } finally {
      setBusyId('');
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('finance.loadingCollections')} />
      </Screen>
    );
  }

  if (!items.length && error) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={{ flexDirection: 'row', gap: layout.space[3] }}>
        <Metric
          label={t('finance.collectedToday')}
          value={formatMoneyMinor(summary.todayCollectedMinor)}
        />
        <Metric
          label={t('finance.pendingHandover')}
          value={formatMoneyMinor(summary.pendingHandoverMinor)}
        />
      </View>
      <Text
        style={{
          color: colour.textMuted,
          textAlign: 'center',
          fontSize: layout.fontSize.sm,
        }}
      >
        {t('finance.dhakaBusinessDate')}
      </Text>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <FlatList
        data={items}
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
            title={t('finance.noMyCollections')}
            description={t('finance.noMyCollectionsBody')}
          />
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
              <Text
                style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.brand }}
              >
                {item.reference}
              </Text>
              <StatusPill kind="payment" status={item.status} />
            </View>
            <Text
              style={{
                fontSize: layout.fontSize['2xl'],
                fontWeight: '700',
                color: colour.text,
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatMoneyMinor(item.amountMinor)}
            </Text>
            <ListRow label={t('finance.method')} value={t(`paymentMethod.${item.method}`)} />
            <ListRow label={t('finance.delivery')} value={reference(item.deliveryId) ?? '—'} />
            <ListRow label={t('finance.invoice')} value={reference(item.invoiceId) ?? '—'} />
            <ListRow
              label={t('finance.collectedAt')}
              value={formatFinanceDate(item.collectionTime ?? item.createdAt)}
            />
            <ListRow
              label={t('finance.handoverLabel')}
              value={<Badge>{t(`handoverStatus.${item.handoverStatus ?? 'NOT_REQUIRED'}`)}</Badge>}
            />

            <Button
              variant="secondary"
              label={t('common.view')}
              onPress={() =>
                router.push({ pathname: '/(protected)/payment-detail', params: { id: item._id } })
              }
            />
            {item.handoverStatus === 'PENDING' ? (
              <Button
                busy={busyId === item._id}
                label={
                  busyId === item._id
                    ? t('finance.confirmingHandover')
                    : t('finance.confirmHandover')
                }
                onPress={() => void handover(item)}
              />
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}
