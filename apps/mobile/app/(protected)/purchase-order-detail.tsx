import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { GoodsReceipt, PurchaseOrder, PurchaseOrderLine } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import {
  getPurchaseOrder,
  outstandingOn,
  receiptProblem,
  receiveGoods,
  stillArriving,
  type ReceiptLineDraft,
} from '../../src/warehouse/purchasing';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  StatusPill,
  toast,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

interface LineDraft {
  batchNumber: string;
  warehouseLocation: string;
  receivedQuantity: string;
  manufacturingDate: string;
  expiryDate: string;
  varianceReason: string;
}

const EMPTY: LineDraft = {
  batchNumber: '',
  warehouseLocation: '',
  receivedQuantity: '',
  manufacturingDate: '',
  expiryDate: '',
  varianceReason: '',
};

/**
 * One purchase order, and booking in what actually arrived.
 *
 * This is the goods-in door: a lorry outside, cartons open, somebody reading a
 * batch number and an expiry date off the side of a box. Until now that person
 * wrote it on paper and typed it into a desktop later — a transcription, with
 * an expiry date in it, of the one fact that decides whether a medicine may be
 * sold.
 *
 * The form takes **one line at a time** rather than a grid. Nobody books in a
 * twelve-line delivery on a phone in one go, and a partial receipt is a first-
 * class outcome here: the order stays `PARTIALLY_RECEIVED` and what is left is
 * shown as what is left.
 */
export default function PurchaseOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const [order, setOrder] = useState<PurchaseOrder>();
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [invoice, setInvoice] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const answer = await getPurchaseOrder(id);
      setOrder(answer.order);
      setReceipts(answer.receipts ?? []);
    } catch (caught) {
      setError(errorMessage(caught, language, t('purchasing.orderCouldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [id, language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const draftFor = (lineId: string) => drafts[lineId] ?? EMPTY;
  const set = (lineId: string, field: keyof LineDraft, value: string) =>
    setDrafts((current) => ({
      ...current,
      [lineId]: { ...(current[lineId] ?? EMPTY), [field]: value },
    }));

  async function book(line: PurchaseOrderLine) {
    if (!order) return;
    const draft = draftFor(line._id);
    const problem = receiptProblem(line, draft);
    if (problem) {
      toast.error(t(problem.key, problem.values));
      return;
    }

    setBusy(line._id);
    try {
      const booked: ReceiptLineDraft = {
        purchaseOrderLineId: line._id,
        batchNumber: draft.batchNumber.trim(),
        manufacturingDate: draft.manufacturingDate,
        expiryDate: draft.expiryDate,
        receivedQuantity: Number(draft.receivedQuantity.trim()),
        warehouseLocation: draft.warehouseLocation.trim(),
        ...(draft.varianceReason.trim() ? { varianceReason: draft.varianceReason.trim() } : {}),
      };
      await receiveGoods(order._id, {
        ...(invoice.trim() ? { supplierInvoiceReference: invoice.trim() } : {}),
        lines: [booked],
      });
      setDrafts((current) => ({ ...current, [line._id]: EMPTY }));
      toast.success(t('purchasing.receiptSaved', { count: booked.receivedQuantity }));
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('purchasing.receiptFailed')));
    } finally {
      setBusy('');
    }
  }

  if (!order) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <LoadingState label={t('purchasing.orderLoading')} />
        )}
      </Screen>
    );
  }

  const receiving = stillArriving(order);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colour.canvas }}
      contentContainerStyle={{ padding: layout.space[4], gap: layout.space[3] }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
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
        <Text style={{ color: colour.brand, fontWeight: '600', fontSize: layout.fontSize.lg }}>
          {order.reference}
        </Text>
        <StatusPill kind="purchaseOrder" status={order.status} />
      </View>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {receiving ? (
        <Card>
          {/*
            Asked once, at the top, and applied to whatever is booked in below.
            It is the supplier's own number off the paper invoice in the
            driver's hand, and typing it per line would be typing it twelve
            times off one piece of paper.
          */}
          <Field
            label={t('purchasing.supplierInvoiceReference')}
            hint={t('purchasing.supplierInvoiceHint')}
          >
            <Input
              label={t('purchasing.supplierInvoiceReference')}
              value={invoice}
              onChangeText={setInvoice}
            />
          </Field>
        </Card>
      ) : null}

      <SectionTitle>{t('purchasing.orderLines')}</SectionTitle>

      {order.lines.map((line) => {
        const outstanding = outstandingOn(line);
        const draft = draftFor(line._id);
        return (
          <Card key={line._id}>
            <Text style={{ color: colour.text, fontWeight: '600' }}>
              {line.medicineSnapshot.brandName} {line.medicineSnapshot.strength ?? ''}
            </Text>
            <ListRow label={t('purchasing.ordered')} value={line.orderedQuantity} numeric />
            <ListRow label={t('purchasing.received')} value={line.receivedQuantity} numeric />
            <ListRow
              label={t('purchasing.unitCost')}
              value={formatMoneyMinor(line.unitCostMinor)}
              numeric
            />

            {receiving && outstanding > 0 ? (
              <>
                <Field label={t('purchasing.batchNumber')} hint={t('purchasing.batchNumberHint')}>
                  <Input
                    label={t('purchasing.batchNumber')}
                    autoCapitalize="characters"
                    value={draft.batchNumber}
                    onChangeText={(value) => set(line._id, 'batchNumber', value)}
                  />
                </Field>
                <Field label={t('purchasing.expiryDate')} hint={t('purchasing.dateHint')}>
                  <Input
                    label={t('purchasing.expiryDate')}
                    placeholder="YYYY-MM-DD"
                    value={draft.expiryDate}
                    onChangeText={(value) => set(line._id, 'expiryDate', value)}
                  />
                </Field>
                <Field label={t('purchasing.manufacturingDate')} hint={t('purchasing.dateHint')}>
                  <Input
                    label={t('purchasing.manufacturingDate')}
                    placeholder="YYYY-MM-DD"
                    value={draft.manufacturingDate}
                    onChangeText={(value) => set(line._id, 'manufacturingDate', value)}
                  />
                </Field>
                <Field
                  label={t('purchasing.warehouseLocation')}
                  hint={t('purchasing.warehouseLocationHint')}
                >
                  <Input
                    label={t('purchasing.warehouseLocation')}
                    value={draft.warehouseLocation}
                    onChangeText={(value) => set(line._id, 'warehouseLocation', value)}
                  />
                </Field>
                <Field
                  label={t('purchasing.receivedQuantity')}
                  hint={t('purchasing.outstandingHint', { count: outstanding })}
                >
                  <Input
                    label={t('purchasing.receivedQuantity')}
                    keyboardType="number-pad"
                    value={draft.receivedQuantity}
                    onChangeText={(value) =>
                      set(line._id, 'receivedQuantity', value.replace(/[^0-9]/g, ''))
                    }
                  />
                </Field>
                {/*
                  Shown only when it is needed. A short delivery is a real
                  event and a conversation with the supplier; accepting one
                  silently makes it look like a counting error three weeks
                  later, which is why the rule requires a reason.
                */}
                {draft.receivedQuantity !== '' && Number(draft.receivedQuantity) < outstanding ? (
                  <Field
                    label={t('purchasing.varianceReason')}
                    hint={t('purchasing.varianceReasonHint')}
                  >
                    <Input
                      label={t('purchasing.varianceReason')}
                      value={draft.varianceReason}
                      onChangeText={(value) => set(line._id, 'varianceReason', value)}
                    />
                  </Field>
                ) : null}

                <Button
                  busy={busy === line._id}
                  label={t('purchasing.confirmReceipt')}
                  accessibilityLabel={t('purchasing.bookInLine', {
                    brand: line.medicineSnapshot.brandName ?? '',
                  })}
                  onPress={() => void book(line)}
                />
              </>
            ) : null}
          </Card>
        );
      })}

      {receipts.length > 0 ? (
        <>
          <SectionTitle>{t('purchasing.receipts')}</SectionTitle>
          {receipts.map((receipt) => (
            <Card key={receipt._id}>
              <Text style={{ color: colour.brand, fontWeight: '600' }}>{receipt.reference}</Text>
              <ListRow
                label={t('purchasing.receiptOn')}
                value={formatFinanceDate(receipt.receivedAt)}
              />
              {receipt.supplierInvoiceReference ? (
                <ListRow
                  label={t('purchasing.supplierInvoiceReference')}
                  value={receipt.supplierInvoiceReference}
                />
              ) : null}
              {receipt.lines.map((line) => (
                <View key={`${line.batchNumber}-${line.purchaseOrderLineId}`}>
                  <ListRow
                    label={t('purchasing.batchAndExpiry', {
                      batch: line.batchNumber,
                      expiry: formatFinanceDate(line.expiryDate),
                    })}
                    value={line.receivedQuantity}
                    numeric
                  />
                  {line.varianceQuantity !== 0 ? (
                    <Text style={{ color: colour.warning, fontSize: layout.fontSize.sm }}>
                      {t('purchasing.shortBy', {
                        count: line.varianceQuantity,
                        reason: line.varianceReason ?? '',
                      })}
                    </Text>
                  ) : null}
                </View>
              ))}
            </Card>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
