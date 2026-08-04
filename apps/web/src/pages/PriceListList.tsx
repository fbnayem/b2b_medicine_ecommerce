import { Link } from 'react-router-dom';
import type { PriceListRecord } from '@medsupply/shared-types';
import { formatDate } from '@medsupply/utilities';
import {
  Badge,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  Resource,
  type Column,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';

/**
 * What each group of customers pays.
 *
 * The model, the resolver and the precedence were built with the commercial
 * phase and had no way in: a price list could only be created by writing the
 * document directly, and the middle tier of the precedence — shop override →
 * **price list** → medicine default — was reachable only through whichever list
 * happened to be flagged the default.
 */
export function PriceListList() {
  const { t } = useLanguage();
  const lists = useApiCollection<PriceListRecord>(['price-lists'], '/pricing/price-lists');

  const columns: ReadonlyArray<Column<PriceListRecord>> = [
    {
      key: 'name',
      header: t('priceLists.name'),
      cell: (row) => (
        <span className="font-medium">
          <Link className="text-brand underline" to={`/pricing/price-lists/${row._id}`}>
            {row.name}
          </Link>
          {row.isDefault && (
            <Badge tone="brand" className="ms-2">
              {t('priceLists.default')}
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'reference', header: t('fields.reference'), cell: (row) => row.reference },
    {
      key: 'lines',
      header: t('priceLists.pricedItems'),
      numeric: true,
      cell: (row) => row.lines.length,
    },
    {
      /*
       * The figure an administrator wants before changing a price: how many
       * customers this list is actually charging. Without it a live list and an
       * abandoned draft look identical.
       */
      key: 'shops',
      header: t('priceLists.customers'),
      numeric: true,
      cell: (row) => row.shopCount ?? 0,
    },
    {
      key: 'window',
      header: t('priceLists.inForce'),
      cell: (row) =>
        row.validFrom || row.validTo
          ? `${row.validFrom ? formatDate(row.validFrom) : '—'} → ${
              row.validTo ? formatDate(row.validTo) : t('priceLists.openEnded')
            }`
          : t('priceLists.openEnded'),
    },
    {
      key: 'status',
      header: t('fields.status'),
      cell: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'}>
          {row.isActive ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
  ];

  return (
    <main>
      <PageHeader
        routeId="price-lists"
        title={t('priceLists.title')}
        description={t('priceLists.subtitle')}
        actions={
          <LinkButton variant="primary" to="/pricing/price-lists/new">
            {t('priceLists.add')}
          </LinkButton>
        }
      />

      <Resource
        query={lists}
        loadingLabel={t('priceLists.loading')}
        errorMessageFallback={t('priceLists.couldNotLoad')}
        empty={<EmptyState title={t('priceLists.none')} description={t('priceLists.noneBody')} />}
      >
        {(page) => (
          <DataTable
            caption={t('priceLists.title')}
            columns={columns}
            rows={page.items}
            rowKey={(row) => row._id}
            rowTest={(row) => row.reference}
          />
        )}
      </Resource>
    </main>
  );
}
