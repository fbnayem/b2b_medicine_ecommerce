import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { Medicine, MedicineBatch } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { blockBatch, getBatch } from '../../src/warehouse/recall';
import { formatFinanceDate } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  requireReason,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * One batch, and where its units actually are.
 *
 * `GET /inventory/batches/{id}` had **no caller on any client** — not this one,
 * not web — although both list batches. The difference is the breakdown: the
 * list gives a batch a headline figure, and this says how much of it is
 * reserved for orders already approved, how much is quarantined and how much is
 * genuinely free to promise to somebody.
 *
 * That gap is where stock gets promised twice. A storekeeper reading "400 on
 * hand" and telling a rep it can go out has not seen that 380 of it is already
 * spoken for.
 */
export default function BatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [batch, setBatch] = useState<MedicineBatch>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setBatch((await getBatch(id)) as unknown as MedicineBatch);
    } catch (caught) {
      setError(errorMessage(caught, language, t('inventory.batchCouldNotLoad')));
    }
  }, [id, language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function toggleBlock() {
    if (!batch) return;
    const blocking = !batch.isBlocked;
    const reason = await ask.prompt({
      title: blocking ? t('inventory.blockTitle') : t('inventory.unblockTitle'),
      description: blocking ? t('inventory.blockBody') : t('inventory.unblockBody'),
      label: t('inventory.blockReason'),
      confirmLabel: blocking ? t('inventory.blockConfirm') : t('inventory.unblockConfirm'),
      multiline: true,
      danger: blocking,
      // Blocking a batch takes it out of every order that has not been picked.
      // Whoever reads this next month needs the sentence, not the fact alone.
      validate: requireReason(t),
    });
    if (reason === null) return;

    setBusy(true);
    try {
      await blockBatch(batch._id, blocking, reason);
      toast.success(blocking ? t('inventory.blocked') : t('inventory.unblocked'));
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('inventory.blockFailed')));
    } finally {
      setBusy(false);
    }
  }

  if (!batch) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <LoadingState label={t('inventory.batchLoading')} />
        )}
      </Screen>
    );
  }

  const medicine =
    typeof batch.medicineId === 'string' ? undefined : (batch.medicineId as Medicine);
  const quantities = batch.quantities;

  return (
    <Screen>
      <Text style={{ color: colour.text, fontWeight: '600', fontSize: layout.fontSize.lg }}>
        {medicine?.brandName ?? ''} {medicine?.strength ?? ''}
      </Text>
      <Text style={{ color: colour.brand }}>{batch.batchNumber}</Text>

      <View style={{ flexDirection: 'row', gap: layout.space[2], flexWrap: 'wrap' }}>
        {batch.isBlocked ? <Badge tone="danger">{t('purchasing.blocked')}</Badge> : null}
        {batch.isQuarantined ? <Badge tone="warning">{t('purchasing.quarantined')}</Badge> : null}
      </View>

      <Card>
        <ListRow label={t('fields.expiry')} value={formatFinanceDate(batch.expiryDate)} />
        <ListRow
          label={t('purchasing.manufacturingDate')}
          value={formatFinanceDate(batch.manufacturingDate)}
        />
        <ListRow label={t('purchasing.warehouseLocation')} value={batch.warehouseLocation} />
        <ListRow label={t('inventory.receivedQuantity')} value={batch.receivedQuantity} numeric />
      </Card>

      <SectionTitle>{t('inventory.whereTheUnitsAre')}</SectionTitle>
      <Card>
        {/*
          The reason this screen exists. "On hand" is not "free to sell", and
          the gap between them is stock already promised to an approved order.
          A storekeeper who reads only the first figure promises it twice.
        */}
        <ListRow label={t('warehouses.onHand')} value={quantities?.onHand ?? 0} numeric />
        <ListRow label={t('inventory.reserved')} value={quantities?.reserved ?? 0} numeric />
        <ListRow label={t('warehouses.available')} value={quantities?.available ?? 0} numeric />
        <ListRow
          label={t('inventory.quarantinedUnits')}
          value={quantities?.quarantined ?? 0}
          numeric
        />
        <ListRow label={t('inventory.damagedUnits')} value={quantities?.damaged ?? 0} numeric />
      </Card>

      <Button
        variant="secondary"
        busy={busy}
        label={batch.isBlocked ? t('inventory.unblock') : t('inventory.block')}
        onPress={() => void toggleBlock()}
      />
    </Screen>
  );
}
