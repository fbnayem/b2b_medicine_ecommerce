import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../../src/api/client';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Badge,
  CardLink,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

type PickingList = {
  _id: string;
  status: string;
  items: unknown[];
  orderId: { reference: string; shopId: { name: string } };
};

export default function FulfilmentScreen() {
  const { t, language } = useLanguage();
  const [data, setData] = useState<PickingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData((await apiClient.get('/fulfilment/queue')).data.data);
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('fulfilment.couldNotLoad')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('fulfilment.loading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      {/* Was "Pull down to retry", which is discoverable to whoever wrote it
          and to nobody wearing gloves in a cold store. */}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <FlatList
        data={data}
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
          <EmptyState title={t('fulfilment.none')} description={t('fulfilment.noneBody')} />
        }
        renderItem={({ item }) => (
          <CardLink
            accessibilityLabel={item.orderId.reference}
            onPress={() =>
              router.push({ pathname: '/(protected)/picking', params: { id: item._id } })
            }
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: layout.space[2],
              }}
            >
              <Text style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}>
                {item.orderId.reference}
              </Text>
              <Badge>{t(`pickingStatus.${item.status}`)}</Badge>
            </View>
            <Text style={{ color: colour.text }}>{item.orderId.shopId.name}</Text>
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {t('fulfilment.lines', { count: item.items.length })}
            </Text>
          </CardLink>
        )}
      />
    </Screen>
  );
}
