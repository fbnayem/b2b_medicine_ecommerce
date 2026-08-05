import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ActivityEntityType,
  DeliveryPriority,
  DeliveryStatus,
  RealtimeEvent,
  UserRole,
} from '@medsupply/shared-types';
import type { Delivery, User } from '@medsupply/shared-types';
import { toDateInputValue } from '@medsupply/utilities';
import { apiClient, errorMessage } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { canAddPeople } from '../lib/permissions';
import { UserForm } from './UserForm';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { useRealtimeEvent } from '../realtime/useRealtime';
import {
  Button,
  Card,
  Field,
  Input,
  LinkButton,
  PageHeader,
  PickOrCreate,
  Resource,
  Select,
  StatusPill,
  Textarea,
  toast,
  useAsk,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { createActionKey, formatFinanceDateTime } from '../lib/finance';

type DeliveryPerson = Pick<User, '_id' | 'firstName' | 'lastName' | 'email'> & {
  activeDeliveries: number;
};

const MANAGER_ROLES: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];

/** A label and its value, so every detail block on every page lines up. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

export function DeliveryDetail() {
  const ask = useAsk();
  const { id } = useParams();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const canManage = role ? MANAGER_ROLES.includes(role) : false;
  const mayAddPeople = canAddPeople(role);

  const query = useApiResource<Delivery>(keys.deliveries.one(id!), `/deliveries/${id}`);
  const delivery = query.data;
  const people = useApiCollection<DeliveryPerson>(keys.riders.list(), '/deliveries/personnel', {
    enabled: canManage,
  });

  const [personId, setPersonId] = useState('');
  // The Dhaka calendar date. `toISOString()` yields the UTC one, so a
  // storekeeper assigning a delivery before 6 am was offered yesterday.
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [priority, setPriority] = useState<DeliveryPriority>(DeliveryPriority.NORMAL);
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    if (!delivery) return;
    setPersonId(
      typeof delivery.assignedTo === 'string'
        ? delivery.assignedTo
        : (delivery.assignedTo?._id ?? ''),
    );
    if (delivery.expectedDeliveryDate) setDate(delivery.expectedDeliveryDate.slice(0, 10));
    setPriority(delivery.priority);
    setInstructions(delivery.instructions ?? '');
  }, [delivery]);

  // Another operator acting on this delivery refreshes the open detail view.
  useRealtimeEvent<{ entityId?: string }>(RealtimeEvent.DELIVERY_UPDATED, (payload) => {
    if (payload?.entityId === id)
      void queryClient.invalidateQueries({ queryKey: keys.deliveries.all });
  });

  async function post(path: string, body: Record<string, unknown>, done: string) {
    if (!delivery) return;
    try {
      await apiClient.post(`/deliveries/${id}/${path}`, {
        version: delivery.version,
        idempotencyKey: createActionKey(path),
        ...body,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.deliveries.all }),
        queryClient.invalidateQueries({ queryKey: keys.trips.all }),
        queryClient.invalidateQueries({ queryKey: keys.orders.all }),
      ]);
      toast.success(done);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('deliveryDetail.actionFailed')));
    }
  }

  async function openBlob(url: string, params: Record<string, string> | undefined, failed: string) {
    try {
      const file = await apiClient.get(url, { params, responseType: 'blob' });
      const objectUrl = URL.createObjectURL(file.data as Blob);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch {
      toast.error(failed);
    }
  }

  return (
    <>
      <Resource
        query={query}
        loadingLabel={t('deliveryDetail.loading')}
        errorMessageFallback={t('deliveryDetail.couldNotLoad')}
      >
        {(record) => {
          const shop = typeof record.shopId === 'string' ? undefined : record.shopId;
          const order = typeof record.orderId === 'string' ? undefined : record.orderId;
          const pack = typeof record.packageId === 'string' ? undefined : record.packageId;
          const invoice = typeof record.invoiceId === 'string' ? undefined : record.invoiceId;
          const person = typeof record.assignedTo === 'string' ? undefined : record.assignedTo;
          const assignable = (
            [
              DeliveryStatus.READY_FOR_ASSIGNMENT,
              DeliveryStatus.ASSIGNED,
              DeliveryStatus.RETURNED_TO_STORE,
            ] as string[]
          ).includes(record.status);

          async function assign() {
            if (!personId || !date) {
              toast.error(t('deliveryDetail.needPersonAndDate'));
              return;
            }
            await post(
              'assign',
              {
                deliveryPersonId: personId,
                expectedDeliveryDate: `${date}T12:00:00+06:00`,
                priority,
                instructions: instructions || undefined,
              },
              t('deliveryDetail.assignmentSaved'),
            );
          }

          async function handover() {
            if (!pack || !invoice) return;
            const agreed = await ask.confirm({
              title: t('deliveryDetail.handoverAsk', { package: pack.reference }),
              description: t('deliveryDetail.handoverAskBody'),
              confirmLabel: t('deliveryDetail.confirmHandover'),
            });
            if (!agreed) return;
            await post(
              'handover',
              {
                packageReference: pack.reference,
                invoiceReference: invoice.reference,
                packageCount: pack.packageCount,
              },
              t('deliveryDetail.handoverDone'),
            );
          }

          return (
            <>
              <PageHeader
                routeId="delivery-detail"
                title={record.reference}
                description={<StatusPill kind="delivery" status={record.status} />}
                actions={
                  <>
                    <LinkButton to="/deliveries">{t('deliveryDetail.board')}</LinkButton>
                    {order && (
                      <LinkButton to={`/orders/${order._id}`}>
                        {t('deliveryDetail.order')}
                      </LinkButton>
                    )}
                  </>
                }
              />

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {t('deliveryDetail.destination')}
                  </h2>
                  <dl className="m-0">
                    <Detail label={t('fields.shop')}>{shop?.name}</Detail>
                    <Detail label={t('fields.phone')}>
                      <a
                        className="text-brand underline"
                        href={`tel:${record.contactSnapshot.phone}`}
                      >
                        {record.contactSnapshot.phone}
                      </a>
                    </Detail>
                    <Detail label={t('fields.address')}>
                      {record.addressSnapshot.line1}, {record.addressSnapshot.city},{' '}
                      {record.addressSnapshot.district}
                    </Detail>
                    <Detail label={t('deliveryDetail.package')}>
                      {pack?.reference} ·{' '}
                      {pack?.packageCount === 1
                        ? t('deliveryDetail.onePackage')
                        : t('deliveryDetail.packageCount', { count: pack?.packageCount ?? 0 })}
                    </Detail>
                    <Detail label={t('returns.columnInvoice')}>{invoice?.reference}</Detail>
                    <Detail label={t('deliveryDetail.assignedTo')}>
                      {person
                        ? `${person.firstName} ${person.lastName}`
                        : t('deliveryDetail.notAssigned')}
                    </Detail>
                    <Detail label={t('deliveryDetail.requiredProof')}>
                      {/* Was the raw enum joined with commas: `OTP, SIGNATURE, GPS`. */}
                      {record.proofRequirements
                        .map((requirement) => t(`deliveryProofType.${requirement}`))
                        .join(', ')}
                    </Detail>
                  </dl>
                  {invoice && (
                    <Button
                      className="mt-3"
                      onClick={() =>
                        void openBlob(
                          `/fulfilment/invoices/${invoice._id}/pdf`,
                          { layout: 'a4' },
                          t('deliveryDetail.pdfFailed'),
                        )
                      }
                    >
                      {t('deliveryDetail.openInvoice')}
                    </Button>
                  )}
                </Card>

                {canManage && assignable && (
                  <Card>
                    <h2 className="mb-2 text-lg font-semibold text-text">
                      {record.assignedTo
                        ? t('deliveryDetail.reassignTitle')
                        : t('deliveryDetail.assignTitle')}
                    </h2>
                    <form
                      className="flex flex-col gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void assign();
                      }}
                    >
                      <PickOrCreate
                        label={t('deliveryDetail.person')}
                        required
                        placeholder={t('deliveryDetail.selectPerson')}
                        value={personId}
                        onChange={setPersonId}
                        options={(people.data?.items ?? []).map((candidate) => ({
                          value: candidate._id,
                          label: `${candidate.firstName} ${candidate.lastName} · ${t(
                            'deliveryDetail.activeCount',
                            { count: candidate.activeDeliveries },
                          )}`,
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
                      <Field label={t('deliveryDetail.expectedDate')} required>
                        <Input
                          type="date"
                          value={date}
                          onChange={(event) => setDate(event.target.value)}
                        />
                      </Field>
                      <Field label={t('deliveryDetail.priority')}>
                        <Select
                          value={priority}
                          onChange={(event) => setPriority(event.target.value as DeliveryPriority)}
                        >
                          {Object.values(DeliveryPriority).map((value) => (
                            <option key={value} value={value}>
                              {t(`deliveryPriority.${value}`)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t('deliveryDetail.instructions')}>
                        <Textarea
                          value={instructions}
                          onChange={(event) => setInstructions(event.target.value)}
                        />
                      </Field>
                      <div className="flex flex-wrap justify-end gap-2">
                        {record.status === DeliveryStatus.ASSIGNED && (
                          <Button
                            variant="danger"
                            onClick={() => {
                              void (async () => {
                                const agreed = await ask.confirm({
                                  title: t('deliveryDetail.cancelTitle'),
                                  description: t('deliveryDetail.cancelBody'),
                                  confirmLabel: t('deliveryDetail.cancelDelivery'),
                                  danger: true,
                                });
                                if (agreed) {
                                  await post('cancel', {}, t('deliveryDetail.cancelled'));
                                }
                              })();
                            }}
                          >
                            {t('deliveryDetail.cancelDelivery')}
                          </Button>
                        )}
                        <Button type="submit" variant="primary">
                          {t('deliveryDetail.saveAssignment')}
                        </Button>
                      </div>
                    </form>
                  </Card>
                )}

                {role === UserRole.STOREKEEPER && record.status === DeliveryStatus.ASSIGNED && (
                  <Card>
                    <h2 className="mb-1 text-lg font-semibold text-text">
                      {t('deliveryDetail.handoverTitle')}
                    </h2>
                    <p className="mb-3 max-w-prose text-text-muted">
                      {t('deliveryDetail.handoverBody')}
                    </p>
                    <Button variant="primary" onClick={() => void handover()}>
                      {t('deliveryDetail.confirmHandover')}
                    </Button>
                  </Card>
                )}

                {role === UserRole.STOREKEEPER && record.status === DeliveryStatus.RETURNING && (
                  <Card>
                    <h2 className="mb-1 text-lg font-semibold text-text">
                      {t('deliveryDetail.returnedTitle')}
                    </h2>
                    <p className="mb-3 max-w-prose text-text-muted">
                      {t('deliveryDetail.returnedBody')}
                    </p>
                    <Button
                      variant="primary"
                      onClick={() => {
                        void (async () => {
                          const agreed = await ask.confirm({
                            title: t('deliveryDetail.returnedAsk'),
                            description: t('deliveryDetail.returnedAskBody'),
                            confirmLabel: t('deliveryDetail.returnedConfirm'),
                          });
                          if (agreed) {
                            await post('returned', {}, t('deliveryDetail.returnConfirmed'));
                          }
                        })();
                      }}
                    >
                      {t('deliveryDetail.confirmReturned')}
                    </Button>
                  </Card>
                )}

                {record.failure && (
                  <Card>
                    <h2 className="mb-2 text-lg font-semibold text-text">
                      {t('deliveryDetail.failedAttempt')}
                    </h2>
                    <p className="font-medium text-text">
                      {t(`deliveryFailureReason.${record.failure.reason}`)}
                    </p>
                    <p className="text-text-muted">{record.failure.notes}</p>
                    <p className="text-sm text-text-muted">
                      {formatFinanceDateTime(record.failure.reportedAt)}
                    </p>
                    {canManage && record.status === DeliveryStatus.FAILED && (
                      <Button
                        className="mt-3"
                        variant="primary"
                        onClick={() =>
                          void post('returning', {}, t('deliveryDetail.returnStarted'))
                        }
                      >
                        {t('deliveryDetail.startReturn')}
                      </Button>
                    )}
                  </Card>
                )}

                {record.proof && (
                  <Card>
                    <h2 className="mb-2 text-lg font-semibold text-text">
                      {t('deliveryDetail.proof')}
                    </h2>
                    <dl className="m-0">
                      <Detail label={t('deliveryDetail.receiver')}>
                        {record.proof.receiverName}
                      </Detail>
                      <Detail label={t('fields.phone')}>{record.proof.receiverPhone}</Detail>
                      <Detail label={t('deliveryDetail.packages')}>
                        {record.proof.deliveredPackageCount}
                      </Detail>
                      <Detail label={t('deliveryDetail.time')}>
                        {formatFinanceDateTime(record.proof.deliveredAt)}
                      </Detail>
                      <Detail label={t('deliveryDetail.otp')}>
                        {record.proof.otpVerifiedAt
                          ? t('deliveryDetail.otpVerified')
                          : t('deliveryDetail.otpNotRequired')}
                      </Detail>
                      <Detail label={t('deliveryDetail.gps')}>
                        {record.proof.gps
                          ? `${record.proof.gps.latitude.toFixed(5)}, ${record.proof.gps.longitude.toFixed(5)}`
                          : t('deliveryDetail.notProvided')}
                      </Detail>
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {record.proof.signatureFileId && (
                        <Button
                          onClick={() =>
                            void openBlob(
                              `/deliveries/proof/${record.proof!.signatureFileId!}`,
                              undefined,
                              t('deliveryDetail.proofFailed'),
                            )
                          }
                        >
                          {t('deliveryDetail.viewSignature')}
                        </Button>
                      )}
                      {record.proof.photoFileId && (
                        <Button
                          onClick={() =>
                            void openBlob(
                              `/deliveries/proof/${record.proof!.photoFileId!}`,
                              undefined,
                              t('deliveryDetail.proofFailed'),
                            )
                          }
                        >
                          {t('deliveryDetail.viewPhoto')}
                        </Button>
                      )}
                    </div>
                  </Card>
                )}

                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {t('deliveryDetail.timeline')}
                  </h2>
                  <ol className="m-0 list-none p-0">
                    {record.history.map((entry, index) => (
                      <li
                        key={`${entry.to}-${index}`}
                        className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0"
                      >
                        <div>
                          <StatusPill kind="delivery" status={entry.to} />
                          {entry.note && (
                            <p className="mt-1 text-sm text-text-muted">{entry.note}</p>
                          )}
                        </div>
                        <span className="text-sm text-text-muted">
                          {formatFinanceDateTime(entry.at)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Card>
              </div>

              <ActivityTimeline
                entityType={ActivityEntityType.DELIVERY}
                entityId={String(record._id)}
                title={t('deliveryDetail.activity')}
              />
            </>
          );
        }}
      </Resource>
    </>
  );
}
