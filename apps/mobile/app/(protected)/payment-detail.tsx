import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { FinanceCard, FinanceState, StatusBadge } from '../../src/finance/components';
import { apiErrorMessage, getPayment, getPaymentReceipt } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import type { FinancePayment, Receipt, ReferenceSnapshot } from '../../src/finance/types';

function reference(value?: string | ReferenceSnapshot) {
  return typeof value === 'string' ? value : value?.reference;
}

export default function PaymentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
      setError(apiErrorMessage(caught, 'Unable to load this payment.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadReceipt() {
    setReceiptLoading(true);
    try {
      setReceipt(await getPaymentReceipt(id));
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load the receipt.'));
    } finally {
      setReceiptLoading(false);
    }
  }

  if (loading || (!payment && error)) {
    return <FinanceState loading={loading} error={error} onRetry={() => void load()} />;
  }
  if (!payment) return <FinanceState empty="Payment not found." />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FinanceCard>
        <View style={styles.row}>
          <Text style={styles.reference}>{payment.reference}</Text>
          <StatusBadge value={payment.status} />
        </View>
        <Text style={styles.amount}>{formatMoneyMinor(payment.amountMinor)}</Text>
        <Detail label="Method" value={payment.method.replaceAll('_', ' ')} />
        <Detail label="Invoice" value={reference(payment.invoiceId) ?? '—'} />
        <Detail label="Delivery" value={reference(payment.deliveryId) ?? '—'} />
        <Detail label="Transaction reference" value={payment.transactionReference ?? '—'} />
        <Detail label="Collected" value={formatFinanceDate(payment.collectionTime)} />
        <Detail label="Posted" value={formatFinanceDate(payment.postingTime)} />
        <Detail label="Receipt" value={payment.receiptReference ?? 'Not issued'} />
        <Detail
          label="Collection handover"
          value={payment.handoverStatus?.replaceAll('_', ' ') ?? 'Not required'}
        />
        {payment.attachmentFileId ? (
          <Text style={styles.notice}>Payment proof is attached to this record.</Text>
        ) : null}
        {payment.reversalReference ? (
          <Text style={styles.notice}>Reversed by {payment.reversalReference}</Text>
        ) : null}
        {payment.notes ? <Text style={styles.notes}>{payment.notes}</Text> : null}
      </FinanceCard>
      {payment.status === 'POSTED' ? (
        <Pressable
          disabled={receiptLoading}
          style={styles.action}
          onPress={() => void loadReceipt()}
        >
          <Text style={styles.actionText}>
            {receiptLoading ? 'Loading receipt…' : 'View receipt'}
          </Text>
        </Pressable>
      ) : null}
      {receipt ? (
        <FinanceCard>
          <Text style={styles.title}>Payment receipt</Text>
          <Detail label="Receipt" value={receipt.receiptReference} />
          <Detail label="Payment" value={receipt.paymentReference} />
          <Detail label="Shop" value={receipt.shopName} />
          <Detail label="Invoice" value={receipt.invoiceReference ?? '—'} />
          <Detail label="Amount" value={formatMoneyMinor(receipt.amountMinor)} />
          <Detail label="Method" value={receipt.method.replaceAll('_', ' ')} />
          <Detail label="Posted" value={formatFinanceDate(receipt.postedAt)} />
        </FinanceCard>
      ) : null}
    </ScrollView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 14, gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  reference: { color: '#126b45', fontWeight: '900', fontSize: 19 },
  amount: { color: '#173f2e', fontWeight: '900', fontSize: 28, marginVertical: 5 },
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 15,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2ef',
  },
  label: { color: '#66756d', flex: 1 },
  value: { color: '#17251e', fontWeight: '700', flex: 1, textAlign: 'right' },
  notice: { backgroundColor: '#eef6f1', color: '#274b3b', padding: 10, borderRadius: 7 },
  notes: { backgroundColor: '#f6f7f6', padding: 10, borderRadius: 7 },
  action: { backgroundColor: '#126b45', borderRadius: 9, padding: 14 },
  actionText: { color: '#fff', textAlign: 'center', fontWeight: '900' },
  title: { fontWeight: '900', fontSize: 18 },
  error: { color: '#8b2525', backgroundColor: '#fff0ee', padding: 10, borderRadius: 8 },
});
