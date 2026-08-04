import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DeliveryStatus, RealtimeEvent } from '@medsupply/shared-types';
import type { Delivery } from '@medsupply/shared-types';
import { useLiveRefresh } from '../realtime/useRealtime';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FilterTabs,
  Input,
  PageHeader,
  Resource,
  StatusPill,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useSavedFilter } from '../lib/savedFilter';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate } from '../lib/finance';

export function DeliveryBoard() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [status, setStatus] = useSavedFilter('deliveries', '');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (query) params.set('q', query);
  const deliveries = useApiCollection<Delivery>(
    ['deliveries', status, query],
    `/deliveries${params.size ? `?${params.toString()}` : ''}`,
  );

  // Realtime is the primary signal; polling stays as the fallback for blocked sockets.
  useLiveRefresh(
    RealtimeEvent.DELIVERY_UPDATED,
    () => void queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
    30_000,
  );

  return (
    <main>
      <PageHeader
        routeId="deliveries"
        title={t('delivery.title')}
        description={t('delivery.subtitle')}
        actions={<Button onClick={() => void deliveries.refetch()}>{t('delivery.refresh')}</Button>}
      />

      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
        }}
      >
        <Field label={t('delivery.searchLabel')} className="min-w-64 flex-1">
          <Input
            value={search}
            placeholder={t('delivery.searchHint')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Button type="submit">{t('common.search')}</Button>
      </form>

      <div className="mb-4">
        <FilterTabs
          label={t('delivery.filterLabel')}
          options={[
            { value: '', label: t('delivery.allStatuses') },
            ...Object.values(DeliveryStatus).map((value) => ({
              value,
              label: t(`deliveryStatus.${value}`),
            })),
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>

      <Resource
        query={deliveries}
        loadingLabel={t('delivery.loading')}
        errorMessageFallback={t('delivery.couldNotLoad')}
        empty={<EmptyState title={t('delivery.none')} description={t('delivery.noneBody')} />}
      >
        {(page) => (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {page.items.map((delivery) => {
              const shop = typeof delivery.shopId === 'string' ? undefined : delivery.shopId;
              const order = typeof delivery.orderId === 'string' ? undefined : delivery.orderId;
              const rider =
                typeof delivery.assignedTo === 'string' ? undefined : delivery.assignedTo;
              return (
                <li key={delivery._id}>
                  <Card className="h-full p-0">
                    <Link
                      data-test={`row-${delivery.reference}`}
                      to={`/deliveries/${delivery._id}`}
                      className="flex h-full flex-col gap-1 rounded-lg p-4 hover:bg-surface-hover"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm text-text-muted">{delivery.reference}</span>
                        <Badge>{delivery.priority}</Badge>
                      </span>
                      <span className="text-lg font-semibold text-text">
                        {shop?.name ?? t('delivery.title')}
                      </span>
                      <span className="text-text-muted">{order?.reference ?? ''}</span>
                      <span className="text-text-muted">
                        {rider ? `${rider.firstName} ${rider.lastName}` : t('delivery.unassigned')}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <StatusPill kind="delivery" status={delivery.status} />
                        <span className="text-sm text-text-muted">
                          {delivery.expectedDeliveryDate
                            ? formatFinanceDate(delivery.expectedDeliveryDate)
                            : t('delivery.datePending')}
                        </span>
                      </span>
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Resource>
    </main>
  );
}
