import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { apiClient } from '../../../src/api/client';
import { useCart } from '../../../src/store/useCart';
import { formatMoneyMinor } from '../../../src/finance/money';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ListRow,
  Screen,
  toast,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

export default function CartScreen() {
  const { t } = useLanguage();
  const { items, quantity, remove, draftId, recover } = useCart();
  const [saving, setSaving] = useState(false);

  const subtotalMinor = items.reduce(
    (total, item) => total + item.medicine.defaultSellingPriceMinor * item.quantity,
    0,
  );

  async function save() {
    setSaving(true);
    try {
      const body = {
        items: items.map((item) => ({
          medicineId: item.medicine._id,
          requestedQuantity: item.quantity,
        })),
      };
      const response = draftId
        ? await apiClient.patch(`/orders/drafts/${draftId}`, body)
        : await apiClient.post('/orders/drafts', body);
      recover(items, response.data.data._id);
      toast.success(t('cart.draftSaved'));
    } catch {
      toast.error(t('cart.draftFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll={false}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.medicine._id}
        contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
        ListEmptyComponent={
          <EmptyState
            title={t('cart.empty')}
            description={t('cart.emptyBody')}
            action={{
              label: t('cart.browse'),
              onPress: () => router.push('/(protected)/(tabs)/medicines'),
            }}
          />
        }
        renderItem={({ item }) => {
          const { medicine } = item;
          const minimum = medicine.minimumOrderQuantity;
          const maximum = medicine.maximumOrderQuantity;
          return (
            <Card>
              <Text style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}>
                {medicine.brandName} {medicine.strength}
              </Text>

              <Field
                label={t('cart.quantityFor', { brand: medicine.brandName })}
                hint={
                  maximum
                    ? t('cart.minimumAndMaximum', { minimum, maximum })
                    : t('cart.minimum', { minimum })
                }
              >
                <Input
                  label={t('cart.quantityFor', { brand: medicine.brandName })}
                  keyboardType="number-pad"
                  value={String(item.quantity)}
                  /*
                   * Digits only, and clamped when the field is left.
                   *
                   * This was `Number(value)` straight into the store, so
                   * clearing the field posted a quantity of 0 and any stray
                   * character posted NaN — neither of which is a quantity, and
                   * both of which reached the order draft.
                   */
                  onChangeText={(value) => {
                    const digits = value.replace(/[^0-9]/g, '');
                    quantity(medicine._id, digits ? Number(digits) : 0);
                  }}
                  onBlur={() => {
                    if (item.quantity < minimum) quantity(medicine._id, minimum);
                    else if (maximum && item.quantity > maximum) quantity(medicine._id, maximum);
                  }}
                />
              </Field>

              <ListRow
                label={t('cart.unitPrice')}
                value={formatMoneyMinor(medicine.defaultSellingPriceMinor)}
                numeric
              />
              <ListRow
                label={t('cart.lineTotal')}
                value={formatMoneyMinor(medicine.defaultSellingPriceMinor * item.quantity)}
                numeric
              />

              <Button
                variant="secondary"
                label={t('cart.remove')}
                onPress={() => {
                  remove(medicine._id);
                  toast.success(t('cart.removed', { brand: medicine.brandName }));
                }}
              />
            </Card>
          );
        }}
      />

      {items.length > 0 ? (
        <View style={{ gap: layout.space[2], paddingTop: layout.space[2] }}>
          <ListRow label={t('cart.subtotal')} value={formatMoneyMinor(subtotalMinor)} numeric />
          <View style={{ flexDirection: 'row', gap: layout.space[2] }}>
            <Button
              variant="secondary"
              style={{ flex: 1 }}
              busy={saving}
              label={t('cart.saveDraft')}
              onPress={() => void save()}
            />
            <Button
              style={{ flex: 1 }}
              label={t('cart.checkout')}
              onPress={() => router.push('/(protected)/checkout')}
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
