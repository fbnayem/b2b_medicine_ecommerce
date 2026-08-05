import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toDateInputValue } from '@medsupply/utilities';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Resource,
  type Column,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatFinanceDateTime, formatMinor } from '../lib/finance';
import type { FinanceReportData, FinanceReportRow } from './financeTypes';

type ReportKind = 'outstanding' | 'overdue' | 'collections';

interface ReportSummary {
  outstandingBalanceMinor?: number;
  overdueBalanceMinor?: number;
  collectedAmountMinor?: number;
  pendingCollectionMinor?: number;
  shopCount?: number;
}

const ROUTE_IDS: Record<ReportKind, string> = {
  outstanding: 'report-outstanding',
  overdue: 'report-overdue',
  collections: 'report-collections',
};

const TITLE_KEYS: Record<ReportKind, string> = {
  outstanding: 'finance.reportsOutstanding',
  overdue: 'finance.reportsOverdue',
  collections: 'finance.reportsCollections',
};

function reportAmount(kind: ReportKind, row: FinanceReportRow) {
  if (kind === 'outstanding') return row.outstandingBalanceMinor ?? row.amountMinor ?? 0;
  if (kind === 'overdue') return row.overdueBalanceMinor ?? row.amountMinor ?? 0;
  return row.collectedAmountMinor ?? row.amountMinor ?? 0;
}

function FinancialReportPage({ kind }: { kind: ReportKind }) {
  const { t } = useLanguage();
  // Dhaka's today, not UTC's: before 6 am the two differ, and a clerk opening
  // the collections report at the start of a shift got yesterday's figures.
  const today = toDateInputValue(new Date());
  const monthStart = `${today.slice(0, 8)}01`;

  const [asOf, setAsOf] = useState(today);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState({ asOf: today, from: monthStart, to: today });

  const search =
    kind === 'collections' ? `from=${applied.from}&to=${applied.to}` : `asOf=${applied.asOf}`;

  const report = useApiResource<FinanceReportData | FinanceReportRow[]>(
    ['finance-report', kind, search],
    `/finance/reports/${kind}?${search}`,
  );
  const summary = useApiResource<ReportSummary>(
    ['finance-report-summary', search],
    `/finance/reports/summary?${search}`,
  );

  const normalise = (raw: FinanceReportData | FinanceReportRow[]) =>
    Array.isArray(raw) ? { rows: raw } : raw;

  const collectionColumns: ReadonlyArray<Column<FinanceReportRow>> = [
    {
      key: 'payment',
      header: t('finance.paymentReference'),
      cell: (row) => row.paymentReference ?? '—',
    },
    {
      key: 'shop',
      header: t('fields.shop'),
      cell: (row) => (
        <div>
          <p className="text-text">{row.shopName ?? '—'}</p>
          <p className="text-sm text-text-muted">{row.shopReference}</p>
        </div>
      ),
    },
    {
      key: 'collector',
      header: t('finance.collectedBy'),
      cell: (row) => row.collectorName ?? '—',
    },
    {
      key: 'method',
      header: t('finance.method'),
      cell: (row) => (row.method ? t(`paymentMethod.${row.method}`) : '—'),
    },
    {
      key: 'status',
      header: t('fields.status'),
      cell: (row) => (row.status ? t(`paymentStatus.${row.status}`) : '—'),
    },
    {
      key: 'collected',
      header: t('finance.collectedAt'),
      cell: (row) => formatFinanceDateTime(row.collectionTime),
    },
    {
      key: 'amount',
      header: t('fields.amount'),
      numeric: true,
      cell: (row) => <strong>{formatMinor(reportAmount(kind, row))}</strong>,
    },
  ];

  const balanceColumns: ReadonlyArray<Column<FinanceReportRow>> = [
    {
      key: 'shop',
      header: t('fields.shop'),
      cell: (row) => (
        <div>
          <p className="text-text">{row.shopName ?? '—'}</p>
          <p className="text-sm text-text-muted">{row.shopReference}</p>
        </div>
      ),
    },
    {
      key: 'invoices',
      header: t('finance.invoiceCount'),
      numeric: true,
      cell: (row) => row.invoiceCount ?? '—',
    },
    {
      key: 'due',
      header: kind === 'overdue' ? t('finance.oldestDue') : t('fields.dueDate'),
      cell: (row) => formatFinanceDate(row.oldestDueDate ?? row.dueDate),
    },
    ...(kind === 'overdue'
      ? [
          {
            key: 'days',
            header: t('finance.overdueDays'),
            numeric: true,
            cell: (row: FinanceReportRow) => row.overdueDays ?? '—',
          },
        ]
      : []),
    {
      key: 'amount',
      header: t('fields.amount'),
      numeric: true,
      cell: (row) => <strong>{formatMinor(reportAmount(kind, row))}</strong>,
    },
    {
      key: 'ledger',
      header: '',
      label: '',
      cell: (row) =>
        row.shopId ? (
          <Link className="text-brand underline" to={`/shops/${row.shopId}/ledger`}>
            {t('finance.viewLedger')}
          </Link>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <PageHeader
        routeId={ROUTE_IDS[kind]}
        title={t(TITLE_KEYS[kind])}
        description={t('finance.reportsSubtitle')}
        actions={<LinkButton to="/payments">{t('finance.allPayments')}</LinkButton>}
      />

      {/*
        Links rather than buttons: each report is its own route, and a report a
        clerk wants to send to the accountant has to be addressable.
      */}
      <nav aria-label={t('nav.sections')} className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ['outstanding', '/reports/outstanding'],
            ['overdue', '/reports/overdue'],
            ['collections', '/reports/collections'],
          ] as const
        ).map(([value, path]) => (
          <Link
            key={value}
            to={path}
            aria-current={kind === value ? 'page' : undefined}
            className={
              kind === value
                ? 'min-h-11 rounded-full border border-brand bg-brand-subtle px-4 py-2 text-sm font-medium text-brand'
                : 'min-h-11 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-hover'
            }
          >
            {t(TITLE_KEYS[value])}
          </Link>
        ))}
      </nav>

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ asOf, from, to });
        }}
      >
        {kind === 'collections' ? (
          <>
            <Field label={t('finance.from')} className="min-w-44">
              <Input
                required
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Field>
            <Field label={t('finance.to')} className="min-w-44">
              <Input
                required
                type="date"
                min={from}
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field label={t('finance.asOf')} className="min-w-44">
            <Input
              required
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
            />
          </Field>
        )}
        <Button type="submit">{t('actions.apply')}</Button>
      </form>

      <Resource
        query={summary}
        loadingLabel={t('finance.loadingReport')}
        errorMessageFallback={t('finance.couldNotLoadReport')}
      >
        {(data) => (
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {(
              [
                [t('finance.outstandingTotal'), data.outstandingBalanceMinor ?? 0],
                [t('finance.overdueTotal'), data.overdueBalanceMinor ?? 0],
                [t('finance.collectedTotal'), data.collectedAmountMinor ?? 0],
              ] as const
            ).map(([label, value]) => (
              <Card key={label}>
                <p className="text-sm text-text-muted">{label}</p>
                <p className="text-xl font-semibold tabular-nums text-text">{formatMinor(value)}</p>
              </Card>
            ))}
          </div>
        )}
      </Resource>

      <Resource
        query={report}
        loadingLabel={t('finance.loadingReport')}
        errorMessageFallback={t('finance.couldNotLoadReport')}
        isEmpty={(raw) => normalise(raw).rows.length === 0}
        empty={<EmptyState title={t('finance.noRows')} description={t('finance.noRowsBody')} />}
      >
        {(raw) => (
          <DataTable
            caption={t(TITLE_KEYS[kind])}
            columns={kind === 'collections' ? collectionColumns : balanceColumns}
            rows={normalise(raw).rows}
            rowKey={(row) =>
              row.paymentReference ?? row.shopId ?? row.shopReference ?? JSON.stringify(row)
            }
            rowTest={(row) => row.paymentReference ?? row.shopReference ?? ''}
          />
        )}
      </Resource>
    </>
  );
}

export function OutstandingReport() {
  return <FinancialReportPage kind="outstanding" />;
}
export function OverdueReport() {
  return <FinancialReportPage kind="overdue" />;
}
export function CollectionReport() {
  return <FinancialReportPage kind="collections" />;
}
