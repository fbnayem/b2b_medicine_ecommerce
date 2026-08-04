import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { getPayment, getPaymentReceipt } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import type { FinancePayment, Receipt, ReferenceSnapshot } from '../../src/finance/types';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  StatusPill,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

function reference(value?: string | ReferenceSnapshot) {
  return typeof value === 'string' ? value : value?.reference;
}

export default function PaymentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const [payment, setPayment] = useState<FinancePayment>();
  const [receipt, setReceipt] = useState<Receipt>();
  const [loading, setLoading] = useState(true);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setPayment(await getPayment(id));
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('finance.couldNotLoadPayment')));
    } finally {
      setLoading(false);
    }
  }, [id, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadReceipt() {
    setReceiptLoading(true);
    try {
      setReceipt(await getPaymentReceipt(id));
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('finance.receiptFailed')));
    } finally {
      setReceiptLoading(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('finance.loadingPayment')} />
      </Screen>
    );
  }

  if (!payment) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <EmptyState title={t('finance.couldNotLoadPayment')} />
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Card>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: layout.space[2],
          }}
        >
          <Text style={{ fontSize: layout.fontSize.xl, fontWeight: '700', color: colour.brand }}>
            {payment.reference}
          </Text>
          <StatusPill kind="payment" status={payment.status} />
        </View>
        <Text
          style={{
            fontSize: layout.fontSize['3xl'],
            fontWeight: '700',
            color: colour.text,
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatMoneyMinor(payment.amountMinor)}
        </Text>

        <ListRow label={t('finance.method')} value={t(`paymentMethod.${payment.method}`)} />
        <ListRow label={t('finance.invoice')} value={reference(payment.invoiceId) ?? '—'} />
        <ListRow label={t('finance.delivery')} value={reference(payment.deliveryId) ?? '—'} />
        <ListRow
          label={t('finance.transactionReference')}
          value={payment.transactionReference ?? '—'}
        />
        <ListRow
          label={t('finance.collectedAt')}
          value={formatFinanceDate(payment.collectionTime)}
        />
        <ListRow label={t('finance.postedAt')} value={formatFinanceDate(payment.postingTime)} />
        <ListRow
          label={t('finance.receipt')}
          value={payment.receiptReference ?? t('finance.none')}
        />
        <ListRow
          label={t('finance.handoverLabel')}
          value={<Badge>{t(`handoverStatus.${payment.handoverStatus ?? 'NOT_REQUIRED'}`)}</Badge>}
        />

        {payment.attachmentFileId ? (
          <Text style={{ color: colour.textMuted }}>{t('finance.attachment')}</Text>
        ) : null}
        {payment.reversalReference ? (
          <Text style={{ color: colour.danger }}>
            {t('finance.reversedBy', { reference: payment.reversalReference })}
          </Text>
        ) : null}
        {payment.notes ? <Text style={{ color: colour.text }}>{payment.notes}</Text> : null}
      </Card>

      {payment.status === 'POSTED' ? (
        <Button
          busy={receiptLoading}
          label={t('finance.receipt')}
          onPress={() => void loadReceipt()}
        />
      ) : null}

      {receipt ? (
        <Card>
          <SectionTitle>{t('finance.receipt')}</SectionTitle>
          <ListRow label={t('finance.receipt')} value={receipt.receiptReference} />
          <ListRow label={t('finance.paymentReference')} value={receipt.paymentReference} />
          <ListRow label={t('finance.shop')} value={receipt.shopName} />
          <ListRow label={t('finance.invoice')} value={receipt.invoiceReference ?? '—'} />
          <ListRow
            label={t('finance.amount')}
            value={formatMoneyMinor(receipt.amountMinor)}
            numeric
          />
          <ListRow label={t('finance.method')} value={t(`paymentMethod.${receipt.method}`)} />
          <ListRow label={t('finance.postedAt')} value={formatFinanceDate(receipt.postedAt)} />
        </Card>
      ) : null}
    </Screen>
  );
}
