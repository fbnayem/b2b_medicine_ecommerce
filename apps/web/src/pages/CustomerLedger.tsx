import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { FinanceSummaryCards } from '../components/FinanceSummaryCards';
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Resource,
  type Column,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDateTime, formatMinor } from '../lib/finance';
import type { AccountSummary, LedgerEntry } from './financeTypes';

export function CustomerLedger() {
  const { shopId } = useParams();
  const { t } = useLanguage();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '' });

  const summary = useApiResource<AccountSummary>(
    ['shop-finance-summary', shopId],
    `/finance/shops/${shopId}/summary`,
  );

  const params = new URLSearchParams();
  if (applied.from) params.set('from', applied.from);
  if (applied.to) params.set('to', applied.to);
  const ledger = useApiCollection<LedgerEntry>(
    ['shop-ledger', shopId, applied.from, applied.to],
    `/finance/shops/${shopId}/ledger${params.size ? `?${params.toString()}` : ''}`,
  );

  const columns: ReadonlyArray<Column<LedgerEntry>> = [
    {
      key: 'posted',
      header: t('finance.posted'),
      cell: (entry) =>
        formatFinanceDateTime(entry.postingTime ?? entry.postedAt ?? entry.createdAt),
    },
    {
      key: 'reference',
      header: t('fields.reference'),
      cell: (entry) => entry.reference ?? entry.sourceReference ?? '—',
    },
    {
      key: 'type',
      header: t('finance.type'),
      cell: (entry) => entry.type.replaceAll('_', ' ').toLowerCase(),
    },
    {
      key: 'description',
      header: t('finance.description'),
      cell: (entry) => entry.description ?? '—',
    },
    {
      key: 'debit',
      header: t('finance.debit'),
      numeric: true,
      cell: (entry) => (entry.debitMinor ? formatMinor(entry.debitMinor) : '—'),
    },
    {
      key: 'credit',
      header: t('finance.credit'),
      numeric: true,
      cell: (entry) => (entry.creditMinor ? formatMinor(entry.creditMinor) : '—'),
    },
    {
      key: 'balance',
      header: t('finance.balance'),
      numeric: true,
      cell: (entry) => <strong>{formatMinor(entry.balanceAfterMinor)}</strong>,
    },
  ];

  return (
    <main>
      <PageHeader
        routeId="shop-ledger"
        title={t('finance.ledgerTitle')}
        description={t('finance.ledgerSubtitle')}
        actions={
          <>
            <LinkButton to={`/shops/${shopId}`}>{t('finance.shop')}</LinkButton>
            <LinkButton to={`/shops/${shopId}/statement`}>{t('finance.statement')}</LinkButton>
            <LinkButton variant="primary" to={`/payments/new?shopId=${shopId}`}>
              {t('finance.recordPayment')}
            </LinkButton>
          </>
        }
      />

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ from, to });
        }}
      >
        <Field label={t('finance.from')} className="min-w-44">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label={t('finance.to')} className="min-w-44">
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
        <Button type="submit">{t('finance.applyDates')}</Button>
      </form>

      <Resource
        query={summary}
        loadingLabel={t('finance.loadingLedger')}
        errorMessageFallback={t('finance.couldNotLoadLedger')}
      >
        {(data) => <FinanceSummaryCards summary={data} />}
      </Resource>

      <div className="mt-4">
        <Resource
          query={ledger}
          loadingLabel={t('finance.loadingLedger')}
          errorMessageFallback={t('finance.couldNotLoadLedger')}
          empty={
            <EmptyState title={t('finance.noEntries')} description={t('finance.noEntriesBody')} />
          }
        >
          {(page) => (
            <DataTable
              caption={t('finance.ledgerTitle')}
              columns={columns}
              rows={page.items}
              rowKey={(entry) => entry._id}
              rowTest={(entry) => entry.reference ?? entry.sourceReference ?? entry._id}
            />
          )}
        </Resource>
      </div>
    </main>
  );
}
