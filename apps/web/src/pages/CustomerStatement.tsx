import { useState } from 'react';
import { useParams } from 'react-router-dom';
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
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatMinor } from '../lib/finance';
import type { CustomerStatementData } from './financeTypes';

interface CustomerStatementProps {
  ownerMode?: boolean;
}

type StatementEntry = CustomerStatementData['entries'][number];

function initialDates() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${day}` };
}

export function CustomerStatement({ ownerMode = false }: CustomerStatementProps) {
  const { shopId } = useParams();
  const { t } = useLanguage();
  const initial = initialDates();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [applied, setApplied] = useState(initial);

  const path = ownerMode ? '/finance/my/statement' : `/finance/shops/${shopId}/statement`;
  const statement = useApiResource<CustomerStatementData>(
    keys.finance.statement(ownerMode ? 'mine' : (shopId ?? ''), applied),
    `${path}?from=${applied.from}&to=${applied.to}`,
  );

  const columns: ReadonlyArray<Column<StatementEntry>> = [
    {
      key: 'date',
      header: t('fields.date'),
      cell: (entry) => formatFinanceDate(entry.postingTime ?? entry.postedAt ?? entry.createdAt),
    },
    {
      key: 'reference',
      header: t('fields.reference'),
      cell: (entry) => entry.reference ?? entry.sourceReference ?? '—',
    },
    {
      key: 'description',
      header: t('statement.description'),
      cell: (entry) => entry.description ?? entry.type.replaceAll('_', ' ').toLowerCase(),
    },
    {
      key: 'debit',
      header: t('statement.debit'),
      numeric: true,
      cell: (entry) => (entry.debitMinor ? formatMinor(entry.debitMinor) : '—'),
    },
    {
      key: 'credit',
      header: t('statement.credit'),
      numeric: true,
      cell: (entry) => (entry.creditMinor ? formatMinor(entry.creditMinor) : '—'),
    },
    {
      key: 'balance',
      header: t('statement.balance'),
      numeric: true,
      cell: (entry) => <strong>{formatMinor(entry.balanceAfterMinor)}</strong>,
    },
  ];

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          routeId={ownerMode ? 'my-statement' : 'shop-statement'}
          title={
            statement.data?.shop?.name ?? t(ownerMode ? 'statement.ownTitle' : 'statement.title')
          }
          description={t('statement.subtitle')}
          actions={
            <>
              <LinkButton to={ownerMode ? '/account' : `/shops/${shopId}/ledger`}>
                {t('actions.back')}
              </LinkButton>
              <Button variant="primary" onClick={() => window.print()}>
                {t('statement.print')}
              </Button>
            </>
          }
        />

        <form
          className="mb-6 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied({ from, to });
          }}
        >
          <Field label={t('statement.from')} className="min-w-44" hint={t('hints.dateFrom')}>
            <Input
              required
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label={t('statement.to')} className="min-w-44" hint={t('hints.dateTo')}>
            <Input
              required
              type="date"
              min={from}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          <Button type="submit">{t('statement.generate')}</Button>
        </form>
      </div>

      <Resource
        query={statement}
        loadingLabel={t('statement.loading')}
        errorMessageFallback={t('statement.couldNotLoad')}
      >
        {(data) => (
          <Card>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-text-muted">{t('common.appName')}</p>
                <h2 className="text-xl font-semibold text-text">{t('statement.title')}</h2>
                <p className="text-text-muted">
                  {data.shop?.reference} · {data.shop?.name}
                </p>
              </div>
              <p className="text-text-muted">
                {formatFinanceDate(data.from)} – {formatFinanceDate(data.to)}
              </p>
            </div>
            <div className="mb-4 flex flex-wrap gap-6">
              <span className="text-text-muted">
                {t('statement.openingBalance')}{' '}
                <strong className="tabular-nums text-text">
                  {formatMinor(data.openingBalanceMinor)}
                </strong>
              </span>
              <span className="text-text-muted">
                {t('statement.closingBalance')}{' '}
                <strong className="tabular-nums text-text">
                  {formatMinor(data.closingBalanceMinor)}
                </strong>
              </span>
            </div>
            {data.entries.length === 0 ? (
              <EmptyState title={t('statement.noEntries')} />
            ) : (
              <DataTable
                caption={t('statement.title')}
                columns={columns}
                rows={data.entries}
                rowKey={(entry) => entry._id}
              />
            )}
          </Card>
        )}
      </Resource>
    </>
  );
}
