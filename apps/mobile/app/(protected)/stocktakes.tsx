import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { StocktakeListRow, StocktakeStatus } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { getStocktakes, openStocktake } from '../../src/warehouse/stocktakes';
import { formatFinanceDate } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  CardLink,
  EmptyState,
  ErrorState,
  FilterChips,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

const FILTERS: Array<{ value: string; key: string }> = [
  { value: 'COUNTING', key: 'stocktake.filterOpen' },
  { value: 'REVIEW', key: 'stocktake.filterReview' },
  { value: '', key: 'stocktake.filterAll' },
];

/**
 * Physical counts, and how far each has got.
 *
 * New on this client. Counting stock is the most phone-shaped job in the
 * building — nobody counts a rack from a desk — and until now it existed only
 * on the web application, which means a sheet printed, walked, pencilled and
 * typed up afterwards: two transcriptions and a chance to lose an hour.
 *
 * Open counts come first because they are the ones somebody is in the middle
 * of, and a storekeeper opening this screen has almost always come back to one.
 */
export default function StocktakesScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [rows, setRows] = useState<StocktakeListRow[]>();
  const [status, setStatus] = useState('COUNTING');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await getStocktakes(status ? { status } : {}));
    } catch (caught) {
      setError(errorMessage(caught, language, t('stocktake.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, status, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /*
   * Opening a count asks for the location rather than assuming one.
   *
   * The endpoint also accepts a list of medicines, which is a desk job — you do
   * not choose forty medicines on a phone. A location is what somebody standing
   * in the warehouse actually has: they are in aisle C.
   */
  async function open() {
    const location = await ask.prompt({
      title: t('stocktake.openTitle'),
      description: t('stocktake.openSubtitle'),
      label: t('stocktake.location'),
      hint: t('stocktake.locationRequiredHint'),
      confirmLabel: t('stocktake.openConfirm'),
      validate: (value) => (value.trim().length === 0 ? t('stocktake.locationRequired') : null),
    });
    if (location === null) return;

    setOpening(true);
    try {
      const sheet = await openStocktake({ warehouseLocation: location.trim() });
      toast.success(t('stocktake.opened', { reference: sheet.reference }));
      router.push(`/(protected)/stocktake-detail?id=${sheet._id}` as never);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('stocktake.openFailed')));
    } finally {
      setOpening(false);
    }
  }

  if (!rows && !error) {
    return (
      <Screen>
        <LoadingState label={t('stocktake.loading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <FilterChips
        label={t('stocktake.showing')}
        value={status}
        onChange={setStatus}
        options={FILTERS.map((filter) => ({ value: filter.value, label: t(filter.key) }))}
      />

      <Button busy={opening} label={t('stocktake.open')} onPress={() => void open()} />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <FlatList
        data={rows ?? []}
        keyExtractor={(row) => row._id}
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
          <EmptyState title={t('stocktake.none')} description={t('stocktake.noneBody')} />
        }
        renderItem={({ item }) => (
          <CardLink
            accessibilityLabel={t('stocktake.openSheet', { reference: item.reference })}
            onPress={() => router.push(`/(protected)/stocktake-detail?id=${item._id}` as never)}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: layout.space[2],
              }}
            >
              <Text style={{ color: colour.brand, fontWeight: '600' }}>{item.reference}</Text>
              <StatusPill kind="stocktake" status={item.status as StocktakeStatus} />
            </View>
            {item.scope.warehouseLocation ? (
              <ListRow label={t('stocktake.location')} value={item.scope.warehouseLocation} />
            ) : null}
            <ListRow label={t('stocktake.openedOn')} value={formatFinanceDate(item.openedAt)} />
            {/*
              Counted of total, and nothing about variance. While a sheet is
              open the server withholds every expected quantity, so a "12 short"
              here would either be a lie or a leak.
            */}
            <ListRow
              label={t('stocktake.progress')}
              value={t('stocktake.ofLines', {
                counted: item.summary.linesCounted,
                total: item.summary.linesTotal,
              })}
              numeric
            />
          </CardLink>
        )}
      />
    </Screen>
  );
}
