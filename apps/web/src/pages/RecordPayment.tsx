import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PaymentMethod, PaymentStatus } from '@medsupply/shared-types';
import { toDateTimeInputValue, toMoneyInputValue } from '@medsupply/utilities';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Resource,
  Select,
  Textarea,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { createActionKey, formatMinor, parseMajorToMinor } from '../lib/finance';
import {
  invoiceDue,
  type ApiFailure,
  type FinanceInvoiceSummary,
  type FinancePayment,
  type FinanceShopSummary,
} from './financeTypes';

interface AttachmentPayload {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

const ACCEPTED_FILES = ['image/jpeg', 'image/png', 'application/pdf'];

async function attachmentPayload(
  file: File,
  wrongType: string,
  tooLarge: string,
): Promise<AttachmentPayload> {
  if (!ACCEPTED_FILES.includes(file.type)) throw new Error(wrongType);
  if (file.size < 1 || file.size > 2_000_000) throw new Error(tooLarge);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return { fileName: file.name, mimeType: file.type, base64Data: btoa(binary) };
}

export function RecordPayment() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const shops = useApiCollection<FinanceShopSummary>(
    ['active-shops'],
    '/shops?status=ACTIVE&limit=100',
  );

  const [shopId, setShopId] = useState(searchParams.get('shopId') ?? '');
  const [invoiceId, setInvoiceId] = useState(searchParams.get('invoiceId') ?? '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [transactionReference, setTransactionReference] = useState('');
  const [collectionTime, setCollectionTime] = useState(() => toDateTimeInputValue(new Date()));
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File>();
  const [postImmediately, setPostImmediately] = useState(true);
  const [allowAdvance, setAllowAdvance] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<FinancePayment>();
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  const invoices = useApiCollection<FinanceInvoiceSummary>(
    ['shop-open-invoices', shopId],
    `/finance/shops/${shopId}/invoices?status=OPEN`,
    { enabled: Boolean(shopId) },
  );

  /*
   * One idempotency key per attempt, cleared whenever the operator edits the
   * form. Retrying the same money must not create a second payment; editing it
   * must not be treated as the same one.
   */
  const idempotencyKey = useRef<string | undefined>(undefined);
  function changed() {
    idempotencyKey.current = undefined;
    setCreated(undefined);
    setFailure(undefined);
  }

  function chooseInvoice(value: string) {
    changed();
    setInvoiceId(value);
    const invoice = (invoices.data?.items ?? []).find((candidate) => candidate._id === value);
    if (invoice) setAmount(toMoneyInputValue(invoiceDue(invoice)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || created) return;
    setFailure(undefined);

    let amountMinor: number;
    try {
      amountMinor = parseMajorToMinor(amount);
      if (amountMinor <= 0) throw new Error(t('finance.amountPositive'));
    } catch (caught) {
      setFailure({
        message: caught instanceof Error ? caught.message : t('finance.badAmount'),
      });
      return;
    }

    setSubmitting(true);
    idempotencyKey.current ??= createActionKey('record-payment');
    try {
      const attachment = file
        ? await attachmentPayload(file, t('finance.proofWrongType'), t('finance.proofTooLarge'))
        : undefined;
      const response = await apiClient.post('/payments', {
        shopId,
        invoiceId: invoiceId || undefined,
        amountMinor,
        method,
        transactionReference: transactionReference.trim() || undefined,
        collectedAt: new Date(`${collectionTime}:00+06:00`).toISOString(),
        notes: notes.trim() || undefined,
        attachment,
        allowAdvance,
        idempotencyKey: idempotencyKey.current,
      });
      const payment = response.data.data as FinancePayment;
      setCreated(payment);
      if (postImmediately && payment.status === PaymentStatus.PENDING) {
        try {
          await apiClient.post(`/payments/${payment._id}/post`, {
            idempotencyKey: createActionKey('post-payment'),
            allowAdvance,
          });
        } catch {
          setFailure({ message: t('finance.savedButNotPosted') });
          return;
        }
      }
      navigate(`/payments/${payment._id}?recorded=1`);
    } catch (caught) {
      const status = (caught as ApiFailure).response?.status;
      setFailure({
        message:
          caught instanceof Error && !status
            ? caught.message
            : errorMessage(caught, language, t('finance.recordFailed')),
        reference: failureReference(caught),
      });
      // A 4xx means the request was understood and refused, so the same key
      // would be refused again; a 5xx may have been applied, so it is kept.
      if (status && status < 500) idempotencyKey.current = undefined;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <PageHeader
        routeId="payment-new"
        title={t('finance.recordTitle')}
        description={t('finance.recordSubtitle')}
        actions={<LinkButton to="/payments">{t('finance.allPayments')}</LinkButton>}
      />

      <Resource
        query={shops}
        loadingLabel={t('finance.loadingForm')}
        errorMessageFallback={t('finance.couldNotLoadShops')}
      >
        {(page) => (
          <Card className="max-w-2xl">
            <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
              {failure && (
                <div className="flex flex-col items-start gap-2">
                  <ErrorState message={failure.message} reference={failure.reference} />
                  {created && (
                    <LinkButton to={`/payments/${created._id}`}>
                      {t('finance.openPending')}
                    </LinkButton>
                  )}
                </div>
              )}

              <Field label={t('finance.whichShop')} required>
                <Select
                  required
                  value={shopId}
                  onChange={(event) => {
                    changed();
                    setShopId(event.target.value);
                    setInvoiceId('');
                  }}
                >
                  <option value="">{t('finance.selectShop')}</option>
                  {page.items.map((shop) => (
                    <option key={shop._id} value={shop._id}>
                      {shop.reference} · {shop.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t('finance.againstInvoice')}>
                <Select
                  value={invoiceId}
                  disabled={!shopId || invoices.isFetching}
                  onChange={(event) => chooseInvoice(event.target.value)}
                >
                  <option value="">
                    {invoices.isFetching ? t('finance.loadingInvoices') : t('finance.noInvoice')}
                  </option>
                  {(invoices.data?.items ?? []).map((invoice) => (
                    <option key={invoice._id} value={invoice._id}>
                      {invoice.reference} ·{' '}
                      {t('finance.dueOn', { amount: formatMinor(invoiceDue(invoice)) })}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('finance.amount')} hint={t('finance.amountHint')} required>
                  <Input
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => {
                      changed();
                      setAmount(event.target.value);
                    }}
                  />
                </Field>
                <Field label={t('finance.method')}>
                  <Select
                    value={method}
                    onChange={(event) => {
                      changed();
                      setMethod(event.target.value as PaymentMethod);
                    }}
                  >
                    {/* Not `CREDIT`: recording a payment "on account" would be
                        recording money that has not been paid. */}
                    {Object.values(PaymentMethod)
                      .filter((value) => value !== PaymentMethod.CREDIT)
                      .map((value) => (
                        <option key={value} value={value}>
                          {t(`paymentMethod.${value}`)}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label={t('finance.whenCollected')} required>
                  <Input
                    required
                    type="datetime-local"
                    value={collectionTime}
                    onChange={(event) => {
                      changed();
                      setCollectionTime(event.target.value);
                    }}
                  />
                </Field>
                <Field label={t('finance.theirReference')} hint={t('finance.theirReferenceHint')}>
                  <Input
                    maxLength={120}
                    value={transactionReference}
                    onChange={(event) => {
                      changed();
                      setTransactionReference(event.target.value);
                    }}
                  />
                </Field>
              </div>

              <Field label={t('finance.proofLabel')} hint={t('finance.proofHint')}>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={(event) => {
                    changed();
                    setFile(event.target.files?.[0]);
                  }}
                />
              </Field>

              <Field label={t('fields.notes')}>
                <Textarea
                  maxLength={1000}
                  value={notes}
                  onChange={(event) => {
                    changed();
                    setNotes(event.target.value);
                  }}
                />
              </Field>

              <label className="flex min-h-11 items-center gap-2 text-text">
                <input
                  type="checkbox"
                  checked={postImmediately}
                  onChange={(event) => {
                    changed();
                    setPostImmediately(event.target.checked);
                  }}
                />
                {t('finance.postImmediately')}
              </label>
              <label className="flex min-h-11 items-center gap-2 text-text">
                <input
                  type="checkbox"
                  checked={allowAdvance}
                  onChange={(event) => {
                    changed();
                    setAllowAdvance(event.target.checked);
                  }}
                />
                {t('finance.allowAdvance')}
              </label>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  busy={submitting}
                  disabled={Boolean(created)}
                >
                  {submitting ? t('finance.saving') : t('finance.saveRecord')}
                </Button>
              </div>
            </form>
          </Card>
        )}
      </Resource>
    </main>
  );
}
