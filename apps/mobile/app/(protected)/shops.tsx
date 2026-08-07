import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { Shop } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { getShops } from '../../src/customers/api';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  CardLink,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  Input,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

const FILTERS = [
  { value: '', key: 'shops.filterAll' },
  { value: 'awaitingTerms', key: 'shops.awaitingTerms' },
];

/**
 * The customers this account may act for.
 *
 * The server narrows the list — a representative sees their own territory and
 * nothing else — so there is no filtering to do here beyond the search box and
 * the one filter that matters to a manager: **who is waiting for terms**.
 *
 * That filter exists because a shop can now register itself. Without it a
 * manager meets one of those customers for the first time as a refused order in
 * the approval queue.
 */
export default function ShopsScreen() {
  const { t, language } = useLanguage();
  const [shops, setShops] = useState<Shop[]>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const answer = await getShops({
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(filter === 'awaitingTerms' ? { awaitingTerms: 'true' } : {}),
        limit: '50',
      });
      setShops(answer.items);
    } catch (caught) {
      setError(errorMessage(caught, language, t('shops.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [filter, language, search, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen scroll={false}>
      <Field label={t('shops.search')} hint={t('hints.searchShops')}>
        <Input
          label={t('shops.search')}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => void load()}
        />
      </Field>

      <FilterChips
        label={t('shops.showing')}
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((entry) => ({ value: entry.value, label: t(entry.key) }))}
      />

      {filter === 'awaitingTerms' ? (
        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('hints.awaitingTerms')}
        </Text>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {!shops && !error ? <LoadingState label={t('shops.loading')} /> : null}

      <FlatList
        data={shops ?? []}
        keyExtractor={(shop) => shop._id}
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
          shops ? <EmptyState title={t('shops.none')} description={t('shops.noneBody')} /> : null
        }
        renderItem={({ item }) => (
          <CardLink
            accessibilityLabel={t('shops.openShop', { name: item.name })}
            onPress={() => router.push(`/(protected)/shop-detail?id=${item._id}` as never)}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: layout.space[2],
              }}
            >
              <Text style={{ color: colour.text, fontWeight: '600', flexShrink: 1 }}>
                {item.name}
              </Text>
              <StatusPill kind="shop" status={item.status} />
            </View>
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {/* The human reference, never the identifier. */}
              {item.reference} · {item.primaryPhone}
            </Text>
            {/*
              Said on the row rather than only behind the filter: a manager
              scrolling the whole list should see which customers have never had
              terms set, not only one who thought to filter for them.
            */}
            {item.selfRegisteredAt && item.creditLimit === 0 ? (
              <Text style={{ color: colour.warning, fontSize: layout.fontSize.sm }}>
                {t('shops.selfRegisteredOn')}
              </Text>
            ) : null}
            {item.territory ? (
              <ListRow label={t('shops.territory')} value={item.territory} />
            ) : null}
          </CardLink>
        )}
      />
    </Screen>
  );
}
