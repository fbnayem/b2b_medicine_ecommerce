import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { apiClient } from '../../../src/api/client';
import { useCart } from '../../../src/store/useCart';
import { useQuote } from '../../../src/orders/quote';
import { formatMoneyMinor } from '../../../src/finance/money';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Badge,
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

/**
 * The basket, and **every figure on it comes from the server**.
 *
 * This screen used to multiply `medicine.defaultSellingPriceMinor` by the
 * quantity. That is the list price: before this shop's own discount, before
 * whichever price list they are assigned, before any free-goods offer, and
 * before the delivery charge. `POST /orders/submit` reprices from
 * `resolvePriceFrom` on the way in, so the customer was shown one total here
 * and charged another on the invoice. `src/orders/quote.ts` records the rest.
 *
 * Free goods appear here for the first time. A shop that has earned an offer
 * used to discover it on the invoice, which is the wrong end of the
 * transaction to learn you were owed something.
 */
export default function CartScreen() {
  const { t } = useLanguage();
  const { items, quantity, remove, draftId, setDraftId, restored } = useCart();
  const [saving, setSaving] = useState(false);

  const { quote, loading, failed, retry } = useQuote(
    items.map((item) => ({ medicineId: item.medicineId, requestedQuantity: item.quantity })),
  );

  async function save() {
    setSaving(true);
    try {
      const body = {
        items: items.map((item) => ({
          medicineId: item.medicineId,
          requestedQuantity: item.quantity,
        })),
      };
      const response = draftId
        ? await apiClient.patch(`/orders/drafts/${draftId}`, body)
        : await apiClient.post('/orders/drafts', body);
      setDraftId(response.data.data._id);
      toast.success(t('cart.draftSaved'));
    } catch {
      toast.error(t('cart.draftFailed'));
    } finally {
      setSaving(false);
    }
  }

  // The stored basket arrives a tick after the first render; without this a
  // full basket flashes "empty" on the way in.
  if (!restored) {
    return (
      <Screen>
        <LoadingState label={t('cart.loading')} />
      </Screen>
    );
  }

  const priced = (medicineId: string) =>
    quote?.items.find((line) => line.medicineId === medicineId);

  return (
    <Screen scroll={false}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.medicineId}
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
          const { minimum, maximum } = item.snapshot;
          const line = priced(item.medicineId);
          return (
            <Card>
              <Text style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}>
                {item.snapshot.brandName} {item.snapshot.strength}
              </Text>

              <Field
                label={t('cart.quantityFor', { brand: item.snapshot.brandName })}
                hint={
                  maximum
                    ? t('cart.minimumAndMaximum', { minimum, maximum })
                    : t('cart.minimum', { minimum })
                }
              >
                <Input
                  label={t('cart.quantityFor', { brand: item.snapshot.brandName })}
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
                    quantity(item.medicineId, digits ? Number(digits) : 0);
                  }}
                  onBlur={() => {
                    if (item.quantity < minimum) quantity(item.medicineId, minimum);
                    else if (maximum && item.quantity > maximum) quantity(item.medicineId, maximum);
                  }}
                />
              </Field>

              {line ? (
                <>
                  <ListRow
                    label={t('cart.unitPrice')}
                    value={formatMoneyMinor(line.estimatedUnitPriceMinor)}
                    numeric
                  />
                  {line.freeQuantity > 0 ? (
                    <View style={{ alignItems: 'flex-start' }}>
                      <Badge tone="success">
                        {t('cart.freeGoods', { count: line.freeQuantity })}
                      </Badge>
                    </View>
                  ) : null}
                  <ListRow
                    label={t('cart.lineTotal')}
                    value={formatMoneyMinor(line.estimatedLineTotalMinor)}
                    numeric
                  />
                </>
              ) : (
                // Deliberately no figure at all until the server has answered.
                // A placeholder number is a number somebody reads.
                <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                  {t('cart.pricing')}
                </Text>
              )}

              <Button
                variant="secondary"
                label={t('cart.remove')}
                onPress={() => {
                  remove(item.medicineId);
                  toast.success(t('cart.removed', { brand: item.snapshot.brandName }));
                }}
              />
            </Card>
          );
        }}
      />

      {items.length > 0 ? (
        <View style={{ gap: layout.space[2], paddingTop: layout.space[2] }}>
          {failed ? (
            <ErrorState message={t('cart.couldNotPrice')} onRetry={retry} />
          ) : quote ? (
            <Card>
              <ListRow
                label={t('cart.subtotal')}
                value={formatMoneyMinor(quote.estimatedSubtotalMinor)}
                numeric
              />
              {quote.estimatedDiscountMinor > 0 ? (
                <ListRow
                  label={t('cart.discount')}
                  value={`− ${formatMoneyMinor(quote.estimatedDiscountMinor)}`}
                  numeric
                />
              ) : null}
              {quote.estimatedDeliveryChargeMinor > 0 ? (
                <ListRow
                  label={t('cart.deliveryCharge')}
                  value={formatMoneyMinor(quote.estimatedDeliveryChargeMinor)}
                  numeric
                />
              ) : null}
              <ListRow
                label={t('cart.total')}
                value={formatMoneyMinor(quote.estimatedTotalMinor)}
                numeric
              />
              <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                {t('cart.estimateNote')}
              </Text>
            </Card>
          ) : (
            <LoadingState label={t('cart.pricing')} />
          )}

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
              // Nothing may be committed against a price nobody has confirmed.
              disabled={!quote || loading}
              onPress={() => router.push('/(protected)/checkout')}
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
