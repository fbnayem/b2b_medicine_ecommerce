import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { SchemeRecord } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { getSchemes } from '../../src/pricing/api';
import { formatFinanceDate } from '../../src/finance/date';
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
} from '../../src/components';
import { colour, layout } from '../../src/theme';

const MAY_EDIT = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

/**
 * Free-goods offers: buy ten, get one.
 *
 * "Is there an offer on this" is the other question a representative is asked
 * at a counter, and the answer decides whether the order gets bigger. Reading
 * it was desktop-only.
 *
 * An offer with no customers named applies to **everybody**, which is the
 * ordinary case and is said out loud on the row — an empty list is easy to read
 * as "nobody".
 */
export default function SchemesScreen() {
  const { t, language } = useLanguage();
  const role = useAuthStore((state) => state.user?.role);
  const [schemes, setSchemes] = useState<SchemeRecord[]>();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setSchemes(await getSchemes());
    } catch (caught) {
      setError(errorMessage(caught, language, t('schemes.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!schemes && !error) {
    return (
      <Screen>
        <LoadingState label={t('schemes.loading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      {MAY_EDIT.includes(String(role)) ? (
        <Button
          label={t('schemes.create')}
          onPress={() => router.push('/(protected)/scheme-detail')}
        />
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <FlatList
        data={schemes ?? []}
        keyExtractor={(scheme) => scheme._id}
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
          <EmptyState title={t('schemes.none')} description={t('schemes.noneBody')} />
        }
        renderItem={({ item }) => (
          <CardLink
            accessibilityLabel={t('schemes.openScheme', { name: item.name })}
            onPress={() => router.push(`/(protected)/scheme-detail?id=${item._id}` as never)}
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
              {item.isActive ? null : <Badge tone="neutral">{t('schemes.notInUse')}</Badge>}
            </View>
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {item.medicineBrandName ?? ''}
            </Text>
            {/*
              Said as a sentence rather than as two numbers in two rows. "Buy
              10, get 1 free" is how somebody standing at a counter repeats it.
            */}
            <Text style={{ color: colour.brand, fontWeight: '600' }}>
              {t('schemes.buyGet', { buy: item.buyQuantity, free: item.freeQuantity })}
            </Text>
            <ListRow
              label={t('schemes.appliesTo')}
              value={
                item.shopIds.length === 0
                  ? t('schemes.everyCustomer')
                  : t('schemes.namedCustomers', { count: item.shopIds.length })
              }
            />
            {item.validTo ? (
              <ListRow label={t('schemes.until')} value={formatFinanceDate(item.validTo)} />
            ) : null}
          </CardLink>
        )}
      />
    </Screen>
  );
}
