import { useState } from 'react';
import { toDateInputValue } from '@medsupply/utilities';
import type {
  ControlledByShopRow,
  ControlledRegister as Register,
  ControlledRegisterRow,
} from '@medsupply/shared-types';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Resource,
  toast,
  type Column,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';

/**
 * The movement return for prescription medicines.
 *
 * `MedicineClassification` has been stored on every medicine since the
 * catalogue phase and read by nothing at all; phase 6 built the register and
 * gave it no screen. This is the document an inspector asks for.
 *
 * The column that matters is the last one. A register that only adds up its own
 * movements can never disagree with itself, which makes it useless as a
 * control — so the service compares the arithmetic against what the batches
 * actually hold, and anything other than zero is a question somebody answers.
 */

/** Thirty days back, in the tenant's zone rather than UTC. */
function defaultRange() {
  const today = toDateInputValue(new Date());
  const from = toDateInputValue(new Date(Date.parse(`${today}T12:00:00.000Z`) - 29 * 86_400_000));
  return { from, to: today };
}

export function ControlledRegister() {
  const { t } = useLanguage();
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [applied, setApplied] = useState(initial);

  const register = useApiResource<Register>(
    ['controlled-register', applied.from, applied.to],
    `/purchasing/controlled-register?from=${applied.from}&to=${applied.to}`,
  );

  const columns: ReadonlyArray<Column<ControlledRegisterRow>> = [
    {
      key: 'medicine',
      header: t('fields.medicine'),
      cell: (row) => (
        <div>
          <p className="font-medium text-text">{row.brandName}</p>
          <p className="text-sm text-text-muted">
            {row.genericName} {row.strength}
          </p>
        </div>
      ),
    },
    {
      key: 'opening',
      header: t('purchasing.opening'),
      numeric: true,
      cell: (row) => row.openingQuantity,
    },
    {
      key: 'received',
      header: t('purchasing.received'),
      numeric: true,
      cell: (row) => row.receivedQuantity,
    },
    {
      key: 'despatched',
      header: t('purchasing.despatched'),
      numeric: true,
      cell: (row) => row.despatchedQuantity,
    },
    {
      key: 'returned',
      header: t('purchasing.returned'),
      numeric: true,
      cell: (row) => row.returnedQuantity,
    },
    {
      key: 'writtenOff',
      header: t('purchasing.writtenOff'),
      numeric: true,
      cell: (row) => row.writtenOffQuantity,
    },
    {
      key: 'closing',
      header: t('purchasing.closing'),
      numeric: true,
      cell: (row) => row.closingQuantity,
    },
    {
      key: 'variance',
      header: t('purchasing.variance'),
      numeric: true,
      cell: (row) =>
        row.varianceQuantity === 0 ? (
          0
        ) : (
          <span className="font-medium text-danger">
            {row.varianceQuantity > 0 ? '+' : ''}
            {row.varianceQuantity}
          </span>
        ),
    },
  ];

  const shopColumns: ReadonlyArray<Column<ControlledByShopRow>> = [
    {
      key: 'shop',
      header: t('fields.shop'),
      cell: (row) => row.shopSnapshot?.name ?? row.shopSnapshot?.reference ?? '—',
    },
    {
      key: 'medicine',
      header: t('fields.medicine'),
      cell: (row) => (row.medicine ? `${row.medicine.brandName} ${row.medicine.strength}` : '—'),
    },
    {
      key: 'quantity',
      header: t('purchasing.quantitySent'),
      numeric: true,
      cell: (row) => row.quantity,
    },
    {
      key: 'invoices',
      header: t('purchasing.invoices'),
      cell: (row) => row.invoices.join(', '),
    },
  ];

  return (
    <main>
      <PageHeader
        routeId="controlled-register"
        title={t('purchasing.registerTitle')}
        description={t('purchasing.registerSubtitle')}
      />

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          // Checked here as well as on the server, so an inverted range is
          // refused before it costs a round trip and a red box.
          if (from > to) {
            toast.error(t('purchasing.badRange'));
            return;
          }
          setApplied({ from, to });
        }}
      >
        <Field label={t('purchasing.from')} className="min-w-44">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label={t('purchasing.to')} className="min-w-44">
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
        <Button type="submit">{t('purchasing.apply')}</Button>
      </form>

      <Resource
        query={register}
        loadingLabel={t('purchasing.registerLoading')}
        errorMessageFallback={t('purchasing.registerCouldNotLoad')}
        isEmpty={(data) => data.rows.length === 0}
        empty={
          <EmptyState
            title={t('purchasing.registerNone')}
            description={t('purchasing.registerNoneBody')}
          />
        }
      >
        {(data) => (
          <>
            <Card className="mb-4">
              <DataTable
                caption={t('purchasing.registerTitle')}
                columns={columns}
                rows={data.rows}
                rowKey={(row) => row.medicineId}
                rowTest={(row) => row.reference}
              />
              <p className="mt-2 text-sm text-text-muted">{t('purchasing.varianceHint')}</p>
            </Card>

            <Card>
              <h2 className="mb-2 text-lg font-semibold text-text">
                {t('purchasing.byShopTitle')}
              </h2>
              {data.byShop.length === 0 ? (
                <EmptyState title={t('purchasing.byShopNone')} />
              ) : (
                <DataTable
                  caption={t('purchasing.byShopTitle')}
                  columns={shopColumns}
                  rows={data.byShop}
                  rowKey={(row) => `${row._id.shopId}-${row._id.medicineId}`}
                />
              )}
            </Card>
          </>
        )}
      </Resource>
    </main>
  );
}
