import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toDateInputValue } from '@medsupply/utilities';
import type { PlannableDelivery } from '@medsupply/shared-types';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Textarea,
  toast,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { entityReference, formatFinanceDate } from '../lib/finance';

interface Rider {
  _id: string;
  firstName: string;
  lastName: string;
  activeDeliveries?: number;
}

/**
 * Planning a round.
 *
 * Two lists rather than a multi-select: **the order matters**, and a
 * multi-select cannot express it. What is chosen appears in the sequence it
 * will be driven in, which is the whole point of the screen.
 */
export function TripForm() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const riders = useApiResource<Rider[]>(['delivery-personnel'], '/deliveries/personnel');
  const [deliveryPersonId, setDeliveryPersonId] = useState('');
  const [tripDate, setTripDate] = useState(() => toDateInputValue(new Date()));
  const [vehicleReference, setVehicleReference] = useState('');
  const [notes, setNotes] = useState('');
  const [chosen, setChosen] = useState<PlannableDelivery[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  const available = useApiResource<PlannableDelivery[]>(
    ['plannable', deliveryPersonId],
    `/trips/plannable${deliveryPersonId ? `?deliveryPersonId=${deliveryPersonId}` : ''}`,
  );

  const chosenIds = new Set(chosen.map((delivery) => delivery._id));
  const offered = (available.data ?? []).filter((delivery) => !chosenIds.has(delivery._id));

  function move(index: number, by: number) {
    const next = [...chosen];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setChosen(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    if (!deliveryPersonId || !tripDate || chosen.length === 0) {
      setFailure({ message: t('trips.needRiderAndStops') });
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiClient.post('/trips', {
        deliveryPersonId,
        tripDate,
        deliveryIds: chosen.map((delivery) => delivery._id),
        vehicleReference: vehicleReference || undefined,
        notes: notes || undefined,
      });
      const created = response.data.data as { _id: string; reference: string };
      toast.success(t('trips.planned', { reference: created.reference }));
      navigate(`/deliveries/trips/${created._id}`);
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('trips.planFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        routeId="trip-new"
        title={t('trips.planTitle')}
        description={t('trips.planSubtitle')}
        actions={<LinkButton to="/deliveries/trips">{t('trips.back')}</LinkButton>}
      />

      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        {failure && <ErrorState message={failure.message} reference={failure.reference} />}

        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('trips.rider')} required>
              <Select
                required
                value={deliveryPersonId}
                onChange={(event) => {
                  setDeliveryPersonId(event.target.value);
                  // The offered list is scoped to the rider, so a rider change
                  // would otherwise leave somebody else's stops on the round.
                  setChosen([]);
                }}
              >
                <option value="">{t('trips.chooseRider')}</option>
                {(riders.data ?? []).map((rider) => (
                  <option key={rider._id} value={rider._id}>
                    {rider.firstName} {rider.lastName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('trips.day')} required>
              <Input
                type="date"
                required
                value={tripDate}
                onChange={(event) => setTripDate(event.target.value)}
              />
            </Field>
            <Field label={t('trips.vehicle')}>
              <Input
                value={vehicleReference}
                onChange={(event) => setVehicleReference(event.target.value)}
              />
            </Field>
          </div>
          <Field label={t('trips.notes')} className="mt-3">
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-2 text-lg font-semibold text-text">{t('trips.available')}</h2>
            {offered.length === 0 ? (
              <EmptyState
                title={t('trips.availableNone')}
                description={t('trips.availableNoneBody')}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {offered.map((delivery) => (
                  <li
                    key={delivery._id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2"
                  >
                    <div>
                      <p className="font-medium text-text">{delivery.reference}</p>
                      <p className="text-sm text-text-muted">
                        {entityReference(delivery.shopId)} · {delivery.addressSnapshot?.line1},{' '}
                        {delivery.addressSnapshot?.city}
                        {delivery.expectedDeliveryDate
                          ? ` · ${formatFinanceDate(delivery.expectedDeliveryDate)}`
                          : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => setChosen((current) => [...current, delivery])}
                    >
                      {t('trips.addStop')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 text-lg font-semibold text-text">
              {t('trips.chosen')} · {t('trips.stopsCount', { count: chosen.length })}
            </h2>
            {chosen.length === 0 ? (
              <EmptyState title={t('trips.chosenNone')} />
            ) : (
              <ol className="flex flex-col gap-2">
                {chosen.map((delivery, index) => (
                  <li
                    key={delivery._id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="min-w-8 text-lg font-semibold tabular-nums text-brand">
                        {index + 1}
                      </span>
                      <div>
                        <p className="font-medium text-text">{delivery.reference}</p>
                        <p className="text-sm text-text-muted">
                          {entityReference(delivery.shopId)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        label={t('trips.moveUp')}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        label={t('trips.moveDown')}
                        disabled={index === chosen.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setChosen((current) =>
                            current.filter((entry) => entry._id !== delivery._id),
                          )
                        }
                      >
                        {t('trips.removeStop')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" busy={submitting}>
            {t('trips.savePlan')}
          </Button>
        </div>
      </form>
    </>
  );
}
