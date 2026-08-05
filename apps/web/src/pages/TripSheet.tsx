import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TripStatus, UserRole } from '@medsupply/shared-types';
import type { Trip, TripStop } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Resource,
  StatusPill,
  requireReason,
  toast,
  useAsk,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { useAuthStore } from '../store/useAuth';
import { entityReference, formatFinanceDate } from '../lib/finance';

/**
 * One round: the stops in order, and what has become of each.
 *
 * The stop carries no delivery state of its own — the server reads it live —
 * so this cannot drift from what the rider's app is showing. That was the
 * choice worth making: a second answer to "was this delivered" is the
 * disagreement that matters most on a delivery.
 */
export function TripSheet() {
  const { id } = useParams();
  const { t, language } = useLanguage();
  const { user } = useAuthStore();
  const ask = useAsk();
  const queryClient = useQueryClient();

  const query = useApiResource<Trip>(['trip', id], `/trips/${id}`);
  const [order, setOrder] = useState<string[] | null>(null);
  const [busy, setBusy] = useState('');

  // Reordering edits a local copy; until it is saved the server's order stands.
  useEffect(() => {
    setOrder(null);
  }, [query.data?.version]);

  const reload = () => queryClient.invalidateQueries({ queryKey: ['trip', id] });
  const isRider = user?.role === UserRole.DELIVERY_PERSON;

  function stopsInOrder(trip: Trip): TripStop[] {
    if (!order) return trip.stops;
    const byId = new Map(trip.stops.map((stop) => [stop.delivery?._id ?? stop._id, stop]));
    return order.map((key) => byId.get(key)!).filter(Boolean);
  }

  function move(trip: Trip, index: number, by: number) {
    const current = stopsInOrder(trip).map((stop) => stop.delivery?._id ?? stop._id);
    const target = index + by;
    if (target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target]!, current[index]!];
    setOrder(current);
  }

  async function saveOrder(trip: Trip) {
    if (!order) return;
    setBusy('sequence');
    try {
      await apiClient.post(`/trips/${trip._id}/sequence`, {
        version: trip.version,
        deliveryIds: order,
      });
      toast.success(t('trips.orderSaved'));
      setOrder(null);
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('trips.orderFailed')));
    } finally {
      setBusy('');
    }
  }

  async function start(trip: Trip) {
    setBusy('start');
    try {
      await apiClient.post(`/trips/${trip._id}/start`, { version: trip.version });
      toast.success(t('trips.started'));
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('trips.startFailed')));
    } finally {
      setBusy('');
    }
  }

  async function cancel(trip: Trip) {
    const reason = await ask.prompt({
      title: t('trips.cancelTitle'),
      description: t('trips.cancelBody'),
      label: t('trips.cancelLabel'),
      multiline: true,
      confirmLabel: t('trips.cancelConfirm'),
      danger: true,
      validate: requireReason(t),
    });
    if (!reason) return;

    setBusy('cancel');
    try {
      await apiClient.post(`/trips/${trip._id}/cancel`, { version: trip.version, reason });
      toast.success(t('trips.cancelled'));
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('trips.cancelFailed')));
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader
        routeId="trip-detail"
        title={t('trips.title')}
        actions={<LinkButton to="/deliveries/trips">{t('trips.back')}</LinkButton>}
      />

      <Resource
        query={query}
        loadingLabel={t('trips.sheetLoading')}
        errorMessageFallback={t('trips.sheetCouldNotLoad')}
      >
        {(trip) => {
          const stops = stopsInOrder(trip);
          const closed =
            trip.status === TripStatus.COMPLETED || trip.status === TripStatus.CANCELLED;

          return (
            <>
              <Card className="mb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold text-text">{trip.reference}</p>
                    <p className="text-text-muted">
                      {formatFinanceDate(trip.tripDate)}
                      {typeof trip.deliveryPersonId === 'string'
                        ? ''
                        : ` · ${trip.deliveryPersonId.firstName} ${trip.deliveryPersonId.lastName}`}
                      {trip.vehicleReference ? ` · ${trip.vehicleReference}` : ''}
                    </p>
                  </div>
                  <Badge tone={trip.status === TripStatus.IN_PROGRESS ? 'brand' : 'info'}>
                    {t(`tripStatus.${trip.status}`)}
                  </Badge>
                </div>

                {trip.cancelledReason && (
                  <p className="mt-2 text-text">
                    {t('trips.cancelledBecause', { reason: trip.cancelledReason })}
                  </p>
                )}

                {trip.summary && (
                  <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div>
                      <dt className="text-sm text-text-muted">{t('trips.stops')}</dt>
                      <dd className="text-2xl font-semibold tabular-nums text-text">
                        {trip.summary.stopsTotal}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-text-muted">{t('trips.remaining')}</dt>
                      <dd className="text-2xl font-semibold tabular-nums text-text">
                        {trip.summary.stopsRemaining}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-text-muted">{t('trips.packages')}</dt>
                      <dd className="text-2xl font-semibold tabular-nums text-text">
                        {trip.summary.packages}
                      </dd>
                    </div>
                  </dl>
                )}

                {trip.notes && <p className="mt-3 text-text">{trip.notes}</p>}
              </Card>

              <Card className="mb-4">
                {stops.length === 0 ? (
                  <EmptyState title={t('trips.chosenNone')} />
                ) : (
                  <ol className="flex flex-col gap-2">
                    {stops.map((stop, index) => (
                      <li
                        key={stop._id}
                        className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"
                      >
                        <div className="flex items-start gap-3">
                          <span className="min-w-8 text-lg font-semibold tabular-nums text-brand">
                            {index + 1}
                          </span>
                          <div>
                            <p className="font-medium text-text">
                              {stop.delivery?.reference ?? '—'}
                            </p>
                            <p className="text-sm text-text-muted">
                              {entityReference(stop.delivery?.shopId)}
                              {stop.delivery?.addressSnapshot
                                ? ` · ${stop.delivery.addressSnapshot.line1}, ${stop.delivery.addressSnapshot.city}`
                                : ''}
                            </p>
                            {stop.delivery?.contactSnapshot?.phone && (
                              <a
                                className="text-sm text-brand underline"
                                href={`tel:${stop.delivery.contactSnapshot.phone}`}
                              >
                                {stop.delivery.contactSnapshot.phone}
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {stop.delivery && (
                            <StatusPill kind="delivery" status={stop.delivery.status} />
                          )}
                          {stop.delivery && (
                            <Link
                              className="text-sm text-brand underline"
                              to={`/deliveries/${stop.delivery._id}`}
                            >
                              {t('trips.openDelivery')}
                            </Link>
                          )}
                          {!closed && !isRider && (
                            <>
                              <Button
                                variant="ghost"
                                label={t('trips.moveUp')}
                                disabled={index === 0}
                                onClick={() => move(trip, index, -1)}
                              >
                                ↑
                              </Button>
                              <Button
                                variant="ghost"
                                label={t('trips.moveDown')}
                                disabled={index === stops.length - 1}
                                onClick={() => move(trip, index, 1)}
                              >
                                ↓
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              {!closed && (
                <div className="flex flex-wrap justify-end gap-2">
                  {order && (
                    <Button
                      variant="primary"
                      busy={busy === 'sequence'}
                      onClick={() => void saveOrder(trip)}
                    >
                      {t('trips.saveOrder')}
                    </Button>
                  )}
                  {trip.status === TripStatus.PLANNED && (
                    <Button busy={busy === 'start'} onClick={() => void start(trip)}>
                      {t('trips.start')}
                    </Button>
                  )}
                  {!isRider && (
                    <Button
                      variant="danger"
                      busy={busy === 'cancel'}
                      onClick={() => void cancel(trip)}
                    >
                      {t('trips.cancel')}
                    </Button>
                  )}
                </div>
              )}
            </>
          );
        }}
      </Resource>
    </>
  );
}
