import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { UserRole } from '@medsupply/shared-types';
import type { Medicine, MedicineBatch } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import {
  Card,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  Resource,
  type Column,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatMinor } from '../lib/finance';
import { mediaUrl } from '../api/config';

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
  const canSeeStock = user?.role !== UserRole.SHOP_OWNER;

  const medicine = useApiResource<Medicine>(['medicine', id], `/inventory/medicines/${id}`);
  const batches = useApiCollection<MedicineBatch>(
    ['medicine-batches', id],
    `/inventory/batches?medicineId=${id}`,
    { enabled: canSeeStock },
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
    <main>
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
                {mediaUrl(item.productImageUrl) && (
                  // Empty alt: the packaging is here to be recognised, and every
                  // word a screen reader could get from it is already in the
                  // heading above and the list below.
                  <img
                    src={mediaUrl(item.productImageUrl)}
                    alt=""
                    className="mb-3 h-48 w-full rounded-md bg-surface-sunken object-contain"
                  />
                )}
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
                  <Detail label={t('catalogue.yourPrice')}>
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

              {canSeeStock && (
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
    </main>
  );
}
