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
import { keys } from '../lib/queryKeys';
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
  /*
   * The queue that makes self-registration safe to operate.
   *
   * A pharmacy can now create its own account, and it arrives with a credit
   * limit of zero, no payment terms, no discount and no price list — so it can
   * trade prepaid and its first credit order is refused at approval. That is
   * the right answer only if somebody can *find* these shops; without this
   * filter a manager meets one for the first time as a refused order in the
   * approval queue, with no context and a customer waiting.
   *
   * It is a burn-down, not a label: setting a credit limit or payment terms
   * takes the shop off the list. The list shrinking is the work being done.
   */
  const [awaitingTerms, setAwaitingTerms] = useState(false);
  const [applied, setApplied] = useState({ search: '', status: '', awaitingTerms: false });

  const params = new URLSearchParams();
  if (applied.search) params.set('search', applied.search);
  if (applied.status) params.set('status', applied.status);
  if (applied.awaitingTerms) params.set('awaitingTerms', 'true');
  const shops = usePagedCollection<Shop>(
    keys.shops.list(applied),
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
    {
      key: 'name',
      header: t('shops.name'),
      cell: (shop) => (
        <div>
          <p className="text-text">{shop.name}</p>
          {/*
            Visible in the unfiltered list too, not only when the filter is on.
            "This customer set their own terms up, which is to say nobody did"
            is a fact worth meeting before an order arrives, and a row that
            looks like every other row does not carry it.
          */}
          {shop.selfRegisteredAt && shop.creditLimit === 0 && (
            <p className="text-sm text-text-muted">
              {t('shops.selfRegisteredOn', {
                date: formatFinanceDate(shop.selfRegisteredAt),
              })}
            </p>
          )}
        </div>
      ),
    },
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
          setApplied({ search: search.trim(), status, awaitingTerms });
        }}
      >
        <Field
          label={t('shops.searchLabel')}
          className="min-w-64 flex-1"
          hint={t('hints.searchShops')}
        >
          <Input
            value={search}
            placeholder={t('shops.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field label={t('shops.statusFilter')} className="min-w-48" hint={t('hints.statusFilter')}>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t('shops.anyStatus')}</option>
            {Object.values(ShopStatus).map((value) => (
              <option key={value} value={value}>
                {t(`shopStatus.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('shops.awaitingTerms')}
          className="min-w-56"
          hint={t('hints.awaitingTerms')}
        >
          <label className="flex min-h-11 items-center gap-2 text-text">
            <input
              type="checkbox"
              checked={awaitingTerms}
              onChange={(event) => setAwaitingTerms(event.target.checked)}
            />
            {t('shops.awaitingTermsOnly')}
          </label>
        </Field>
        <Button type="submit">{t('actions.apply')}</Button>
      </form>

      {applied.awaitingTerms && (
        // Said out loud, because a filtered list that looks like the whole list
        // is how somebody concludes the business has six customers.
        <p className="mb-4 text-text-muted">{t('shops.awaitingTermsBody')}</p>
      )}

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
