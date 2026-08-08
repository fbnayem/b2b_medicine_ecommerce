import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { FinanceSummaryCards } from '../components/FinanceSummaryCards';
import { LedgerCorrections } from '../components/LedgerCorrections';
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
import { keys } from '../lib/queryKeys';
import { translatedOr } from '@medsupply/i18n';
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
    keys.finance.shopSummary(shopId!),
    `/finance/shops/${shopId}/summary`,
  );

  const params = new URLSearchParams();
  if (applied.from) params.set('from', applied.from);
  if (applied.to) params.set('to', applied.to);
  const ledger = useApiCollection<LedgerEntry>(
    keys.finance.shopLedger(shopId!, applied),
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
      /*
       * The catalogue, not the enum. This printed
       * `entry.type.replaceAll('_', ' ').toLowerCase()`, so the ledger read
       * "invoice charge" and "credit adjustment" — the names of database values
       * — and stayed English whatever the language was set to, on the screen
       * somebody opens when they think they have been charged wrongly.
       *
       * `translatedOr` keeps a type the catalogue has not caught up with
       * readable rather than blank.
       */
      cell: (entry) => translatedOr(t, `ledgerTransactionType.${entry.type}`, entry.type),
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
    <>
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
        <Field label={t('finance.from')} className="min-w-44" hint={t('hints.dateFrom')}>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label={t('finance.to')} className="min-w-44" hint={t('hints.dateTo')}>
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

      {/*
        Below the ledger on purpose. Checking a balance and correcting one are
        the same job in the wrong order — nobody posts an adjustment before
        reading what is there — and putting the write above the record would
        offer the correction first.
      */}
      <LedgerCorrections shopId={shopId!} />
    </>
  );
}
