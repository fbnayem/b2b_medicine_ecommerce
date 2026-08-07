import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import type { RecallTrace } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import {
  findBatches,
  hasUnaccounted,
  traceBatch,
  type BatchMatch,
} from '../../src/warehouse/recall';
import { formatFinanceDate, formatFinanceDateTime } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
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
  SectionTitle,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Tracing a batch, from the number printed on the carton.
 *
 * A recall is a person standing in front of shelves with a phone in one hand
 * and a manufacturer's notice in the other, asking two questions: **is any of
 * it still here**, and **who did we send it to**. Both were desktop-only, which
 * is exactly backwards — the second question ends in telephone numbers, and the
 * device that traces the batch is the device that rings them.
 *
 * So each affected shop's number is a tap. That is the whole point of doing
 * this on a phone rather than reading it off a monitor and dialling by hand.
 */
export default function RecallScreen() {
  const { t, language } = useLanguage();
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<BatchMatch[]>();
  const [trace, setTrace] = useState<RecallTrace>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function search() {
    if (term.trim().length === 0) return;
    setBusy(true);
    setError('');
    setTrace(undefined);
    try {
      setMatches(await findBatches(term.trim()));
    } catch (caught) {
      setError(errorMessage(caught, language, t('purchasing.recallCouldNotTrace')));
    } finally {
      setBusy(false);
    }
  }

  async function open(batchId: string) {
    setBusy(true);
    setError('');
    try {
      setTrace(await traceBatch(batchId));
    } catch (caught) {
      setError(errorMessage(caught, language, t('purchasing.recallCouldNotTrace')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label={t('purchasing.recallSearchLabel')} hint={t('purchasing.recallSearchHint')}>
        <Input
          label={t('purchasing.recallSearchLabel')}
          autoCapitalize="characters"
          value={term}
          onChangeText={setTerm}
          onSubmitEditing={() => void search()}
        />
      </Field>
      <Button busy={busy} label={t('purchasing.recallSearch')} onPress={() => void search()} />

      {error ? <ErrorState message={error} onRetry={() => void search()} /> : null}

      {busy && !trace ? <LoadingState label={t('purchasing.recallTracing')} /> : null}

      {matches && matches.length === 0 ? (
        <EmptyState
          title={t('purchasing.recallNoMatch')}
          description={t('purchasing.recallNoMatchBody')}
        />
      ) : null}

      {matches && matches.length > 0 && !trace ? (
        <>
          <SectionTitle>{t('purchasing.recallCandidates')}</SectionTitle>
          {matches.map((batch) => (
            <Card key={batch._id}>
              <Text style={{ color: colour.text, fontWeight: '600' }}>
                {batch.medicineSnapshot?.brandName} {batch.medicineSnapshot?.strength ?? ''}
              </Text>
              <ListRow label={t('fields.batch')} value={batch.batchNumber} />
              <ListRow label={t('fields.expiry')} value={formatFinanceDate(batch.expiryDate)} />
              <ListRow label={t('purchasing.onHand')} value={batch.quantityOnHand} numeric />
              <Button
                variant="secondary"
                label={t('purchasing.recallChoose')}
                onPress={() => void open(batch._id)}
              />
            </Card>
          ))}
        </>
      ) : null}

      {trace ? (
        <>
          <Card>
            <Text style={{ color: colour.text, fontWeight: '600', fontSize: layout.fontSize.lg }}>
              {trace.medicine.brandName} {trace.medicine.strength}
            </Text>
            <ListRow label={t('fields.batch')} value={trace.batch.batchNumber} />
            <ListRow label={t('fields.expiry')} value={formatFinanceDate(trace.batch.expiryDate)} />
            <ListRow
              label={t('purchasing.shopsAffected')}
              value={trace.totals.shopsAffected}
              numeric
            />
            <ListRow
              label={t('purchasing.despatched')}
              value={trace.totals.quantityDespatched}
              numeric
            />
            <ListRow
              label={t('purchasing.stillHeld')}
              value={trace.totals.quantityStillHeld}
              numeric
            />

            <View style={{ flexDirection: 'row', gap: layout.space[2], flexWrap: 'wrap' }}>
              {trace.batch.isBlocked ? (
                <Badge tone="danger">{t('purchasing.blocked')}</Badge>
              ) : null}
              {trace.batch.isQuarantined ? (
                <Badge tone="warning">{t('purchasing.quarantined')}</Badge>
              ) : null}
            </View>

            {/*
              Said out loud, separately, and only when it is not zero. Received
              minus despatched minus what is on the shelf is stock that left the
              building with no invoice against it — during a recall that is the
              one number that changes what happens next.
            */}
            {hasUnaccounted(trace) ? (
              <Card style={{ borderColor: colour.danger }}>
                <ListRow
                  label={t('purchasing.unaccounted')}
                  value={trace.totals.quantityUnaccounted}
                  numeric
                />
                <Text style={{ color: colour.text }}>{t('purchasing.unaccountedBody')}</Text>
              </Card>
            ) : null}
          </Card>

          <SectionTitle>{t('purchasing.backwardTitle')}</SectionTitle>
          <Card>
            {trace.origin.predatesPurchasing ? (
              <Text style={{ color: colour.textMuted }}>{t('purchasing.predatesPurchasing')}</Text>
            ) : (
              <>
                <ListRow
                  label={t('purchasing.supplier')}
                  value={trace.origin.supplierName ?? '—'}
                />
                {trace.origin.supplierPhone ? (
                  <Button
                    variant="secondary"
                    label={t('purchasing.ringSupplier', { name: trace.origin.supplierName ?? '' })}
                    onPress={() => void Linking.openURL(`tel:${trace.origin.supplierPhone}`)}
                  />
                ) : null}
                <ListRow
                  label={t('shops.drugLicenceNumber')}
                  value={trace.origin.drugLicenceNumber ?? '—'}
                />
                <ListRow
                  label={t('purchasing.supplierInvoiceReference')}
                  value={trace.origin.supplierInvoiceReference ?? '—'}
                />
                {trace.origin.receivedAt ? (
                  <ListRow
                    label={t('purchasing.receiptOn')}
                    value={formatFinanceDateTime(trace.origin.receivedAt)}
                  />
                ) : null}
              </>
            )}
          </Card>

          <SectionTitle>{t('purchasing.forwardTitle')}</SectionTitle>
          <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
            {t('purchasing.forwardBody')}
          </Text>

          {trace.recipients.length === 0 ? (
            <EmptyState title={t('purchasing.forwardNone')} />
          ) : (
            trace.recipients.map((shop) => (
              <Card key={`${shop.shopId}-${shop.invoiceId}`}>
                <Text style={{ color: colour.text, fontWeight: '600' }}>{shop.shopName}</Text>
                <ListRow label={t('purchasing.quantitySent')} value={shop.quantity} numeric />
                <ListRow
                  label={t('purchasing.invoicedOn')}
                  value={`${shop.invoiceReference} · ${formatFinanceDate(shop.invoiceDate)}`}
                />
                {shop.deliveredAt ? (
                  <ListRow
                    label={t('purchasing.deliveredOn')}
                    value={formatFinanceDateTime(shop.deliveredAt)}
                  />
                ) : null}
                {shop.receiverName ? (
                  <ListRow label={t('purchasing.receivedBy')} value={shop.receiverName} />
                ) : null}
                {/*
                  The reason this belongs on a phone. A recall ends in telephone
                  calls, and the device that traced the batch is the device that
                  makes them.
                */}
                <Button
                  label={t('purchasing.ringShop', { name: shop.shopName })}
                  onPress={() => void Linking.openURL(`tel:${shop.primaryPhone}`)}
                />
              </Card>
            ))
          )}
        </>
      ) : null}
    </Screen>
  );
}
