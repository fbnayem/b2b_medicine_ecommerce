import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ReturnReason } from '@medsupply/shared-types';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  FormNotice,
  LinkButton,
  PageHeader,
  Resource,
  Select,
  Textarea,
  type Column,
  type FormProblem,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../lib/useLanguage';
import { createActionKey, formatFinanceDate, formatMinor } from '../lib/finance';

/** Stable id, so the validation notice can carry the reader to the lines. */
const LINES_PANEL = 'return-lines';

interface InvoiceOption {
  _id: string;
  reference: string;
  invoiceDate: string;
  grandTotalMinor: number;
}

interface InvoiceLine {
  medicineId: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  medicineSnapshot: { brandName: string; genericName: string; strength: string; packSize: string };
}

type Draft = Record<string, { quantity: string; reason: ReturnReason; notes: string }>;

const lineId = (line: InvoiceLine) => `${line.medicineId}:${line.batchId}`;

export function ReturnRequest() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();

  const [invoiceId, setInvoiceId] = useState(params.get('invoiceId') ?? '');
  const [draft, setDraft] = useState<Draft>({});
  const [primaryReason, setPrimaryReason] = useState<ReturnReason>(ReturnReason.DAMAGED_IN_TRANSIT);
  const [shopNotes, setShopNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();
  /** Which submit attempt this is; see `FormNotice`. */
  const [attempt, setAttempt] = useState(0);

  const invoices = useApiCollection<InvoiceOption>(
    keys.finance.myInvoices('returnable'),
    '/finance/my/invoices?limit=50',
  );

  const invoice = useApiResource<{ items?: InvoiceLine[] }>(
    keys.finance.invoiceLines(invoiceId),
    `/fulfilment/invoices/${invoiceId}`,
    { enabled: Boolean(invoiceId) },
  );

  const lines = useMemo(() => invoice.data?.items ?? [], [invoice.data]);

  /*
   * Seeds a row per invoice line when a different invoice is chosen. It keys
   * off `invoiceId` rather than `primaryReason` deliberately: re-seeding when
   * the main reason changes would wipe the per-line reasons somebody had
   * already set, which is the sort of quiet data loss nobody reports.
   */
  useEffect(() => {
    setDraft(
      Object.fromEntries(
        lines.map((line) => [lineId(line), { quantity: '', reason: primaryReason, notes: '' }]),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  const selected = useMemo(
    () =>
      lines
        .map((line) => ({ line, entry: draft[lineId(line)] }))
        .filter(
          (row): row is { line: InvoiceLine; entry: Draft[string] } =>
            Number(row.entry?.quantity) > 0,
        ),
    [lines, draft],
  );

  const estimateMinor = selected.reduce(
    (sum, { line, entry }) =>
      sum + Math.round((line.lineTotalMinor * Number(entry.quantity)) / line.quantity),
    0,
  );

  /*
   * Not filled in yet is not the same fact as the request being refused, and
   * this form used to report both with the red "Something went wrong" card.
   */
  const overLimit = selected.find(({ line, entry }) => Number(entry.quantity) > line.quantity);
  const problems: FormProblem[] = [];
  if (!selected.length) problems.push({ message: t('returns.needQuantity'), focus: LINES_PANEL });
  if (overLimit) {
    problems.push({
      message: t('returns.tooMany', {
        maximum: overLimit.line.quantity,
        brand: overLimit.line.medicineSnapshot.brandName,
      }),
      focus: LINES_PANEL,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttempt((count) => count + 1);
    if (problems.length > 0) return;

    setSubmitting(true);
    setFailure(undefined);
    try {
      const response = await apiClient.post('/returns', {
        invoiceId,
        primaryReason,
        shopNotes: shopNotes.trim() || undefined,
        lines: selected.map(({ line, entry }) => ({
          medicineId: line.medicineId,
          batchId: line.batchId,
          quantity: Number(entry.quantity),
          reason: entry.reason,
          notes: entry.notes.trim() || undefined,
        })),
        idempotencyKey: createActionKey('return-request'),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.returns.all }),
        queryClient.invalidateQueries({ queryKey: keys.finance.all }),
      ]);
      navigate(`/returns/${response.data.data._id}`);
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('returns.submitFailed')),
        reference: failureReference(caught),
      });
      setSubmitting(false);
    }
  }

  const columns: ReadonlyArray<Column<InvoiceLine>> = [
    {
      key: 'item',
      header: t('returns.columnItem'),
      cell: (line) => (
        <div>
          <p className="font-medium text-text">{line.medicineSnapshot.brandName}</p>
          <p className="text-sm text-text-muted">
            {line.medicineSnapshot.strength} · {line.medicineSnapshot.packSize}
          </p>
        </div>
      ),
    },
    {
      key: 'batch',
      header: t('fields.batch'),
      cell: (line) => (
        <div>
          <p className="text-text">{line.batchNumber}</p>
          <p className="text-sm text-text-muted">
            {t('returns.expires', { date: formatFinanceDate(line.expiryDate) })}
          </p>
        </div>
      ),
    },
    {
      key: 'invoiced',
      header: t('returns.columnInvoiced'),
      numeric: true,
      cell: (line) => line.quantity,
    },
    {
      key: 'quantity',
      header: t('returns.columnReturnQuantity'),
      numeric: true,
      cell: (line) => {
        const key = lineId(line);
        const entry = draft[key] ?? { quantity: '', reason: primaryReason, notes: '' };
        return (
          <input
            aria-label={t('returns.quantityFor', { brand: line.medicineSnapshot.brandName })}
            type="number"
            min={0}
            max={line.quantity}
            value={entry.quantity}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [key]: { ...entry, quantity: event.target.value },
              }))
            }
            className="min-h-11 w-24 rounded-md border border-border bg-surface px-3 text-end tabular-nums text-text"
          />
        );
      },
    },
    {
      key: 'reason',
      header: t('returns.columnReason'),
      cell: (line) => {
        const key = lineId(line);
        const entry = draft[key] ?? { quantity: '', reason: primaryReason, notes: '' };
        return (
          <select
            aria-label={t('returns.reasonFor', { brand: line.medicineSnapshot.brandName })}
            value={entry.reason}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [key]: { ...entry, reason: event.target.value as ReturnReason },
              }))
            }
            className="min-h-11 rounded-md border border-border bg-surface px-3 text-text"
          >
            {Object.values(ReturnReason).map((reason) => (
              <option key={reason} value={reason}>
                {t(`returnReason.${reason}`)}
              </option>
            ))}
          </select>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        routeId="return-new"
        title={t('returns.requestTitle')}
        description={t('returns.requestSubtitle')}
        actions={<LinkButton to="/returns">{t('actions.back')}</LinkButton>}
      />

      <Resource
        query={invoices}
        loadingLabel={t('returns.loadingInvoices')}
        errorMessageFallback={t('returns.couldNotLoadInvoices')}
        empty={
          <EmptyState title={t('returns.noInvoices')} description={t('returns.noInvoicesBody')} />
        }
      >
        {(page) => (
          <Card>
            <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
              {failure && <ErrorState message={failure.message} reference={failure.reference} />}
              {attempt > 0 && <FormNotice problems={problems} focusKey={attempt} />}

              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t('returns.invoice')} required hint={t('hints.returnInvoice')}>
                  <Select
                    required
                    value={invoiceId}
                    onChange={(event) => setInvoiceId(event.target.value)}
                  >
                    <option value="">{t('returns.selectInvoice')}</option>
                    {page.items.map((option) => (
                      <option key={option._id} value={option._id}>
                        {option.reference} — {formatFinanceDate(option.invoiceDate)} —{' '}
                        {formatMinor(option.grandTotalMinor)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('returns.mainReason')} hint={t('hints.returnReason')}>
                  <Select
                    value={primaryReason}
                    onChange={(event) => setPrimaryReason(event.target.value as ReturnReason)}
                  >
                    {Object.values(ReturnReason).map((reason) => (
                      <option key={reason} value={reason}>
                        {t(`returnReason.${reason}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {invoiceId && (
                <div id={LINES_PANEL} tabIndex={-1}>
                  <Resource
                    query={invoice}
                    loadingLabel={t('returns.loadingLines')}
                    errorMessageFallback={t('returns.couldNotLoadLines')}
                    isEmpty={(data) => (data.items ?? []).length === 0}
                    empty={<EmptyState title={t('returns.noLines')} />}
                  >
                    {() => (
                      <DataTable
                        caption={t('returns.requestTitle')}
                        columns={columns}
                        rows={lines}
                        rowKey={lineId}
                        rowTest={(line) => line.batchNumber}
                      />
                    )}
                  </Resource>
                </div>
              )}

              <Field label={t('returns.notesForSupplier')} hint={t('hints.notesForSupplier')}>
                <Textarea
                  rows={3}
                  maxLength={1000}
                  value={shopNotes}
                  onChange={(event) => setShopNotes(event.target.value)}
                />
              </Field>

              <p className="text-text-muted">
                <strong className="text-text">
                  {t('returns.estimate', { amount: formatMinor(estimateMinor) })}
                </strong>{' '}
                {t('returns.estimateBody')}
              </p>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  busy={submitting}
                  disabled={selected.length === 0}
                >
                  {submitting ? t('returns.submitting') : t('returns.submit')}
                </Button>
              </div>
            </form>
          </Card>
        )}
      </Resource>
    </>
  );
}
