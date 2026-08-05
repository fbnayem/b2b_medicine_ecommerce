import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StocktakeStatus } from '@medsupply/shared-types';
import type { StocktakeListRow } from '@medsupply/shared-types';
import {
  Badge,
  DataTable,
  EmptyState,
  Field,
  LinkButton,
  PageHeader,
  Pagination,
  Resource,
  Select,
  type BadgeTone,
  type Column,
} from '../components/ui';
import { usePagedCollection } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate } from '../lib/finance';

const TONE: Record<StocktakeStatus, BadgeTone> = {
  [StocktakeStatus.COUNTING]: 'info',
  [StocktakeStatus.REVIEW]: 'warning',
  [StocktakeStatus.POSTED]: 'success',
  [StocktakeStatus.ABANDONED]: 'neutral',
};

export function StocktakeList() {
  const { t } = useLanguage();
  const [status, setStatus] = useState('');

  const counts = usePagedCollection<StocktakeListRow>(
    keys.stocktakes.list(status),
    `/stocktakes${status ? `?status=${status}` : ''}`,
  );

  const columns: ReadonlyArray<Column<StocktakeListRow>> = [
    {
      key: 'reference',
      header: t('fields.reference'),
      cell: (row) => (
        <Link className="font-medium text-brand underline" to={`/inventory/stocktakes/${row._id}`}>
          {row.reference}
        </Link>
      ),
    },
    {
      key: 'scope',
      header: t('stocktake.location'),
      cell: (row) => row.scope?.warehouseLocation || '—',
    },
    {
      key: 'progress',
      header: t('stocktake.progress'),
      numeric: true,
      cell: (row) =>
        t('stocktake.ofLines', {
          counted: row.summary.linesCounted,
          total: row.summary.linesTotal,
        }),
    },
    {
      key: 'uncounted',
      header: t('stocktake.uncounted'),
      numeric: true,
      cell: (row) =>
        row.summary.linesUncounted > 0 ? (
          <span className="text-warning">{row.summary.linesUncounted}</span>
        ) : (
          0
        ),
    },
    {
      key: 'short',
      header: t('stocktake.short'),
      numeric: true,
      cell: (row) =>
        row.summary.unitsShort > 0 ? (
          <span className="text-danger">{row.summary.unitsShort}</span>
        ) : (
          0
        ),
    },
    {
      key: 'over',
      header: t('stocktake.over'),
      numeric: true,
      cell: (row) => row.summary.unitsOver,
    },
    {
      key: 'opened',
      header: t('stocktake.openedOn'),
      cell: (row) => formatFinanceDate(row.openedAt),
    },
    {
      key: 'status',
      header: t('fields.status'),
      cell: (row) => (
        <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`stocktakeStatus.${row.status}`)}</Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        routeId="stocktakes"
        title={t('stocktake.title')}
        description={t('stocktake.subtitle')}
        actions={
          <LinkButton variant="primary" to="/inventory/stocktakes/new">
            {t('stocktake.open')}
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t('fields.status')} className="min-w-56">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t('purchasing.allStatuses')}</option>
            {Object.values(StocktakeStatus).map((value) => (
              <option key={value} value={value}>
                {t(`stocktakeStatus.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Resource
        query={counts}
        loadingLabel={t('stocktake.loading')}
        errorMessageFallback={t('stocktake.couldNotLoad')}
        empty={<EmptyState title={t('stocktake.none')} description={t('stocktake.noneBody')} />}
      >
        {(page) => (
          <>
            <DataTable
              caption={t('stocktake.title')}
              columns={columns}
              rows={page.items}
              rowKey={(row) => row._id}
              rowTest={(row) => row.reference}
            />
            <Pagination
              page={page.page}
              limit={page.limit}
              total={page.total}
              onPage={counts.setPage}
            />
          </>
        )}
      </Resource>
    </>
  );
}
