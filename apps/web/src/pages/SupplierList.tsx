import { useState } from 'react';
import type { Supplier } from '@medsupply/shared-types';
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
  type Column,
} from '../components/ui';
import { usePagedCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate } from '../lib/finance';

/**
 * Who the goods come from.
 *
 * `Supplier`, `PurchaseOrder` and `GoodsReceipt` have existed since phase 6,
 * with integration tests, and appeared in **none** of the 51 navigation items.
 * The only way to add a supplier was to POST one by hand, which meant the
 * purchasing half of the regulatory trace could not be used by the people it
 * was built for.
 */

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

type LicenceState = 'none' | 'expired' | 'soon' | 'valid';

function licenceState(expiry?: string): LicenceState {
  if (!expiry) return 'none';
  const remaining = new Date(expiry).getTime() - Date.now();
  if (remaining <= 0) return 'expired';
  return remaining < NINETY_DAYS ? 'soon' : 'valid';
}

export function SupplierList() {
  const { t } = useLanguage();
  const [includeInactive, setIncludeInactive] = useState(false);

  const suppliers = usePagedCollection<Supplier>(
    ['suppliers', includeInactive],
    `/purchasing/suppliers${includeInactive ? '?includeInactive=true' : ''}`,
  );

  const columns: ReadonlyArray<Column<Supplier>> = [
    { key: 'reference', header: t('fields.reference'), cell: (row) => row.reference },
    { key: 'name', header: t('purchasing.supplierName'), cell: (row) => row.name },
    {
      key: 'contact',
      header: t('purchasing.contactName'),
      cell: (row) => row.contactName || '—',
    },
    { key: 'phone', header: t('fields.phone'), cell: (row) => row.primaryPhone },
    {
      key: 'licence',
      header: t('purchasing.licence'),
      cell: (row) => row.drugLicenceNumber || t('purchasing.noLicenceRecorded'),
    },
    {
      key: 'licenceExpiry',
      header: t('purchasing.licenceExpiry'),
      cell: (row) => {
        const state = licenceState(row.drugLicenceExpiryDate);
        if (state === 'none') return '—';
        const date = formatFinanceDate(row.drugLicenceExpiryDate!);
        /*
         * An expired supplier licence is worth seeing at a glance: buying from
         * a company whose licence has lapsed is the distributor's problem at
         * inspection, not only theirs. Words, not a colour alone — a colour
         * says nothing to a screen reader.
         */
        if (state === 'expired') {
          return (
            <span className="font-medium text-danger">
              {date} <span className="text-sm">({t('purchasing.licenceExpired')})</span>
            </span>
          );
        }
        if (state === 'soon') {
          return (
            <span className="font-medium text-warning">
              {date} <span className="text-sm">({t('purchasing.licenceSoon')})</span>
            </span>
          );
        }
        return date;
      },
    },
    {
      key: 'terms',
      header: t('purchasing.paymentTerms'),
      numeric: true,
      cell: (row) => row.paymentTermsDays,
    },
    {
      key: 'status',
      header: t('fields.status'),
      cell: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'}>
          {row.isActive ? t('purchasing.active') : t('purchasing.inactive')}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        routeId="suppliers"
        title={t('purchasing.suppliersTitle')}
        description={t('purchasing.suppliersSubtitle')}
        actions={
          <LinkButton variant="primary" to="/purchasing/suppliers/new">
            {t('purchasing.addSupplier')}
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t('purchasing.showInactive')} className="min-w-64">
          <Select
            value={includeInactive ? 'yes' : 'no'}
            onChange={(event) => setIncludeInactive(event.target.value === 'yes')}
          >
            <option value="no">{t('common.off')}</option>
            <option value="yes">{t('common.on')}</option>
          </Select>
        </Field>
      </div>

      <Resource
        query={suppliers}
        loadingLabel={t('purchasing.suppliersLoading')}
        errorMessageFallback={t('purchasing.suppliersCouldNotLoad')}
        empty={
          <EmptyState
            title={t('purchasing.suppliersNone')}
            description={t('purchasing.suppliersNoneBody')}
          />
        }
      >
        {(page) => (
          <>
            <DataTable
              caption={t('purchasing.suppliersTitle')}
              columns={columns}
              rows={page.items}
              rowKey={(row) => row._id}
              rowTest={(row) => row.reference}
            />
            <Pagination
              page={page.page}
              limit={page.limit}
              total={page.total}
              onPage={suppliers.setPage}
            />
          </>
        )}
      </Resource>
    </>
  );
}
