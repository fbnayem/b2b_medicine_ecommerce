import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../../src/api/client';
import { formatMoneyMinor } from '../../../src/finance/money';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

type ReadyPackage = {
  _id: string;
  reference: string;
  barcode: string;
  packageCount: number;
  orderId: { reference: string };
  invoiceId: { reference: string; grandTotalMinor: number };
};

export default function ReadyScreen() {
  const { t, language } = useLanguage();
  const [data, setData] = useState<ReadyPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData((await apiClient.get('/fulfilment/ready')).data.data);
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('fulfilment.readyCouldNotLoad')));
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
        <LoadingState label={t('fulfilment.readyLoading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
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
          <EmptyState
            title={t('fulfilment.readyNone')}
            description={t('fulfilment.readyNoneBody')}
          />
        }
        renderItem={({ item }) => (
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: layout.space[2],
              }}
            >
              <Text style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}>
                {item.reference}
              </Text>
              <Text style={{ color: colour.textMuted }}>{item.orderId.reference}</Text>
            </View>
            <ListRow
              label={item.invoiceId.reference}
              value={formatMoneyMinor(item.invoiceId.grandTotalMinor)}
              numeric
            />
            <ListRow label={t('fulfilment.barcodeLabel')} value={item.barcode} />
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {item.packageCount === 1
                ? t('fulfilment.onePackage')
                : t('fulfilment.packages', { count: item.packageCount })}
            </Text>
          </Card>
        )}
      />
    </Screen>
  );
}
