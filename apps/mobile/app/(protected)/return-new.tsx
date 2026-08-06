import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ReturnReason } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import {
  estimateMinor,
  getInvoiceLines,
  getReturnableInvoices,
  lineKey,
  requestReturn,
  returnProblem,
  seedDraft,
  selectedLines,
  type InvoiceLine,
  type InvoiceOption,
  type ReturnDraft,
} from '../../src/returns/request';
import { formatFinanceDate } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  Input,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Raising a return, at the moment it can be got right.
 *
 * `POST /api/v1/returns` has admitted a shop owner since the returns phase and
 * had **no caller on this client**. A pharmacy opening a carton and finding it
 * damaged or short-dated had to find a computer — while standing over the box
 * with the batch numbers in front of them, which is exactly when the record is
 * easiest to make accurate.
 *
 * Three steps, in the order somebody has the information: **which invoice**,
 * **which lines and how many**, **why**. The invoice comes first because every
 * line is a line *of an invoice* — a return is raised against what was
 * delivered and charged for, never against the catalogue.
 *
 * The idempotency key is held on a ref rather than rebuilt inside `submit`,
 * for the reason `checkout.tsx` writes out at length: a key that changes on
 * every retry defeats the mechanism on the one failure it exists for.
 */
export default function ReturnRequestScreen() {
  const { invoiceId: fromParams } = useLocalSearchParams<{ invoiceId?: string }>();
  const { t, language } = useLanguage();

  const [invoices, setInvoices] = useState<InvoiceOption[]>();
  const [invoiceId, setInvoiceId] = useState(fromParams ?? '');
  const [lines, setLines] = useState<InvoiceLine[]>();
  const [draft, setDraft] = useState<ReturnDraft>({});
  const [primaryReason, setPrimaryReason] = useState<ReturnReason>(ReturnReason.DAMAGED_IN_TRANSIT);
  const [shopNotes, setShopNotes] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lineError, setLineError] = useState('');

  const idempotencyKey = useRef(createFinancialIdempotencyKey('return-request', 'new'));

  const loadInvoices = useCallback(async () => {
    setError('');
    try {
      setInvoices(await getReturnableInvoices());
    } catch (caught) {
      setError(errorMessage(caught, language, t('returns.couldNotLoadInvoices')));
    }
  }, [language, t]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  const loadLines = useCallback(async () => {
    if (!invoiceId) {
      setLines(undefined);
      return;
    }
    setLineError('');
    setLines(undefined);
    try {
      setLines(await getInvoiceLines(invoiceId));
    } catch (caught) {
      setLineError(errorMessage(caught, language, t('returns.couldNotLoadLines')));
    }
  }, [invoiceId, language, t]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

  /*
   * Re-seeded when the invoice changes and **not** when the main reason does.
   * Re-seeding on a reason change would wipe every per-line reason somebody had
   * already set, which is the sort of quiet data loss nobody reports because
   * they assume they mis-tapped.
   */
  useEffect(() => {
    if (lines) setDraft(seedDraft(lines, primaryReason));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  const selected = useMemo(() => selectedLines(lines ?? [], draft), [lines, draft]);
  const problem = lines ? returnProblem(lines, draft) : { key: 'returns.needQuantity' as const };
  const shown = attempted ? problem : null;

  const submit = async () => {
    setAttempted(true);
    if (problem || !invoiceId) return;
    setSubmitting(true);
    setError('');
    try {
      const created = await requestReturn({
        invoiceId,
        primaryReason,
        shopNotes,
        selected,
        idempotencyKey: idempotencyKey.current,
      });
      router.replace({ pathname: '/(protected)/return-detail', params: { id: created._id } });
    } catch (caught) {
      const status = (caught as { response?: { status?: number } }).response?.status ?? 0;
      // A 4xx means the request was rejected outright, so the next attempt is
      // genuinely new. A 5xx or a dropped connection may already have created
      // the return, and the key must survive to say so.
      if (status >= 400 && status < 500) {
        idempotencyKey.current = createFinancialIdempotencyKey('return-request', 'new');
      }
      setError(errorMessage(caught, language, t('returns.submitFailed')));
      setSubmitting(false);
    }
  };

  if (!invoices && !error) {
    return (
      <Screen>
        <LoadingState label={t('returns.loadingInvoices')} />
      </Screen>
    );
  }

  if (invoices && invoices.length === 0) {
    return (
      <Screen>
        <EmptyState title={t('returns.noInvoices')} description={t('returns.noInvoicesBody')} />
      </Screen>
    );
  }

  return (
    <Screen>
      {error ? <ErrorState message={error} onRetry={() => void loadInvoices()} /> : null}

      <Text style={{ color: colour.textMuted }}>{t('returns.requestSubtitle')}</Text>

      <Card>
        <SectionTitle>{t('returns.invoice')}</SectionTitle>
        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('hints.returnInvoice')}
        </Text>
        {/*
          A row of chips rather than a picker wheel: on a phone the invoice is
          chosen from a handful of recent ones, and the reference plus the date
          is what somebody matches against the paper in their hand.
        */}
        <FilterChips
          label={t('returns.selectInvoice')}
          value={invoiceId}
          onChange={setInvoiceId}
          options={(invoices ?? []).map((invoice) => ({
            value: invoice._id,
            label: `${invoice.reference} · ${formatFinanceDate(invoice.invoiceDate)}`,
          }))}
        />
      </Card>

      <Card>
        <SectionTitle>{t('returns.mainReason')}</SectionTitle>
        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('hints.returnReason')}
        </Text>
        <FilterChips
          label={t('returns.mainReason')}
          value={primaryReason}
          onChange={(next) => {
            const reason = next as ReturnReason;
            setPrimaryReason(reason);
            // Applied to rows nobody has touched, so changing the main reason
            // once is enough for the usual case of one reason for everything.
            setDraft((current) =>
              Object.fromEntries(
                Object.entries(current).map(([key, entry]) => [
                  key,
                  entry.quantity ? entry : { ...entry, reason },
                ]),
              ),
            );
          }}
          options={Object.values(ReturnReason).map((reason) => ({
            value: reason,
            label: t(`returnReason.${reason}`),
          }))}
        />
      </Card>

      {!invoiceId ? (
        <EmptyState title={t('returns.pickInvoiceFirst')} />
      ) : lineError ? (
        <ErrorState message={lineError} onRetry={() => void loadLines()} />
      ) : !lines ? (
        <LoadingState label={t('returns.loadingLines')} />
      ) : lines.length === 0 ? (
        <EmptyState title={t('returns.noLines')} />
      ) : (
        lines.map((line) => {
          const key = lineKey(line);
          const entry = draft[key] ?? { quantity: '', reason: primaryReason, notes: '' };
          return (
            <Card key={key}>
              <Text style={{ color: colour.text, fontWeight: '600' }}>
                {line.medicineSnapshot.brandName} {line.medicineSnapshot.strength ?? ''}
              </Text>
              {/*
                Batch and expiry on every row: they are what a pharmacist reads
                off the boxes, and the batch is what the credit note is raised
                against.
              */}
              <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                {t('finance.batchAndExpiry', {
                  batch: line.batchNumber,
                  expiry: formatFinanceDate(line.expiryDate),
                })}
              </Text>
              <ListRow label={t('returns.columnInvoiced')} value={line.quantity} numeric />

              <Field
                label={t('returns.columnReturnQuantity')}
                hint={t('returns.upTo', { maximum: line.quantity })}
              >
                <Input
                  label={t('returns.quantityFor', { brand: line.medicineSnapshot.brandName })}
                  value={entry.quantity}
                  onChangeText={(quantity) =>
                    setDraft((current) => ({ ...current, [key]: { ...entry, quantity } }))
                  }
                  keyboardType="number-pad"
                  invalid={
                    shown?.key === 'returns.tooMany' && Number(entry.quantity) > line.quantity
                  }
                />
              </Field>

              {Number(entry.quantity) > 0 ? (
                <Field label={t('returns.columnReason')}>
                  <FilterChips
                    label={t('returns.reasonFor', { brand: line.medicineSnapshot.brandName })}
                    value={entry.reason}
                    onChange={(reason) =>
                      setDraft((current) => ({
                        ...current,
                        [key]: { ...entry, reason: reason as ReturnReason },
                      }))
                    }
                    options={Object.values(ReturnReason).map((reason) => ({
                      value: reason,
                      label: t(`returnReason.${reason}`),
                    }))}
                  />
                </Field>
              ) : null}
            </Card>
          );
        })
      )}

      <Field label={t('returns.notesForSupplier')} hint={t('hints.notesForSupplier')}>
        <Input
          label={t('returns.notesForSupplier')}
          value={shopNotes}
          onChangeText={setShopNotes}
          multiline
          maxLength={1000}
          style={{ minHeight: layout.space[10], paddingTop: layout.space[3] }}
        />
      </Field>

      {shown ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colour.danger, fontSize: layout.fontSize.sm }}
        >
          {t(shown.key, shown.values)}
        </Text>
      ) : null}

      <Card>
        <ListRow
          label={t('returns.estimateLabel')}
          value={formatMoneyMinor(estimateMinor(selected))}
          numeric
        />
        {/*
          Said plainly, because the figure above is the one thing on this screen
          somebody could take as a promise. A manager decides what is approved,
          line by line, and the credit note follows that decision.
        */}
        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('returns.estimateBody')}
        </Text>
      </Card>

      <Button
        label={submitting ? t('returns.submitting') : t('returns.submit')}
        busy={submitting}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
