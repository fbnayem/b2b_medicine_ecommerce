import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RealtimeEvent, ReturnReason, UserRole, type ReturnStatus } from '@medsupply/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/useAuth';
import { useRealtimeEvent } from '../realtime/useRealtime';
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Resource,
  Select,
  StatusPill,
  type Column,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useSavedFilter } from '../lib/savedFilter';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatMinor } from '../lib/finance';
import { RETURN_STATUS_FILTER_ORDER } from './returnLabels';

export interface ReturnRow {
  _id: string;
  reference: string;
  status: ReturnStatus;
  primaryReason: ReturnReason;
  requestedAt: string;
  requestedTotalMinor: number;
  approvedTotalMinor: number;
  creditNoteReference?: string;
  shopId?: { _id: string; reference: string; name?: string } | string;
  invoiceId?: { _id: string; reference: string; name?: string } | string;
}

const named = (value: ReturnRow['shopId']) =>
  typeof value === 'object' && value ? value : undefined;

export function ReturnList() {
  const { t } = useLanguage();
  const role = useAuthStore((state) => state.user?.role);
  const queryClient = useQueryClient();
  const [status, setStatus] = useSavedFilter('returns', '');
  const [reference, setReference] = useState('');
  const [applied, setApplied] = useState({ status: '', q: '' });
  const [page, setPage] = useState(1);

  const isOwner = role === UserRole.SHOP_OWNER;

  const search = new URLSearchParams({ page: String(page), limit: '20' });
  if (applied.status) search.set('status', applied.status);
  if (applied.q) search.set('q', applied.q);
  const returns = useApiCollection<ReturnRow>(
    ['returns', applied.status, applied.q, page],
    `/returns?${search.toString()}`,
  );

  // A colleague approving or receiving a return should not require a refresh.
  useRealtimeEvent(RealtimeEvent.RETURN_UPDATED, () => {
    void queryClient.invalidateQueries({ queryKey: ['returns'] });
  });

  const columns: ReadonlyArray<Column<ReturnRow>> = [
    {
      key: 'reference',
      header: t('returns.columnReturn'),
      cell: (row) => (
        <div>
          <Link className="font-medium text-brand underline" to={`/returns/${row._id}`}>
            {row.reference}
          </Link>
          {row.creditNoteReference && (
            <p className="text-sm text-text-muted">{row.creditNoteReference}</p>
          )}
        </div>
      ),
    },
    ...(isOwner
      ? []
      : [
          {
            key: 'shop',
            header: t('fields.shop'),
            cell: (row: ReturnRow) => (
              <div>
                <p className="text-text">{named(row.shopId)?.name ?? '—'}</p>
                <p className="text-sm text-text-muted">{named(row.shopId)?.reference}</p>
              </div>
            ),
          },
        ]),
    {
      key: 'invoice',
      header: t('returns.columnInvoice'),
      cell: (row) => named(row.invoiceId)?.reference ?? '—',
    },
    {
      key: 'requested',
      header: t('returns.columnRequested'),
      cell: (row) => formatFinanceDate(row.requestedAt),
    },
    {
      key: 'reason',
      header: t('returns.columnReason'),
      cell: (row) => t(`returnReason.${row.primaryReason}`),
    },
    {
      key: 'status',
      header: t('fields.status'),
      cell: (row) => <StatusPill kind="return" status={row.status} />,
    },
    {
      key: 'value',
      header: t('returns.columnValue'),
      numeric: true,
      cell: (row) =>
        formatMinor(row.approvedTotalMinor > 0 ? row.approvedTotalMinor : row.requestedTotalMinor),
    },
  ];

  const filtered = Boolean(applied.status || applied.q);

  return (
    <main>
      <PageHeader
        routeId="returns"
        title={isOwner ? t('returns.titleOwner') : t('returns.titleStaff')}
        description={isOwner ? t('returns.subtitleOwner') : t('returns.subtitleStaff')}
        actions={
          isOwner && (
            <LinkButton variant="primary" to="/returns/new">
              {t('returns.request')}
            </LinkButton>
          )
        }
      />

      <form
        className="mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setApplied({ status, q: reference.trim() });
        }}
      >
        <Field label={t('fields.status')} className="min-w-48">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t('returns.allStatuses')}</option>
            {RETURN_STATUS_FILTER_ORDER.map((value) => (
              <option key={value} value={value}>
                {t(`returnStatus.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('fields.reference')} className="min-w-56">
          <Input
            value={reference}
            placeholder={t('returns.referenceHint')}
            onChange={(event) => setReference(event.target.value)}
          />
        </Field>
        <Button type="submit">{t('actions.apply')}</Button>
      </form>

      <Resource
        query={returns}
        loadingLabel={t('returns.loading')}
        errorMessageFallback={t('returns.couldNotLoad')}
        empty={
          <EmptyState
            title={filtered ? t('returns.noneFiltered') : t('returns.none')}
            description={filtered ? t('lists.noResultsBody') : t('returns.noneBody')}
          />
        }
      >
        {(result) => (
          <>
            <DataTable
              caption={isOwner ? t('returns.titleOwner') : t('returns.titleStaff')}
              columns={columns}
              rows={result.items}
              rowKey={(row) => row._id}
              rowTest={(row) => row.reference}
            />
            <Pagination
              page={result.page}
              limit={result.limit}
              total={result.total}
              onPage={setPage}
            />
          </>
        )}
      </Resource>
    </main>
  );
}
