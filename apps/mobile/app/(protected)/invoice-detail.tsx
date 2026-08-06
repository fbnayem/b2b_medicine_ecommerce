import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

interface InvoiceLine {
  medicineSnapshot: { brandName: string; strength?: string };
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  freeQuantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

interface InvoiceView {
  _id: string;
  reference: string;
  status: 'ISSUED' | 'CANCELLED';
  invoiceDate: string;
  dueDate: string;
  items: InvoiceLine[];
  subtotalMinor: number;
  orderDiscountMinor: number;
  deliveryChargeMinor: number;
  taxMinor: number;
  grandTotalMinor: number;
  amountPaidMinor: number;
  amountDueMinor: number;
  orderSnapshot?: { reference?: string };
}

/**
 * The invoice, on the phone.
 *
 * `GET /fulfilment/invoices/{id}` has admitted a shop owner since the
 * fulfilment phase and **had no caller on this client**. The invoice list
 * showed a reference and a balance; the document behind it — which batch, which
 * expiry, what was charged and what a return would be raised against — was
 * reachable only from a desktop.
 *
 * The **batch number and expiry are on every line deliberately**. They are what
 * a pharmacist checks against the boxes in front of them, and what a return has
 * to name; an invoice without them is a receipt.
 */
export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const [invoice, setInvoice] = useState<InvoiceView>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get(`/fulfilment/invoices/${id}`);
      setInvoice(response.data.data);
    } catch (caught) {
      setError(errorMessage(caught, language, t('finance.couldNotLoadInvoice')));
    }
  }, [id, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  if (!invoice) {
    return (
      <Screen>
        <LoadingState label={t('finance.loadingInvoice')} />
      </Screen>
    );
  }

  const outstanding = invoice.amountDueMinor > 0;

  return (
    <Screen>
      <Text style={{ color: colour.brand, fontSize: layout.fontSize.lg, fontWeight: '600' }}>
        {invoice.reference}
      </Text>
      {/*
        Not a `StatusPill`: an invoice is ISSUED or CANCELLED, which is neither
        an order status nor a payment one, and borrowing another kind's tones
        would put a colour on this that means something else elsewhere. Only
        the exceptional case is worth saying out loud.
      */}
      {invoice.status === 'CANCELLED' ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Badge tone="danger">{t('finance.cancelledInvoice')}</Badge>
        </View>
      ) : null}

      <Card>
        <ListRow label={t('account.invoiceDate')} value={formatFinanceDate(invoice.invoiceDate)} />
        <ListRow label={t('fields.dueDate')} value={formatFinanceDate(invoice.dueDate)} />
        {invoice.orderSnapshot?.reference ? (
          <ListRow label={t('finance.forOrder')} value={invoice.orderSnapshot.reference} />
        ) : null}
      </Card>

      <Card>
        <SectionTitle>{t('finance.whatWasDelivered')}</SectionTitle>
        {invoice.items.map((line, index) => (
          <View key={`${line.batchNumber}-${index}`} style={{ gap: layout.space[1] }}>
            <Text style={{ color: colour.text, fontWeight: '600' }}>
              {line.medicineSnapshot.brandName} {line.medicineSnapshot.strength ?? ''}
            </Text>
            {/*
              The batch and its expiry, because this is what a pharmacist reads
              off the boxes to check the delivery — and what a return has to
              name, line by line.
            */}
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {t('finance.batchAndExpiry', {
                batch: line.batchNumber,
                expiry: formatFinanceDate(line.expiryDate),
              })}
            </Text>
            <ListRow
              label={t('finance.quantityAtPrice', {
                quantity: line.quantity,
                price: formatMoneyMinor(line.unitPriceMinor),
              })}
              value={formatMoneyMinor(line.lineTotalMinor)}
              numeric
            />
            {line.freeQuantity > 0 ? (
              <Text style={{ color: colour.success, fontSize: layout.fontSize.sm }}>
                {t('cart.freeGoods', { count: line.freeQuantity })}
              </Text>
            ) : null}
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle>{t('finance.whatItCame')}</SectionTitle>
        <ListRow
          label={t('cart.subtotal')}
          value={formatMoneyMinor(invoice.subtotalMinor)}
          numeric
        />
        {invoice.orderDiscountMinor > 0 ? (
          <ListRow
            label={t('cart.discount')}
            value={`− ${formatMoneyMinor(invoice.orderDiscountMinor)}`}
            numeric
          />
        ) : null}
        {invoice.deliveryChargeMinor > 0 ? (
          <ListRow
            label={t('cart.deliveryCharge')}
            value={formatMoneyMinor(invoice.deliveryChargeMinor)}
            numeric
          />
        ) : null}
        {invoice.taxMinor > 0 ? (
          <ListRow label={t('reports.tax')} value={formatMoneyMinor(invoice.taxMinor)} numeric />
        ) : null}
        <ListRow
          label={t('finance.grandTotal')}
          value={formatMoneyMinor(invoice.grandTotalMinor)}
          numeric
        />
        <ListRow
          label={t('finance.paid')}
          value={formatMoneyMinor(invoice.amountPaidMinor)}
          numeric
        />
        <ListRow
          label={t('account.remaining')}
          value={formatMoneyMinor(invoice.amountDueMinor)}
          numeric
        />
      </Card>

      {/*
        The one screen that already knows which invoice a return is against, so
        the return form opens with the answer to its first question filled in.
        Cancelled invoices are excluded: there is nothing to credit back.
      */}
      {invoice.status === 'CANCELLED' ? null : (
        <Button
          variant="secondary"
          label={t('returns.raiseFromThis')}
          onPress={() =>
            router.push({ pathname: '/(protected)/return-new', params: { invoiceId: invoice._id } })
          }
        />
      )}

      {outstanding ? (
        <Button
          variant="secondary"
          label={t('finance.seeStatement')}
          onPress={() => router.push('/(protected)/statement')}
        />
      ) : null}
    </Screen>
  );
}
