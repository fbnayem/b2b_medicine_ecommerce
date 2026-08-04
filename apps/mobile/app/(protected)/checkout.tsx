import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { PaymentMethod } from '@medsupply/shared-types';
import type { Shop } from '@medsupply/shared-types';
import { apiFailure, errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { useCart } from '../../src/store/useCart';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Screen,
  SectionTitle,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/** A tappable option that reads as chosen or not chosen to a screen reader. */
function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      // These were plain `Pressable`s with a border colour and nothing else, so
      // which address had been chosen was visible and unannounced.
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: layout.minTapTarget,
        justifyContent: 'center',
        backgroundColor: selected ? colour.brandSubtle : colour.surface,
        borderColor: selected ? colour.brand : colour.border,
        borderWidth: selected ? 2 : 1,
        borderRadius: layout.radius.md,
        paddingHorizontal: layout.space[3],
        paddingVertical: layout.space[2],
      }}
    >
      <Text style={{ color: colour.text, fontSize: layout.fontSize.base }}>{label}</Text>
    </Pressable>
  );
}

export default function CheckoutScreen() {
  const { t, language } = useLanguage();
  const { items, draftId, clear } = useCart();
  const [shop, setShop] = useState<Shop>();
  const [addressId, setAddressId] = useState('');
  const [payment, setPayment] = useState<(typeof PaymentMethod)[keyof typeof PaymentMethod]>(
    PaymentMethod.CASH,
  );
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reference, setReference] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  /*
   * One key per attempt-set, held across retries.
   *
   * This used to be built inside `submit()` as `${Date.now()}-${Math.random()}`,
   * so every retry carried a *new* key — which defeats the entire mechanism on
   * exactly the failure it exists for. If the server accepted the order and the
   * reply was lost, tapping "Send" again placed a second order.
   *
   * The key is kept on a 5xx or a dropped connection, where the server may
   * already have the order, and replaced only after a 4xx, which means the
   * request was rejected outright and the next one is genuinely new.
   */
  const idempotencyKey = useRef(createFinancialIdempotencyKey('order-submit', draftId ?? 'new'));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/shops/my');
      const value = response.data.data[0];
      setShop(value);
      setAddressId((value?.deliveryAddresses?.[0] as { _id?: string } | undefined)?._id ?? '');
    } catch (caught) {
      setError(errorMessage(caught, language, t('checkout.couldNotLoadAddresses')));
    } finally {
      setLoading(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    setReference(undefined);
    try {
      const response = await apiClient.post(
        draftId ? `/orders/drafts/${draftId}/submit` : '/orders/submit',
        {
          items: items.map((item) => ({
            medicineId: item.medicine._id,
            requestedQuantity: item.quantity,
          })),
          deliveryAddressId: addressId,
          requestedPaymentMethod: payment,
          shopNotes: notes || undefined,
          idempotencyKey: idempotencyKey.current,
        },
      );
      clear();
      router.replace({
        pathname: '/(protected)/order-detail',
        params: { id: response.data.data._id, submitted: '1' },
      });
    } catch (caught) {
      const failure = apiFailure(caught);
      const status = failure.status ?? 0;
      if (status >= 400 && status < 500) {
        idempotencyKey.current = createFinancialIdempotencyKey('order-submit', draftId ?? 'new');
      }
      setError(errorMessage(caught, language, t('checkout.failed')));
      setReference(failure.reference);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('common.loading')} />
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen>
        <EmptyState
          title={t('checkout.empty')}
          description={t('checkout.emptyBody')}
          action={{
            label: t('cart.browse'),
            onPress: () => router.replace('/(protected)/(tabs)/medicines'),
          }}
        />
      </Screen>
    );
  }

  const addresses = (shop?.deliveryAddresses ?? []) as Array<
    Shop['deliveryAddresses'][number] & { _id: string }
  >;

  return (
    <Screen>
      {error ? <ErrorState message={error} reference={reference} /> : null}

      <Card>
        <SectionTitle>{t('checkout.deliveryAddress')}</SectionTitle>
        <View accessibilityRole="radiogroup" style={{ gap: layout.space[2] }}>
          {addresses.map((address) => (
            <Choice
              key={address._id}
              label={`${address.label}: ${address.line1}, ${address.city}`}
              selected={addressId === address._id}
              onPress={() => setAddressId(address._id)}
            />
          ))}
        </View>
      </Card>

      <Card>
        <SectionTitle>{t('checkout.paymentMethod')}</SectionTitle>
        <View accessibilityRole="radiogroup" style={{ gap: layout.space[2] }}>
          {Object.values(PaymentMethod).map((value) => (
            <Choice
              key={value}
              label={t(`paymentMethod.${value}`)}
              selected={payment === value}
              onPress={() => setPayment(value)}
            />
          ))}
        </View>
      </Card>

      <Field label={t('checkout.deliveryNotes')}>
        <Input
          label={t('checkout.deliveryNotes')}
          multiline
          value={notes}
          onChangeText={setNotes}
          style={{ minHeight: layout.space[10], paddingTop: layout.space[3] }}
        />
      </Field>

      <Button
        label={submitting ? t('checkout.submitting') : t('checkout.submit')}
        busy={submitting}
        disabled={!addressId}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
