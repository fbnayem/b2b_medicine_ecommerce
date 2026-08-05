import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TripStatus, UserRole } from '@medsupply/shared-types';
import type { Trip } from '@medsupply/shared-types';
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
  type BadgeTone,
  type Column,
} from '../components/ui';
import { usePagedCollection } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { useAuthStore } from '../store/useAuth';
import { formatFinanceDate } from '../lib/finance';

const TONE: Record<TripStatus, BadgeTone> = {
  [TripStatus.PLANNED]: 'info',
  [TripStatus.IN_PROGRESS]: 'brand',
  [TripStatus.COMPLETED]: 'success',
  [TripStatus.CANCELLED]: 'neutral',
};

export function TripList() {
  const { t } = useLanguage();
  const { user } = useAuthStore();
  const [status, setStatus] = useState('');

  /*
   * One page for both audiences. The server scopes a rider to their own rounds
   * — a filter a client applies is a filter a client can drop — so all that
   * changes here is the heading, which should say whose round it is.
   */
  const isRider = user?.role === UserRole.DELIVERY_PERSON;

  const trips = usePagedCollection<Trip>(
    keys.trips.list(status),
    `/trips${status ? `?status=${status}` : ''}`,
  );

  const columns: ReadonlyArray<Column<Trip>> = [
    {
      key: 'reference',
      header: t('fields.reference'),
      cell: (trip) => (
        <Link className="font-medium text-brand underline" to={`/deliveries/trips/${trip._id}`}>
          {trip.reference}
        </Link>
      ),
    },
    {
      key: 'day',
      header: t('trips.day'),
      cell: (trip) => formatFinanceDate(trip.tripDate),
    },
    {
      key: 'rider',
      header: t('trips.rider'),
      cell: (trip) =>
        typeof trip.deliveryPersonId === 'string'
          ? '—'
          : `${trip.deliveryPersonId.firstName} ${trip.deliveryPersonId.lastName}`,
    },
    {
      key: 'stops',
      header: t('trips.stops'),
      numeric: true,
      cell: (trip) => trip.stops.length,
    },
    {
      key: 'vehicle',
      header: t('trips.vehicle'),
      cell: (trip) => trip.vehicleReference || '—',
    },
    {
      key: 'status',
      header: t('fields.status'),
      cell: (trip) => (
        <Badge tone={TONE[trip.status] ?? 'neutral'}>{t(`tripStatus.${trip.status}`)}</Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        routeId="trips"
        title={isRider ? t('trips.myTitle') : t('trips.title')}
        description={isRider ? t('trips.mySubtitle') : t('trips.subtitle')}
        actions={
          isRider ? undefined : (
            <LinkButton variant="primary" to="/deliveries/trips/new">
              {t('trips.plan')}
            </LinkButton>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t('fields.status')} className="min-w-56">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t('purchasing.allStatuses')}</option>
            {Object.values(TripStatus).map((value) => (
              <option key={value} value={value}>
                {t(`tripStatus.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Resource
        query={trips}
        loadingLabel={t('trips.loading')}
        errorMessageFallback={t('trips.couldNotLoad')}
        empty={<EmptyState title={t('trips.none')} description={t('trips.noneBody')} />}
      >
        {(page) => (
          <>
            <DataTable
              caption={t('trips.title')}
              columns={columns}
              rows={page.items}
              rowKey={(trip) => trip._id}
              rowTest={(trip) => trip.reference}
            />
            <Pagination
              page={page.page}
              limit={page.limit}
              total={page.total}
              onPage={trips.setPage}
            />
          </>
        )}
      </Resource>
    </>
  );
}
