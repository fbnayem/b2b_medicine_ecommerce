import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { UserRole } from '@medsupply/shared-types';
import type { Medicine } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';
import { useCart } from '../../src/store/useCart';
import { useAuthStore } from '../../src/store/useAuth';
import { formatMoneyMinor } from '../../src/finance/money';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  toast,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

export default function MedicineDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLanguage();
  const add = useCart((state) => state.add);
  const isOwner = useAuthStore((state) => state.user?.role) === UserRole.SHOP_OWNER;
  const [item, setItem] = useState<Medicine>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get(`/inventory/medicines/${id}`);
      setItem(response.data.data);
    } catch {
      setError(t('catalogue.couldNotLoadOne'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Screen>
        {/* This was a red line of text with nothing to press. */}
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen>
        <LoadingState label={t('catalogue.loadingOne')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={{ color: colour.brand, fontSize: layout.fontSize.sm }}>
        {item.reference} · {item.sku}
      </Text>
      <Text style={{ fontSize: layout.fontSize['2xl'], fontWeight: '700', color: colour.text }}>
        {item.brandName} {item.strength}
      </Text>
      <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.base }}>
        {item.genericName} · {item.dosageForm}
      </Text>

      <Card>
        <SectionTitle>{t('catalogue.about')}</SectionTitle>
        <ListRow label={t('catalogue.manufacturer')} value={item.manufacturer} />
        <ListRow label={t('catalogue.packSize')} value={item.packSize} />
        <ListRow label={t('catalogue.category')} value={item.category} />
        <ListRow label={t('catalogue.classification')} value={item.classification} />
        <ListRow
          label={t('catalogue.coldChain')}
          value={item.coldChain ? t('catalogue.yes') : t('catalogue.no')}
        />
        <ListRow
          label={t('catalogue.availability')}
          value={
            (item.totalAvailable ?? 0) > 0 ? t('catalogue.available') : t('catalogue.outOfStock')
          }
        />
        <ListRow
          label={t('catalogue.listPrice')}
          value={formatMoneyMinor(item.defaultSellingPriceMinor)}
          numeric
        />
      </Card>

      {item.description ? (
        <Text style={{ color: colour.text, lineHeight: 22 }}>{item.description}</Text>
      ) : null}

      {/*
        This screen had no way to add anything. Reading about a medicine meant
        going back to the list and finding it again — which is the one thing
        somebody is certain to want after reading about it.
      */}
      {isOwner ? (
        <Button
          label={t('catalogue.addToOrder')}
          disabled={(item.totalAvailable ?? 0) === 0}
          onPress={() => {
            add(item);
            toast.success(t('cart.addedToOrder', { brand: item.brandName }));
            router.back();
          }}
        />
      ) : null}
    </Screen>
  );
}
