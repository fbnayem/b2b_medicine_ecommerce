import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ActivityEntityType, OrderStatus } from '@medsupply/shared-types';
import type { Delivery, Order } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useCart } from '../store/useCart';
import { ActivityTimeline } from '../components/ActivityTimeline';
import {
  Button,
  Card,
  LinkButton,
  PageHeader,
  Resource,
  StatusPill,
  requireReason,
  useAsk,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDateTime, formatMinor } from '../lib/finance';

export function OrderDetail() {
  const ask = useAsk();
  const { id } = useParams();
  const [params] = useSearchParams();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { clear, add, setQuantity, setDraftId } = useCart();

  const order = useApiResource<Order>(['order', id], `/orders/${id}`);

  /*
   * An order with no delivery yet answers 404, which is an ordinary state
   * rather than a failure — most orders spend their first day in it. So this
   * query never retries and its error is simply "no delivery to track".
   */
  const delivery = useApiResource<Delivery>(['order-delivery', id], `/deliveries/order/${id}`, {
    retry: false,
  });

  const repeat = useMutation({
    mutationFn: async () => {
      const draft = (await apiClient.post(`/orders/${id}/duplicate`)).data.data;
      clear();
      for (const item of draft.items) {
        const medicine = (await apiClient.get(`/inventory/medicines/${item.medicineId}`)).data.data;
        add(medicine);
        setQuantity(medicine._id, item.requestedQuantity);
      }
      setDraftId(draft._id);
    },
    onSuccess: () => navigate('/cart'),
  });

  async function requestCancellation() {
    const reason = await ask.prompt({
      title: t('orders.cancelTitle'),
      description: t('orders.cancelBody'),
      label: t('orders.cancelLabel'),
      multiline: true,
      confirmLabel: t('orders.cancelConfirm'),
      validate: requireReason(t),
    });
    if (!reason) return;
    await apiClient.post(`/orders/${id}/cancellation-request`, { reason });
    await queryClient.invalidateQueries({ queryKey: ['order', id] });
  }

  return (
    <>
      <Resource
        query={order}
        loadingLabel={t('orders.loadingOne')}
        errorMessageFallback={t('orders.couldNotLoadOne')}
      >
        {(item) => {
          const cancellable = (
            [OrderStatus.SUBMITTED, OrderStatus.UNDER_REVIEW, OrderStatus.ON_HOLD] as string[]
          ).includes(item.status);
          return (
            <>
              <PageHeader
                routeId="order-detail"
                title={item.reference}
                description={<StatusPill kind="order" status={item.status} />}
                actions={
                  <>
                    <Button busy={repeat.isPending} onClick={() => repeat.mutate()}>
                      {t('orders.repeat')}
                    </Button>
                    {cancellable && !item.cancellationRequestedAt && (
                      <Button onClick={() => void requestCancellation()}>
                        {t('orders.requestCancellation')}
                      </Button>
                    )}
                    {delivery.data && (
                      <LinkButton to={`/deliveries/${delivery.data._id}`}>
                        {t('orders.trackDelivery')}
                      </LinkButton>
                    )}
                    <LinkButton to="/orders">{t('orders.all')}</LinkButton>
                  </>
                }
              />

              {params.get('submitted') && (
                <p
                  role="status"
                  className="mb-4 rounded-lg border border-success bg-success-subtle px-4 py-3 text-text"
                >
                  {t('orders.submitted')}
                </p>
              )}

              {item.cancellationRequestedAt && (
                <p className="mb-4 rounded-lg border border-warning bg-warning-subtle px-4 py-3 text-text">
                  {t('orders.cancellationRequested')} {item.cancellationReason}
                </p>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {t('orders.whatYouOrdered')}
                  </h2>
                  <ul className="m-0 list-none p-0">
                    {item.items.map((line) => (
                      <li
                        key={line.medicineId}
                        className="flex items-baseline justify-between gap-4 border-b border-border py-2"
                      >
                        <div>
                          <p className="font-medium text-text">
                            {line.medicineSnapshot.brandName} {line.medicineSnapshot.strength}
                          </p>
                          <p className="text-sm text-text-muted tabular-nums">
                            {line.requestedQuantity} × {formatMinor(line.estimatedUnitPriceMinor)}
                          </p>
                        </div>
                        <strong className="tabular-nums text-text">
                          {formatMinor(line.estimatedLineTotalMinor)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-baseline justify-between gap-4 pt-3">
                    <strong className="text-text">{t('orders.estimatedTotal')}</strong>
                    <strong className="text-lg tabular-nums text-text">
                      {formatMinor(item.estimatedTotalMinor)}
                    </strong>
                  </div>
                </Card>

                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">{t('orders.timeline')}</h2>
                  <ol className="m-0 list-none p-0">
                    {item.statusHistory.map((entry, index) => (
                      <li
                        key={`${entry.to}-${index}`}
                        className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0"
                      >
                        <div>
                          <StatusPill kind="order" status={entry.to} />
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
                entityType={ActivityEntityType.ORDER}
                entityId={String(item._id)}
                title={t('orders.activity')}
              />
            </>
          );
        }}
      </Resource>
    </>
  );
}
