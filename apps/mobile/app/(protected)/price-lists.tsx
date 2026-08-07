import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { PriceListRecord } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { createPriceList, getPriceLists } from '../../src/pricing/api';
import { useAuthStore } from '../../src/store/useAuth';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  CardLink,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

const MAY_EDIT = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

/**
 * Price lists, and how many customers each one prices.
 *
 * A representative reads this and cannot change it — the server refuses either
 * way, and hiding the button is what stops somebody discovering that by
 * pressing it. "What price is this customer on" is the question a rep is asked
 * at a counter, and until now the answer was on a desktop.
 */
export default function PriceListsScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const role = useAuthStore((state) => state.user?.role);
  const [lists, setLists] = useState<PriceListRecord[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setLists(await getPriceLists());
    } catch (caught) {
      setError(errorMessage(caught, language, t('priceLists.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function create() {
    const name = await ask.prompt({
      title: t('priceLists.newTitle'),
      description: t('priceLists.newSubtitle'),
      label: t('priceLists.name'),
      confirmLabel: t('priceLists.create'),
      validate: (value) => (value.trim().length < 2 ? t('priceLists.nameRequired') : null),
    });
    if (name === null) return;

    setBusy(true);
    try {
      const created = await createPriceList({ name: name.trim() });
      toast.success(t('priceLists.created', { name: created.name }));
      router.push(`/(protected)/price-list-detail?id=${created._id}` as never);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('priceLists.createFailed')));
    } finally {
      setBusy(false);
    }
  }

  const mayEdit = MAY_EDIT.includes(String(role));

  if (!lists && !error) {
    return (
      <Screen>
        <LoadingState label={t('priceLists.loading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      {mayEdit ? (
        <Button busy={busy} label={t('priceLists.create')} onPress={() => void create()} />
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <FlatList
        data={lists ?? []}
        keyExtractor={(list) => list._id}
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
          <EmptyState title={t('priceLists.none')} description={t('priceLists.noneBody')} />
        }
        renderItem={({ item }) => (
          <CardLink
            accessibilityLabel={t('priceLists.openList', { name: item.name })}
            onPress={() => router.push(`/(protected)/price-list-detail?id=${item._id}` as never)}
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
              {item.isDefault ? <Badge tone="brand">{t('priceLists.default')}</Badge> : null}
            </View>
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {item.reference}
            </Text>
            <ListRow label={t('priceLists.lines')} value={item.lines.length} numeric />
            {/*
              How many customers this prices, which is what makes a change to it
              worth being careful about. A list with forty shops on it is not a
              list somebody edits on a bus.
            */}
            <ListRow label={t('priceLists.shopsPriced')} value={item.shopCount ?? 0} numeric />
            {item.isActive ? null : <Badge tone="neutral">{t('priceLists.notInUse')}</Badge>}
          </CardLink>
        )}
      />
    </Screen>
  );
}
