import { Link } from 'react-router-dom';
import type { SchemeRecord } from '@medsupply/shared-types';
import { formatDate } from '@medsupply/utilities';
import {
  Badge,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  Pagination,
  Resource,
  type Column,
} from '../components/ui';
import { usePagedCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';

/**
 * Free goods: "buy ten, get one".
 *
 * The standard promotional instrument in this trade. The resolver has been in
 * the order path since the schemes landed and nothing could create a scheme for
 * it to find, so a distributor either could not run the promotion their
 * supplier was running or ran it by hand and the books did not show it.
 */
export function SchemeList() {
  const { t } = useLanguage();
  const schemes = usePagedCollection<SchemeRecord>(['schemes'], '/pricing/schemes');

  const columns: ReadonlyArray<Column<SchemeRecord>> = [
    {
      key: 'name',
      header: t('schemes.name'),
      cell: (row) => (
        <Link className="font-medium text-brand underline" to={`/pricing/schemes/${row._id}`}>
          {row.name}
        </Link>
      ),
    },
    {
      key: 'medicine',
      header: t('schemes.medicine'),
      cell: (row) => row.medicineBrandName ?? row.medicineSku ?? '—',
    },
    {
      key: 'terms',
      header: t('schemes.terms'),
      cell: (row) => t('schemes.buyGet', { buy: row.buyQuantity, free: row.freeQuantity }),
    },
    {
      key: 'audience',
      header: t('schemes.audience'),
      cell: (row) =>
        row.shopIds.length === 0
          ? t('schemes.everyCustomer')
          : t('schemes.namedCustomers', { count: row.shopIds.length }),
    },
    {
      key: 'window',
      header: t('schemes.inForce'),
      cell: (row) =>
        row.validFrom || row.validTo
          ? `${row.validFrom ? formatDate(row.validFrom) : '—'} → ${
              row.validTo ? formatDate(row.validTo) : t('schemes.openEnded')
            }`
          : t('schemes.openEnded'),
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
    <>
      <PageHeader
        routeId="schemes"
        title={t('schemes.title')}
        description={t('schemes.subtitle')}
        actions={
          <LinkButton variant="primary" to="/pricing/schemes/new">
            {t('schemes.add')}
          </LinkButton>
        }
      />

      <Resource
        query={schemes}
        loadingLabel={t('schemes.loading')}
        errorMessageFallback={t('schemes.couldNotLoad')}
        empty={<EmptyState title={t('schemes.none')} description={t('schemes.noneBody')} />}
      >
        {(page) => (
          <>
            <DataTable
              caption={t('schemes.title')}
              columns={columns}
              rows={page.items}
              rowKey={(row) => row._id}
              rowTest={(row) => row.reference}
            />
            <Pagination
              page={page.page}
              limit={page.limit}
              total={page.total}
              onPage={schemes.setPage}
            />
          </>
        )}
      </Resource>
    </>
  );
}
