import type { Warehouse } from '@medsupply/shared-types';
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
 * Where stock is held.
 *
 * `warehouseLocation` on a batch is free text — an aisle, a rack, whatever
 * somebody typed at goods receipt — and there was no entity behind it, so
 * nothing could say what a second godown was holding. This is the foundation
 * rather than the feature: everything that names no warehouse belongs to the
 * default, which is why a one-godown operation sees its whole stock here
 * without anything having been backfilled.
 */
export function WarehouseList() {
  const { t } = useLanguage();
  const warehouses = useApiCollection<Warehouse>(['warehouses'], '/inventory/warehouses');

  const columns: ReadonlyArray<Column<Warehouse>> = [
    {
      key: 'code',
      header: t('warehouses.code'),
      cell: (row) => (
        <span className="font-medium text-text">
          {row.code}
          {row.isDefault && (
            <Badge tone="brand" className="ms-2">
              {t('warehouses.isDefault')}
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'name', header: t('warehouses.name'), cell: (row) => row.name },
    {
      key: 'address',
      header: t('fields.address'),
      cell: (row) => (row.address?.line1 ? `${row.address.line1}, ${row.address.city ?? ''}` : '—'),
    },
    { key: 'phone', header: t('warehouses.contactPhone'), cell: (row) => row.contactPhone || '—' },
    {
      key: 'batches',
      header: t('warehouses.batches'),
      numeric: true,
      cell: (row) => row.stock.batches,
    },
    {
      key: 'onHand',
      header: t('warehouses.onHand'),
      numeric: true,
      cell: (row) => row.stock.onHand,
    },
    {
      key: 'available',
      header: t('warehouses.available'),
      numeric: true,
      cell: (row) => row.stock.available,
    },
  ];

  return (
    <main>
      <PageHeader
        routeId="warehouses"
        title={t('warehouses.title')}
        description={t('warehouses.subtitle')}
        actions={
          <LinkButton variant="primary" to="/inventory/warehouses/new">
            {t('warehouses.add')}
          </LinkButton>
        }
      />

      <Resource
        query={warehouses}
        loadingLabel={t('warehouses.loading')}
        errorMessageFallback={t('warehouses.couldNotLoad')}
        empty={<EmptyState title={t('warehouses.none')} description={t('warehouses.noneBody')} />}
      >
        {(page) => (
          <DataTable
            caption={t('warehouses.title')}
            columns={columns}
            rows={page.items}
            rowKey={(row) => row._id}
            rowTest={(row) => row.code}
          />
        )}
      </Resource>
    </main>
  );
}
