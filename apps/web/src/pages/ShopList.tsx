import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShopStatus } from '@medsupply/shared-types';
import type { Shop } from '@medsupply/shared-types';
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
import { usePagedCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatMinor } from '../lib/finance';

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

function licenceExpiringSoon(expiryDate?: Date | string): boolean {
  if (!expiryDate) return false;
  const remaining = new Date(expiryDate).getTime() - Date.now();
  return remaining > 0 && remaining < NINETY_DAYS;
}

export function ShopList() {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ search: '', status: '' });

  const params = new URLSearchParams();
  if (applied.search) params.set('search', applied.search);
  if (applied.status) params.set('status', applied.status);
  const shops = usePagedCollection<Shop>(
    ['shops', applied.search, applied.status],
    `/shops${params.size ? `?${params.toString()}` : ''}`,
  );

  const columns: ReadonlyArray<Column<Shop>> = [
    {
      key: 'reference',
      header: t('fields.reference'),
      cell: (shop) => (
        <Link className="font-medium text-brand underline" to={`/shops/${shop._id}`}>
          {shop.reference}
        </Link>
      ),
    },
    { key: 'name', header: t('shops.name'), cell: (shop) => shop.name },
    { key: 'phone', header: t('fields.phone'), cell: (shop) => shop.primaryPhone },
    { key: 'territory', header: t('shops.territory'), cell: (shop) => shop.territory || '—' },
    {
      key: 'credit',
      header: t('shops.creditLimit'),
      numeric: true,
      cell: (shop) => formatMinor(shop.creditLimit),
    },
    {
      key: 'licence',
      header: t('shops.licenceExpiry'),
      cell: (shop) => {
        if (!shop.drugLicenceExpiryDate) return '—';
        const soon = licenceExpiringSoon(shop.drugLicenceExpiryDate);
        return (
          <span className={soon ? 'font-medium text-warning' : undefined}>
            {formatFinanceDate(shop.drugLicenceExpiryDate)}
            {/* Words, not an emoji: a warning symbol alone says nothing to a
                screen reader and nothing to somebody scanning quickly. */}
            {soon && <span className="ms-1 text-sm">({t('shops.licenceSoon')})</span>}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('fields.status'),
      cell: (shop) => <StatusPill kind="shop" status={shop.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        routeId="shops"
        title={t('shops.title')}
        description={t('shops.subtitle')}
        actions={
          <LinkButton variant="primary" to="/shops/new">
            {t('shops.add')}
          </LinkButton>
        }
      />

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ search: search.trim(), status });
        }}
      >
        <Field label={t('shops.searchLabel')} className="min-w-64 flex-1">
          <Input
            value={search}
            placeholder={t('shops.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field label={t('shops.statusFilter')} className="min-w-48">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t('shops.anyStatus')}</option>
            {Object.values(ShopStatus).map((value) => (
              <option key={value} value={value}>
                {t(`shopStatus.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit">{t('actions.apply')}</Button>
      </form>

      <Resource
        query={shops}
        loadingLabel={t('shops.loading')}
        errorMessageFallback={t('shops.couldNotLoad')}
        empty={<EmptyState title={t('shops.none')} description={t('shops.noneBody')} />}
      >
        {(page) => (
          <>
            <DataTable
              caption={t('shops.title')}
              columns={columns}
              rows={page.items}
              rowKey={(shop) => shop._id}
              rowTest={(shop) => shop.reference}
            />
            <Pagination
              page={page.page}
              limit={page.limit}
              total={page.total}
              onPage={shops.setPage}
            />
          </>
        )}
      </Resource>
    </>
  );
}
