import { useState, type FormEvent } from 'react';
import type {
  RecallBatchCandidate,
  RecallRecipient,
  RecallTrace as Trace,
} from '@medsupply/shared-types';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  type Column,
} from '../components/ui';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate } from '../lib/finance';

/**
 * Given a batch: who has it, and where it came from.
 *
 * This is the screen somebody opens under pressure, so it is built around the
 * one thing they are holding — a supplier's notice with a batch number printed
 * on it. Everything else follows from that.
 *
 * It is deliberately a **read**. `recallService` has no side effects and this
 * page adds none: initiating a recall is a decision with consequences for
 * customers and for the regulator, and looking one up must never be, or people
 * will hesitate before checking.
 *
 * Not driven by `useApiResource`: a trace runs against a batch the user picks
 * from a lookup, not against a route parameter, and caching the result of "the
 * last batch number somebody typed" is not something to keep for thirty
 * seconds.
 */

type State =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'candidates'; candidates: RecallBatchCandidate[] }
  | { kind: 'tracing' }
  | { kind: 'traced'; trace: Trace }
  | { kind: 'failed'; message: string; reference?: string };

export function RecallTrace() {
  const { t, language } = useLanguage();
  const [batchNumber, setBatchNumber] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function search(event: FormEvent) {
    event.preventDefault();
    const query = batchNumber.trim();
    if (!query) return;
    setState({ kind: 'searching' });
    try {
      const response = await apiClient.get(
        `/purchasing/recall/batches?batchNumber=${encodeURIComponent(query)}`,
      );
      const candidates = (response.data.data ?? []) as RecallBatchCandidate[];
      /*
       * One match traces straight through. More than one is not an error and
       * not a guess to make on somebody's behalf: the same batch number can
       * legitimately belong to two different medicines, and picking the wrong
       * one is the difference between recalling the right stock and the wrong.
       */
      if (candidates.length === 1) {
        await trace(candidates[0]!._id);
        return;
      }
      setState({ kind: 'candidates', candidates });
    } catch (caught) {
      setState({
        kind: 'failed',
        message: errorMessage(caught, language, t('purchasing.recallCouldNotTrace')),
        reference: failureReference(caught),
      });
    }
  }

  async function trace(batchId: string) {
    setState({ kind: 'tracing' });
    try {
      const response = await apiClient.get(`/purchasing/recall/batches/${batchId}`);
      setState({ kind: 'traced', trace: response.data.data as Trace });
    } catch (caught) {
      setState({
        kind: 'failed',
        message: errorMessage(caught, language, t('purchasing.recallCouldNotTrace')),
        reference: failureReference(caught),
      });
    }
  }

  const recipientColumns: ReadonlyArray<Column<RecallRecipient>> = [
    { key: 'shop', header: t('fields.shop'), cell: (row) => row.shopName },
    { key: 'shopReference', header: t('fields.reference'), cell: (row) => row.shopReference },
    {
      key: 'phone',
      header: t('fields.phone'),
      // The number somebody rings when the recall is real, so it dials.
      cell: (row) =>
        row.primaryPhone ? (
          <a className="text-brand underline" href={`tel:${row.primaryPhone}`}>
            {row.primaryPhone}
          </a>
        ) : (
          '—'
        ),
    },
    {
      key: 'quantity',
      header: t('purchasing.quantitySent'),
      numeric: true,
      cell: (row) => row.quantity,
    },
    { key: 'invoice', header: t('purchasing.invoicedOn'), cell: (row) => row.invoiceReference },
    {
      key: 'invoiceDate',
      header: t('fields.date'),
      cell: (row) => formatFinanceDate(row.invoiceDate),
    },
    {
      key: 'delivered',
      header: t('purchasing.deliveredOn'),
      cell: (row) => (row.deliveredAt ? formatFinanceDate(row.deliveredAt) : '—'),
    },
    {
      key: 'receiver',
      header: t('purchasing.receivedBy'),
      cell: (row) => row.receiverName ?? '—',
    },
  ];

  return (
    <>
      <PageHeader
        routeId="recall"
        title={t('purchasing.recallTitle')}
        description={t('purchasing.recallSubtitle')}
      />

      <Card className="mb-4 max-w-2xl">
        <form
          className="flex flex-wrap items-end gap-3"
          role="search"
          onSubmit={(event) => void search(event)}
        >
          <Field
            label={t('purchasing.recallSearchLabel')}
            hint={t('purchasing.recallSearchHint')}
            className="min-w-64 flex-1"
          >
            <Input
              value={batchNumber}
              autoCapitalize="characters"
              onChange={(event) => setBatchNumber(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary">
            {t('purchasing.recallSearch')}
          </Button>
        </form>
      </Card>

      {state.kind === 'idle' && (
        <EmptyState
          title={t('purchasing.recallStartHere')}
          description={t('purchasing.recallStartBody')}
        />
      )}

      {state.kind === 'searching' && <LoadingState label={t('purchasing.recallSearch')} />}
      {state.kind === 'tracing' && <LoadingState label={t('purchasing.recallTracing')} />}

      {state.kind === 'failed' && (
        <ErrorState message={state.message} reference={state.reference} />
      )}

      {state.kind === 'candidates' &&
        (state.candidates.length === 0 ? (
          <EmptyState
            title={t('purchasing.recallNoMatch')}
            description={t('purchasing.recallNoMatchBody')}
          />
        ) : (
          <Card>
            <h2 className="mb-2 text-lg font-semibold text-text">
              {t('purchasing.recallCandidates')}
            </h2>
            <ul className="flex flex-col gap-3">
              {state.candidates.map((candidate) => (
                <li
                  key={candidate._id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"
                >
                  <div>
                    <p className="font-medium text-text">
                      {candidate.medicineId.brandName} {candidate.medicineId.strength}
                    </p>
                    <p className="text-sm text-text-muted">
                      {candidate.medicineId.genericName} · {t('fields.batch')}{' '}
                      {candidate.batchNumber} · {t('fields.expiry')}{' '}
                      {formatFinanceDate(candidate.expiryDate)}
                    </p>
                  </div>
                  <Button onClick={() => void trace(candidate._id)}>
                    {t('purchasing.recallChoose')}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ))}

      {state.kind === 'traced' && (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xl font-semibold text-text">
                  {state.trace.medicine.brandName} {state.trace.medicine.strength}
                </p>
                <p className="text-text-muted">
                  {state.trace.medicine.genericName} · {state.trace.medicine.manufacturer}
                </p>
                <p className="mt-1 text-text">
                  {t('fields.batch')} {state.trace.batch.batchNumber} · {t('fields.expiry')}{' '}
                  {formatFinanceDate(state.trace.batch.expiryDate)}
                </p>
              </div>
              <div className="flex gap-2">
                {state.trace.batch.isBlocked && (
                  <Badge tone="danger">{t('purchasing.blocked')}</Badge>
                )}
                {state.trace.batch.isQuarantined && (
                  <Badge tone="warning">{t('purchasing.quarantined')}</Badge>
                )}
              </div>
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-4">
              <Metric
                label={t('purchasing.shopsAffected')}
                value={state.trace.totals.shopsAffected}
              />
              <Metric
                label={t('purchasing.despatched')}
                value={state.trace.totals.quantityDespatched}
              />
              <Metric
                label={t('purchasing.stillHeld')}
                value={state.trace.totals.quantityStillHeld}
              />
              <Metric
                label={t('purchasing.unaccounted')}
                value={state.trace.totals.quantityUnaccounted}
                tone={state.trace.totals.quantityUnaccounted > 0 ? 'warning' : 'normal'}
              />
            </dl>
            {state.trace.totals.quantityUnaccounted > 0 && (
              <p className="mt-2 text-sm text-text-muted">{t('purchasing.unaccountedBody')}</p>
            )}
          </Card>

          <Card className="mb-4">
            <h2 className="text-lg font-semibold text-text">{t('purchasing.forwardTitle')}</h2>
            <p className="mb-3 text-text-muted">{t('purchasing.forwardBody')}</p>
            {state.trace.recipients.length === 0 ? (
              <EmptyState title={t('purchasing.forwardNone')} />
            ) : (
              <DataTable
                caption={t('purchasing.forwardTitle')}
                columns={recipientColumns}
                rows={state.trace.recipients}
                rowKey={(row) => `${row.invoiceId}-${row.shopId}`}
                rowTest={(row) => row.invoiceReference}
              />
            )}
          </Card>

          <Card>
            <h2 className="mb-2 text-lg font-semibold text-text">
              {t('purchasing.backwardTitle')}
            </h2>
            {state.trace.origin.predatesPurchasing ? (
              <p className="text-text">{t('purchasing.predatesPurchasing')}</p>
            ) : (
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label={t('purchasing.supplier')} value={state.trace.origin.supplierName} />
                <Detail
                  label={t('fields.reference')}
                  value={state.trace.origin.supplierReference}
                />
                <Detail label={t('fields.phone')} value={state.trace.origin.supplierPhone} />
                <Detail
                  label={t('purchasing.licence')}
                  value={state.trace.origin.drugLicenceNumber}
                />
                <Detail
                  label={t('purchasing.ordersTitle')}
                  value={state.trace.origin.purchaseOrderReference}
                />
                <Detail
                  label={t('purchasing.receipts')}
                  value={state.trace.origin.goodsReceiptReference}
                />
                <Detail
                  label={t('purchasing.supplierInvoiceReference')}
                  value={state.trace.origin.supplierInvoiceReference}
                />
                <Detail
                  label={t('purchasing.supplierBatchReference')}
                  value={state.trace.origin.supplierBatchReference}
                />
                <Detail
                  label={t('purchasing.received')}
                  value={
                    state.trace.origin.receivedAt
                      ? formatFinanceDate(state.trace.origin.receivedAt)
                      : undefined
                  }
                />
              </dl>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function Metric({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: number;
  tone?: 'normal' | 'warning';
}) {
  return (
    <div>
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd
        className={`text-2xl font-semibold tabular-nums ${
          tone === 'warning' ? 'text-warning' : 'text-text'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-text">{value || '—'}</dd>
    </div>
  );
}
