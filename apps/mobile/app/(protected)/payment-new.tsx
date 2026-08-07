import { useState } from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PaymentMethod } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { getShopInvoices, getShops, type ShopInvoiceRow } from '../../src/customers/api';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import { priceProblem, toMinor } from '../../src/pricing/api';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  Field,
  Input,
  ListRow,
  Screen,
  SectionTitle,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Recording a payment somebody has handed over.
 *
 * The **idempotency key is the whole safety property** here, and it is why this
 * screen mints one before the request rather than letting a retry invent a
 * second: a payment posted twice credits a customer's account twice, and the
 * reconciliation that finds it is weeks away.
 *
 * The amount is typed in taka and stored in poisha through the same conversion
 * the price editor uses. One rounding rule, in one place.
 */
export default function PaymentNewScreen() {
  const { shopId } = useLocalSearchParams<{ shopId?: string }>();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [shop, setShop] = useState<{ id: string; name: string } | undefined>(
    shopId ? { id: shopId, name: '' } : undefined,
  );
  const [invoices, setInvoices] = useState<ShopInvoiceRow[]>([]);
  const [invoice, setInvoice] = useState<ShopInvoiceRow>();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  async function chooseShop() {
    try {
      const answer = await getShops({ limit: '50' });
      const chosen = await ask.choose({
        title: t('shops.search'),
        options: answer.items.map((entry) => ({ value: entry._id, label: entry.name })),
      });
      if (!chosen) return;
      const found = answer.items.find((entry) => entry._id === chosen);
      setShop({ id: chosen, name: found?.name ?? '' });
      setInvoice(undefined);
      setInvoices(await getShopInvoices(chosen));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('shops.couldNotLoad')));
    }
  }

  async function chooseMethod() {
    const chosen = await ask.choose({
      title: t('finance.method'),
      options: Object.values(PaymentMethod).map((value) => ({
        value,
        label: t(`paymentMethod.${value}`),
      })),
    });
    if (chosen) setMethod(chosen as PaymentMethod);
  }

  async function save() {
    if (!shop) {
      toast.error(t('finance.needShop'));
      return;
    }
    const problem = priceProblem(amount);
    if (problem || toMinor(amount) <= 0) {
      toast.error(t('finance.needAmount'));
      return;
    }

    setSaving(true);
    try {
      await apiClient.post('/payments', {
        shopId: shop.id,
        ...(invoice ? { invoiceId: invoice._id } : {}),
        amountMinor: toMinor(amount),
        method,
        ...(reference.trim() ? { transactionReference: reference.trim() } : {}),
        // Minted before the request, not after a failure: a retry must be
        // recognisable as the same payment, or a customer is credited twice.
        idempotencyKey: createFinancialIdempotencyKey('payment', shop.id),
      });
      toast.success(t('finance.recorded'));
      router.back();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('finance.recordFailed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <SectionTitle>{t('finance.record')}</SectionTitle>

      <Card>
        <ListRow label={t('finance.shop')} value={shop?.name || t('purchasing.notChosen')} />
        <Button variant="secondary" label={t('shops.search')} onPress={() => void chooseShop()} />

        {/*
          Against an invoice where there is one. A payment with no invoice sits
          on the account as a credit, which is a real thing to want and a bad
          default — somebody handing over money is nearly always paying for
          something specific.
        */}
        {invoices.length > 0 ? (
          <>
            <ListRow
              label={t('finance.invoice')}
              value={invoice?.reference ?? t('finance.onAccount')}
            />
            {invoices.slice(0, 10).map((row) => (
              <Button
                key={row._id}
                variant="secondary"
                label={`${row.reference} · ${formatMoneyMinor(row.amountDueMinor)} · ${formatFinanceDate(row.dueDate)}`}
                onPress={() => {
                  setInvoice(row);
                  // Seeded with what is actually outstanding, which is what a
                  // customer settling an invoice hands over.
                  setAmount((row.amountDueMinor / 100).toFixed(2));
                }}
              />
            ))}
          </>
        ) : null}

        <Field label={t('finance.amount')} hint={t('purchasing.unitCostHint')}>
          <Input
            label={t('finance.amount')}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={(value) => setAmount(value.replace(/[^0-9.]/g, ''))}
          />
        </Field>

        <ListRow label={t('finance.method')} value={t(`paymentMethod.${method}`)} />
        <Button
          variant="secondary"
          label={t('finance.method')}
          onPress={() => void chooseMethod()}
        />

        <Field label={t('finance.transactionReference')} hint={t('finance.referenceHint')}>
          <Input
            label={t('finance.transactionReference')}
            value={reference}
            onChangeText={setReference}
          />
        </Field>

        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('finance.postedNote')}
        </Text>
        <Button busy={saving} label={t('finance.record')} onPress={() => void save()} />
      </Card>
    </Screen>
  );
}
