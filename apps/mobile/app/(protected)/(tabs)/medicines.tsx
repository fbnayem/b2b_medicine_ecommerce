import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { UserRole } from '@medsupply/shared-types';
import type { Medicine } from '@medsupply/shared-types';
import { apiClient } from '../../../src/api/client';
import { useCart } from '../../../src/store/useCart';
import { useAuthStore } from '../../../src/store/useAuth';
import { formatMoneyMinor } from '../../../src/finance/money';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListRow,
  LoadingState,
  Screen,
  toast,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

/** What the server sends back with a page of the catalogue. */
const PAGE_SIZE = 30;

/**
 * The catalogue, **all of it**.
 *
 * This asked for `limit: 100` and stopped there. `listMedicines` caps a page at
 * 100 too, so a catalogue larger than that simply ended — with nothing on
 * screen saying so, and no way to reach the rest except by guessing a search
 * term. A pharmacy scrolling to the bottom had no reason to think they had seen
 * anything other than everything.
 *
 * **No category filter yet, deliberately.** `category` is free text on
 * `Medicine` with no enum and no endpoint that lists the ones in use, so a
 * filter here could only offer the categories present in the page already
 * loaded — which would quietly hide every category that happens to sort later
 * in the alphabet. That needs `GET /inventory/medicines/categories`, and a
 * filter that lies is worse than a filter that is missing.
 */
export default function MedicinesScreen() {
  const { t } = useLanguage();
  const add = useCart((state) => state.add);
  const user = useAuthStore((state) => state.user);
  const isOwner = user?.role === UserRole.SHOP_OWNER;

  const [items, setItems] = useState<Medicine[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (wanted = 1, mode: 'first' | 'more' | 'refresh' = 'first') => {
      if (mode === 'refresh') setRefreshing(true);
      else if (mode === 'more') setLoadingMore(true);
      else setLoading(true);
      setError('');
      try {
        const response = await apiClient.get('/inventory/medicines', {
          params: { search: search.trim(), page: wanted, limit: PAGE_SIZE },
        });
        const batch: Medicine[] = response.data.data;
        // Appended for a further page, replaced otherwise — so a new search
        // cannot leave the previous one's rows underneath it.
        setItems((current) => (mode === 'more' ? current.concat(batch) : batch));
        setPage(response.data.meta?.page ?? wanted);
        setPages(response.data.meta?.pages ?? 1);
      } catch {
        setError(t('catalogue.couldNotLoad'));
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [search, t],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(1), 300);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <Screen scroll={false}>
      <Field label={t('catalogue.searchLabel')}>
        <Input
          label={t('catalogue.searchLabel')}
          placeholder={t('catalogue.searchPlaceholder')}
          value={search}
          onChangeText={setSearch}
        />
      </Field>

      {loading ? (
        <LoadingState label={t('catalogue.loading')} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load(1, 'refresh')} />
          }
          /*
           * Half a screen before the end, so the next page is usually already
           * there by the time somebody scrolls to it.
           */
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (loadingMore || page >= pages) return;
            void load(page + 1, 'more');
          }}
          ListFooterComponent={
            loadingMore ? (
              <LoadingState label={t('catalogue.loadingMore')} />
            ) : page >= pages && items.length > 0 ? (
              // Says the list has ended, rather than merely stopping — which is
              // what the old fixed limit of 100 did.
              <Text
                style={{
                  color: colour.textMuted,
                  fontSize: layout.fontSize.sm,
                  textAlign: 'center',
                  paddingVertical: layout.space[3],
                }}
              >
                {t('catalogue.thatIsEverything', { count: items.length })}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState title={t('catalogue.none')} description={t('catalogue.noneBody')} />
          }
          renderItem={({ item }) => {
            const available = (item.totalAvailable ?? 0) > 0;
            return (
              <Card>
                {/*
                 * The row and the button are siblings, not nested.
                 *
                 * "Add to order" used to be a `Pressable` inside the card's own
                 * `Pressable`, and React Native hands a touch to the deepest
                 * responder — so while the button was *enabled* it worked, and
                 * the moment it was disabled the tap fell through to the card
                 * and navigated instead. Out of stock therefore meant "tapping
                 * Add opens the medicine", which reads as the app ignoring you.
                 */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.brandName} ${item.strength}`}
                  onPress={() =>
                    router.push({
                      pathname: '/(protected)/medicine-detail',
                      params: { id: item._id },
                    })
                  }
                  style={{ minHeight: layout.minTapTarget, gap: layout.space[1] }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      gap: layout.space[2],
                    }}
                  >
                    <Text style={{ color: colour.brand, fontSize: layout.fontSize.sm }}>
                      {item.reference}
                    </Text>
                    <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                      {available ? t('catalogue.available') : t('catalogue.outOfStock')}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontSize: layout.fontSize.lg,
                      fontWeight: '600',
                      color: colour.text,
                    }}
                  >
                    {item.brandName} {item.strength}
                  </Text>
                  <Text style={{ color: colour.text }}>
                    {item.genericName} · {item.dosageForm}
                  </Text>
                  <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                    {item.manufacturer} · {item.packSize}
                  </Text>
                  {/*
                   * Labelled, because it is **not** what this shop pays.
                   *
                   * A bare figure under a medicine reads as the price, and this
                   * one is the catalogue's — before the shop's own discount,
                   * their price list and any offer running on the line. Their
                   * real price is worked out by the server the moment the
                   * medicine reaches the basket. An unlabelled number here was
                   * the same defect as the basket's, one screen earlier.
                   */}
                  <ListRow
                    label={t('catalogue.listPrice')}
                    value={formatMoneyMinor(item.defaultSellingPriceMinor)}
                    numeric
                  />
                </Pressable>

                {isOwner ? (
                  <Button
                    label={t('catalogue.addToOrder')}
                    disabled={!available}
                    onPress={() => {
                      add(item);
                      // Nothing used to happen visibly, so the only way to know
                      // the tap had registered was to open the cart.
                      toast.success(t('cart.addedToOrder', { brand: item.brandName }));
                    }}
                  />
                ) : null}
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}
