import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Medicine, MedicineBatch, StockMovementType } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../../src/api/client';
import { formatFinanceDate } from '../../../src/finance/date';
import { createFinancialIdempotencyKey } from '../../../src/finance/idempotency';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FilterChips,
  FilterOption,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  requireReason,
  toast,
  useAsk,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

/** The changes a storekeeper may record from the shelf, in the order they occur. */
const ACTIONS: readonly StockMovementType[] = [
  StockMovementType.ADDITION,
  StockMovementType.DAMAGE,
  StockMovementType.EXPIRY,
  StockMovementType.QUARANTINE,
  StockMovementType.QUARANTINE_RELEASE,
];

/** The three that take stock off the shelf, which the sheet marks as destructive. */
const REDUCES_STOCK: readonly StockMovementType[] = [
  StockMovementType.DAMAGE,
  StockMovementType.EXPIRY,
  StockMovementType.QUARANTINE,
];

const WARNINGS = ['', 'low-stock', 'near-expiry', 'expired'] as const;
const WARNING_KEY: Record<(typeof WARNINGS)[number], string> = {
  '': 'inventory.allBatches',
  'low-stock': 'inventory.lowStock',
  'near-expiry': 'inventory.nearExpiry',
  expired: 'inventory.expired',
};

export default function InventoryScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [warning, setWarning] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(
    async (refresh = false) => {
      // Was `refresh ? setRefreshing(true) : setLoading(true)` — a ternary
      // evaluated for its effects, which the linter has been reporting since
      // the file was written.
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        const params = warning ? { warning } : {};
        setBatches((await apiClient.get('/inventory/batches', { params })).data.data);
        setError('');
      } catch (caught) {
        setError(errorMessage(caught, language, t('inventory.couldNotLoad')));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [warning, language, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Recording a change to what is on the shelf.
   *
   * The reason is not ceremony. A stock movement is an append-only record an
   * inspector may read years later, and "somebody reduced this batch by six"
   * with no explanation is exactly the entry nobody can account for. This
   * screen asked for three characters where the rest of the product asks for
   * five, so "no" was an acceptable account of six missing units.
   *
   * The whole flow was a hand-built `Modal` with two unlabelled `TextInput`s
   * and a row of `Pressable`s showing `QUARANTINE_RELEASE` verbatim.
   */
  async function recordChange(batch: MedicineBatch, type: StockMovementType) {
    const action = t(`movementType.${type}`);
    const raw = await ask.prompt({
      title: t('inventory.recordTitle', { action }),
      description: t('inventory.recordBody', { batch: batch.batchNumber }),
      label: t('inventory.howMany'),
      numeric: true,
      confirmLabel: t('inventory.recordTitle', { action }),
      danger: true,
      validate: (value) =>
        Number.isInteger(Number(value)) && Number(value) > 0 ? null : t('inventory.badQuantity'),
    });
    if (!raw) return;

    const reason = await ask.prompt({
      title: t('inventory.whyTitle'),
      description: t('inventory.whyBody'),
      label: t('actions.reason'),
      multiline: true,
      confirmLabel: t('inventory.recordIt'),
      danger: true,
      validate: requireReason(t),
    });
    if (!reason) return;

    setBusyId(batch._id);
    try {
      await apiClient.post(`/inventory/batches/${batch._id}/operations`, {
        type,
        quantity: Number(raw),
        reason,
        idempotencyKey: createFinancialIdempotencyKey(`stock-${type}`, batch._id),
      });
      toast.success(t('inventory.recorded', { action }));
      await load(true);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('inventory.actionFailed')));
    } finally {
      setBusyId('');
    }
  }

  /** One sheet, rather than five chips on every card in the list. */
  async function chooseAction(batch: MedicineBatch) {
    const chosen = await ask.choose({
      title: t('inventory.actionFor', { batch: batch.batchNumber }),
      description: t('inventory.chooseAction'),
      options: ACTIONS.map((type) => ({
        value: type,
        label: t(`movementType.${type}`),
        // Marked as destructive only where it takes stock off the shelf.
        danger: REDUCES_STOCK.includes(type),
      })),
    });
    if (!chosen) return;
    await recordChange(batch, chosen as StockMovementType);
  }

  const filters: FilterOption[] = WARNINGS.map((value) => ({
    value,
    label: t(WARNING_KEY[value]),
  }));

  return (
    <Screen scroll={false}>
      <FilterChips
        label={t('inventory.filterLabel')}
        value={warning}
        onChange={(next) => {
          setLoading(true);
          setWarning(next);
        }}
        options={filters}
      />

      {loading ? (
        <LoadingState label={t('inventory.loading')} />
      ) : (
        <>
          {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
          <FlatList
            data={batches}
            keyExtractor={(batch) => batch._id}
            contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
            }
            ListEmptyComponent={<EmptyState title={t('inventory.noBatches')} />}
            renderItem={({ item }) => {
              const medicine = item.medicineId as Medicine;
              return (
                <Card>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: layout.space[2],
                    }}
                  >
                    <View style={{ flexShrink: 1 }}>
                      <SectionTitle>{medicine.brandName}</SectionTitle>
                      <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                        {/* The batch number printed on the carton, never the id. */}
                        {item.batchNumber} · {item.warehouseLocation}
                      </Text>
                    </View>
                    {item.isBlocked ? <Badge tone="danger">{t('inventory.blocked')}</Badge> : null}
                  </View>

                  <ListRow
                    label={t('inventory.expiryDate')}
                    value={formatFinanceDate(item.expiryDate)}
                  />
                  <ListRow label={t('inventory.onHand')} value={item.quantities.onHand} numeric />
                  <ListRow
                    label={t('inventory.available')}
                    value={item.quantities.available}
                    numeric
                  />
                  <ListRow
                    label={t('inventory.reserved')}
                    value={item.quantities.reserved}
                    numeric
                  />
                  <ListRow
                    label={t('inventory.columnPicking')}
                    value={item.quantities.picking}
                    numeric
                  />

                  <Button
                    variant="secondary"
                    label={t('inventory.actionFor', { batch: item.batchNumber })}
                    busy={busyId === item._id}
                    disabled={busyId !== ''}
                    onPress={() => void chooseAction(item)}
                  />
                </Card>
              );
            }}
          />
        </>
      )}
    </Screen>
  );
}
