import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { Medicine, MedicineBatch } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import { canSeeStock } from '../lib/permissions';
import {
  Card,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  ProductImage,
  Resource,
  type Column,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatMinor } from '../lib/finance';

/**
 * Joins whichever parts of a description exist.
 *
 * The header used to interpolate `${genericName} · ${dosageForm} · ${packSize}`
 * directly, which was correct while every row was a drug. Those two fields are
 * now optional — a box of nappies has neither — and a template literal renders
 * a missing one as the word "undefined" on the page.
 */
const describe = (parts: (string | undefined)[], separator = ' · ') =>
  parts.filter(Boolean).join(separator);

/** A label and its value, so the detail lists on every page line up the same way. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

export function MedicineDetail() {
  const { id } = useParams();
  const { t } = useLanguage();
  const user = useAuthStore((state) => state.user);
  /*
   * The server's `stockReaders`, not "anybody who is not a shop owner". The
   * old predicate answered `true` for a sales rep, who has just been allowed
   * onto this page and whom `GET /inventory/batches` refuses — so the fix to
   * the navigation manifest and the fix here are one change, not two.
   */
  const showStock = canSeeStock(user?.role);

  const medicine = useApiResource<Medicine>(keys.medicines.one(id!), `/inventory/medicines/${id}`);
  const batches = useApiCollection<MedicineBatch>(
    keys.medicines.batches(id!),
    `/inventory/batches?medicineId=${id}`,
    { enabled: showStock },
  );

  const batchColumns: ReadonlyArray<Column<MedicineBatch>> = [
    // The batch *number* printed on the carton, never the database id: that is
    // what a storekeeper can read off the box in front of them.
    { key: 'batch', header: t('fields.batch'), cell: (batch) => batch.batchNumber },
    {
      key: 'expiry',
      header: t('fields.expiry'),
      cell: (batch) => formatFinanceDate(batch.expiryDate),
    },
    {
      key: 'available',
      header: t('catalogue.available'),
      numeric: true,
      cell: (batch) => batch.quantities.available,
    },
    {
      key: 'reserved',
      header: t('catalogue.reserved'),
      numeric: true,
      cell: (batch) => batch.quantities.reserved,
    },
    {
      key: 'location',
      header: t('catalogue.location'),
      cell: (batch) => batch.warehouseLocation,
    },
  ];

  return (
    <>
      <Resource
        query={medicine}
        loadingLabel={t('catalogue.loadingOne')}
        errorMessageFallback={t('catalogue.couldNotLoadOne')}
      >
        {(item) => (
          <>
            <PageHeader
              routeId="medicine-detail"
              title={describe([item.brandName, item.strength], ' ')}
              description={describe([item.genericName, item.dosageForm, item.packSize])}
              actions={<LinkButton to="/medicines">{t('catalogue.back')}</LinkButton>}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h2 className="mb-2 text-lg font-semibold text-text">{t('catalogue.about')}</h2>
                <ProductImage path={item.productImageUrl} className="mb-3 h-48" />
                <dl className="m-0">
                  <Detail label={t('common.reference')}>
                    {item.reference} · {item.sku}
                  </Detail>
                  {item.productType && (
                    <Detail label={t('catalogue.productType')}>
                      {t(`productType.${item.productType}`)}
                    </Detail>
                  )}
                  <Detail label={t('catalogue.manufacturer')}>{item.manufacturer}</Detail>
                  <Detail label={t('catalogue.category')}>{item.category}</Detail>
                  <Detail label={t('catalogue.classification')}>{item.classification}</Detail>
                  <Detail label={t('catalogue.coldChain')}>
                    {item.coldChain ? t('catalogue.yes') : t('catalogue.no')}
                  </Detail>
                  <Detail label={t('catalogue.orderLimits')}>
                    {item.minimumOrderQuantity}–
                    {item.maximumOrderQuantity ?? t('catalogue.noMaximum')} {item.unit}
                  </Detail>
                  <Detail label={t('catalogue.listPrice')}>
                    {formatMinor(item.defaultSellingPriceMinor)}
                  </Detail>
                  <Detail label={t('catalogue.availability')}>
                    {(item.totalAvailable ?? 0) > 0
                      ? t('catalogue.available')
                      : t('catalogue.outOfStock')}
                  </Detail>
                </dl>
                {item.description && <p className="mt-3 text-text-muted">{item.description}</p>}
              </Card>

              {showStock && (
                <Card>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-text">{t('catalogue.batches')}</h2>
                    <LinkButton size="sm" to="/inventory">
                      {t('catalogue.manageStock')}
                    </LinkButton>
                  </div>
                  <Resource
                    query={batches}
                    loadingLabel={t('catalogue.batches')}
                    errorMessageFallback={t('lists.couldNotLoad')}
                    empty={<EmptyState title={t('catalogue.noBatches')} />}
                  >
                    {(page) => (
                      <DataTable
                        caption={t('catalogue.batches')}
                        columns={batchColumns}
                        rows={page.items}
                        rowKey={(batch) => batch._id}
                        rowTest={(batch) => batch.batchNumber}
                      />
                    )}
                  </Resource>
                </Card>
              )}
            </div>
          </>
        )}
      </Resource>
    </>
  );
}
