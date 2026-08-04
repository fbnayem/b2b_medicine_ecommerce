import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { failPayment, getPayments, postPayment } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { formatMoneyMinor } from '../../src/finance/money';
import type { FinancePayment, ReferenceSnapshot } from '../../src/finance/types';
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

function reference(value?: string | ReferenceSnapshot) {
  return typeof value === 'string' ? value : value?.reference;
}

export default function CollectionReviewScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [items, setItems] = useState<FinancePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const actionKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    try {
      setItems(
        (
          await getPayments({
            status: 'PENDING',
            source: 'DELIVERY_COLLECTION',
            page: 1,
            limit: 100,
          })
        ).items,
      );
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('finance.couldNotLoadCollections')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function keyFor(action: string, id: string) {
    const index = `${action}:${id}`;
    const existing = actionKeys.current.get(index);
    if (existing) return existing;
    const next = createFinancialIdempotencyKey(action, id);
    actionKeys.current.set(index, next);
    return next;
  }

  async function approve(item: FinancePayment) {
    const agreed = await ask.confirm({
      title: t('finance.postTitle'),
      description: `${formatMoneyMinor(item.amountMinor)} — ${t('finance.postBody')}`,
      confirmLabel: t('finance.postConfirm'),
    });
    if (!agreed) return;

    setBusyId(item._id);
    try {
      await postPayment(item._id, keyFor('post', item._id));
      actionKeys.current.delete(`post:${item._id}`);
      toast.success(t('finance.postedOk'));
      setError('');
      await load();
    } catch (caught) {
      setError(errorMessage(caught, language, t('finance.postFailed')));
    } finally {
      setBusyId('');
    }
  }

  async function reject(item: FinancePayment) {
    /*
     * The reason is asked for by the same dialog and held to the same minimum
     * as everywhere else. This screen used to accept three characters where
     * `requireReason` asks for five, so "no" was a valid explanation for money
     * that never arrived.
     */
    const reason = await ask.prompt({
      title: t('finance.rejectTitle'),
      description: t('finance.rejectBody'),
      label: t('actions.reason'),
      multiline: true,
      confirmLabel: t('finance.rejectConfirm'),
      danger: true,
      validate: requireReason(t),
    });
    if (!reason) return;

    setBusyId(item._id);
    try {
      await failPayment(item._id, reason.trim(), keyFor('fail', item._id));
      actionKeys.current.delete(`fail:${item._id}`);
      toast.success(t('finance.rejected'));
      setError('');
      await load();
    } catch (caught) {
      setError(errorMessage(caught, language, t('finance.rejectFailed')));
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
            title={t('finance.noCollections')}
            description={t('finance.noCollectionsBody')}
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
            <ListRow label={t('finance.invoice')} value={reference(item.invoiceId) ?? '—'} />
            <ListRow label={t('finance.delivery')} value={reference(item.deliveryId) ?? '—'} />
            <ListRow
              label={t('finance.collectedAt')}
              value={formatFinanceDate(item.collectionTime ?? item.createdAt)}
            />
            {item.transactionReference ? (
              <ListRow
                label={t('finance.transactionReference')}
                value={item.transactionReference}
              />
            ) : null}
            <ListRow
              label={t('finance.paymentProof')}
              value={item.attachmentFileId ? t('finance.attachment') : t('finance.noAttachment')}
            />

            <Button
              variant="secondary"
              label={t('common.view')}
              onPress={() =>
                router.push({ pathname: '/(protected)/payment-detail', params: { id: item._id } })
              }
            />
            <View style={{ flexDirection: 'row', gap: layout.space[2] }}>
              <Button
                variant="danger"
                style={{ flex: 1 }}
                disabled={busyId === item._id}
                label={t('finance.rejectCollection')}
                onPress={() => void reject(item)}
              />
              <Button
                style={{ flex: 1 }}
                busy={busyId === item._id}
                label={t('finance.postPayment')}
                onPress={() => void approve(item)}
              />
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
