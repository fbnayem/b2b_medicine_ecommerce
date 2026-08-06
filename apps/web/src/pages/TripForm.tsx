import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toDateInputValue } from '@medsupply/utilities';
import { UserRole, type PlannableDelivery } from '@medsupply/shared-types';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormNotice,
  Input,
  LinkButton,
  PageHeader,
  PickOrCreate,
  Resource,
  Textarea,
  toast,
  type FormProblem,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../lib/useLanguage';
import { useAuthStore } from '../store/useAuth';
import { canAddPeople } from '../lib/permissions';
import { UserForm } from './UserForm';
import { entityReference, formatFinanceDate } from '../lib/finance';

interface Rider {
  _id: string;
  firstName: string;
  lastName: string;
  activeDeliveries?: number;
}

/** Stable ids, so the validation notice can carry the reader to the control. */
const RIDER_FIELD = 'trip-rider';
const DAY_FIELD = 'trip-day';
const STOPS_PANEL = 'trip-available';

/**
 * Planning a round.
 *
 * Two lists rather than a multi-select: **the order matters**, and a
 * multi-select cannot express it. What is chosen appears in the sequence it
 * will be driven in, which is the whole point of the screen.
 *
 * Two things this screen got wrong, both about telling the truth.
 *
 * It answered its own validation with the red "Something went wrong" card, so a
 * round with no stops on it yet was reported as a malfunction — and in one
 * sentence covering three separate requirements, which does not tell somebody
 * who has already chosen a rider and a day which of the three they are missing.
 * That is `FormNotice` now, one problem at a time, each offering to take you to
 * the thing it is about.
 *
 * And it rendered "Nothing is waiting to go on a round" for **three different
 * facts**: the list is loading, the list failed to load, and the list is
 * genuinely empty. A failed request reading as "there is nothing here" is the
 * worst of the three, because the reader has no reason to doubt it.
 */
export function TripForm() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const mayAddPeople = canAddPeople(useAuthStore((state) => state.user?.role));

  /*
   * `useApiCollection`, matching `DeliveryDetail`.
   *
   * These two screens shared a cache key and disagreed about its *shape*: this
   * one stored the raw array and the other stored a normalised collection,
   * under one key with five-minute retention. Visit one and then the other
   * inside five minutes and the page died on `.find is not a function` — on
   * exactly the picker this phase is about. Naming the key from one factory
   * fixed what it was called; agreeing on the hook is what fixes the crash.
   */
  const riders = useApiCollection<Rider>(keys.riders.list(), '/deliveries/personnel');
  const [deliveryPersonId, setDeliveryPersonId] = useState('');
  const [tripDate, setTripDate] = useState(() => toDateInputValue(new Date()));
  const [vehicleReference, setVehicleReference] = useState('');
  const [notes, setNotes] = useState('');
  const [chosen, setChosen] = useState<PlannableDelivery[]>([]);
  const [submitting, setSubmitting] = useState(false);
  /*
   * Which submit attempt this is, rather than the problems themselves. The list
   * is derived below so it shrinks as the form is filled in; this is what moves
   * the cursor, and it changes only when somebody presses the button.
   */
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  const available = useApiResource<PlannableDelivery[]>(
    keys.trips.plannable(deliveryPersonId),
    `/trips/plannable${deliveryPersonId ? `?deliveryPersonId=${deliveryPersonId}` : ''}`,
  );

  const chosenIds = new Set(chosen.map((delivery) => delivery._id));
  const offered = (available.data ?? []).filter((delivery) => !chosenIds.has(delivery._id));

  const chosenRider = (riders.data?.items ?? []).find((rider) => rider._id === deliveryPersonId);
  /*
   * Nothing to plan **with**, as distinct from nothing chosen yet. The whole
   * screen is a dead end in that case: no sequence of actions on it produces a
   * round, so saying it once at the top beats letting somebody pick a vehicle
   * and type notes before finding out.
   */
  const nothingToPlan =
    available.isSuccess && !deliveryPersonId && (available.data ?? []).length === 0;

  const problems: FormProblem[] = [];
  if (!deliveryPersonId) problems.push({ message: t('trips.needRider'), focus: RIDER_FIELD });
  if (!tripDate) problems.push({ message: t('trips.needDay'), focus: DAY_FIELD });
  if (chosen.length === 0) problems.push({ message: t('trips.needStops'), focus: STOPS_PANEL });

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

    setAttempt((count) => count + 1);
    if (problems.length > 0) return;

    setSubmitting(true);
    try {
      const response = await apiClient.post('/trips', {
        deliveryPersonId,
        tripDate,
        deliveryIds: chosen.map((delivery) => delivery._id),
        vehicleReference: vehicleReference || undefined,
        notes: notes || undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.trips.all }),
        queryClient.invalidateQueries({ queryKey: keys.deliveries.all }),
      ]);
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

        {/*
          Said before anything is filled in, not after. With no delivery
          assigned to anybody there is no round to be planned, and letting
          somebody pick a vehicle and type notes before telling them that is a
          waste of their afternoon.
        */}
        {nothingToPlan && (
          <EmptyState
            title={t('trips.nothingToPlanTitle')}
            description={t('trips.nothingToPlanBody')}
            action={<LinkButton to="/deliveries">{t('trips.goToDeliveries')}</LinkButton>}
          />
        )}

        {riders.isError && <ErrorState message={t('trips.ridersFailed')} />}

        {attempt > 0 && <FormNotice problems={problems} focusKey={attempt} />}

        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            {/*
              The ask, in one control: choose a rider, or make the one that is
              not there yet without losing the stops already on the round.

              Leaving to create a person used to cost the whole ordered stop
              list — no form in this application persists a draft or warns
              before discarding one — which is why this is a dialog and not a
              link.
            */}
            <PickOrCreate
              label={t('trips.rider')}
              id={RIDER_FIELD}
              required
              placeholder={t('trips.chooseRider')}
              value={deliveryPersonId}
              onChange={(value) => {
                setDeliveryPersonId(value);
                // The offered list is scoped to the rider, so a rider change
                // would otherwise leave somebody else's stops on the round.
                setChosen([]);
              }}
              options={(riders.data?.items ?? []).map((rider) => ({
                value: rider._id,
                label: `${rider.firstName} ${rider.lastName}`,
              }))}
              create={
                mayAddPeople
                  ? {
                      label: t('people.addRider'),
                      title: t('people.addRiderTitle'),
                      description: t('people.addRiderBody'),
                      invalidates: keys.riders.all,
                      render: (done, cancel) => (
                        <UserForm
                          mode="dialog"
                          fixedRole={UserRole.DELIVERY_PERSON}
                          onCreated={done}
                          onCancel={cancel}
                        />
                      ),
                    }
                  : undefined
              }
            />
            <Field label={t('trips.day')} required id={DAY_FIELD} hint={t('hints.tripDay')}>
              <Input
                type="date"
                required
                value={tripDate}
                onChange={(event) => setTripDate(event.target.value)}
              />
            </Field>
            <Field label={t('trips.vehicle')} hint={t('hints.vehicle')}>
              <Input
                value={vehicleReference}
                onChange={(event) => setVehicleReference(event.target.value)}
              />
            </Field>
          </div>
          <Field label={t('trips.notes')} className="mt-3" hint={t('hints.notesOptional')}>
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/*
            `tabIndex={-1}` so the validation notice can bring the reader here.
            A panel is the honest target for "add at least one stop": the thing
            to act on is the list inside it, not any one control.
          */}
          <Card id={STOPS_PANEL} tabIndex={-1}>
            <h2 className="mb-2 text-lg font-semibold text-text">{t('trips.available')}</h2>
            <Resource
              query={available}
              loadingLabel={t('trips.availableLoading')}
              errorMessageFallback={t('trips.availableFailed')}
              // The panel decides emptiness from `offered`, which excludes what
              // is already on the round; `Resource` would only see the payload.
              isEmpty={() => false}
            >
              {() =>
                offered.length === 0 ? (
                  <EmptyState
                    title={
                      chosenRider
                        ? t('trips.availableNoneForRider', {
                            rider: `${chosenRider.firstName} ${chosenRider.lastName}`,
                          })
                        : t('trips.availableNone')
                    }
                    description={
                      chosenRider
                        ? t('trips.availableNoneForRiderBody')
                        : t('trips.availableNoneBody')
                    }
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
                )
              }
            </Resource>
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
