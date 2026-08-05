import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RealtimeEvent } from '@medsupply/shared-types';
import { keys } from '../lib/queryKeys';
import { onRealtime } from './socket';

/**
 * What each push from the server makes stale.
 *
 * Thirteen events are declared and the server emits twelve of them to the right
 * rooms. **Five had a listener.** `ORDER_UPDATED`, `APPROVAL_UPDATED`,
 * `FULFILMENT_UPDATED`, `PAYMENT_UPDATED`, `NOTIFICATION_UPDATED` and
 * `SETTINGS_UPDATED` arrived in the browser and landed nowhere — the server had
 * already done the work of deciding who should hear about them, and the client
 * threw it away. Somebody approving an order in one office changed nothing on
 * anybody else's screen for thirty seconds, and only then if they happened to
 * refocus the window.
 *
 * One map rather than a listener per page, because the answer to "what does an
 * approval change?" is a property of the domain, not of whichever screen
 * happens to be open. A page that also needs to do something *else* on an event
 * still subscribes for itself — `NotificationBell` updates its own store,
 * `ActivityTimeline` reloads only when the entity matches — but nothing else
 * has to remember which caches to clear.
 *
 * `INVENTORY_UPDATED` is here and the server has never emitted it. This phase
 * adds the first UI that changes a price or corrects a stock count, so it emits
 * it too.
 */
const AFFECTS: Partial<Record<RealtimeEvent, readonly (readonly string[])[]>> = {
  [RealtimeEvent.ORDER_UPDATED]: [keys.orders.all, keys.approvals.all, keys.fulfilment.all],
  [RealtimeEvent.APPROVAL_UPDATED]: [keys.approvals.all, keys.orders.all, keys.fulfilment.all],
  [RealtimeEvent.FULFILMENT_UPDATED]: [
    keys.fulfilment.all,
    keys.orders.all,
    keys.stock.all,
    keys.medicines.all,
  ],
  [RealtimeEvent.DELIVERY_UPDATED]: [keys.deliveries.all, keys.trips.all, keys.orders.all],
  [RealtimeEvent.PAYMENT_UPDATED]: [keys.payments.all, keys.finance.all],
  [RealtimeEvent.RETURN_UPDATED]: [
    keys.returns.all,
    keys.stock.all,
    keys.medicines.all,
    keys.finance.all,
  ],
  [RealtimeEvent.INVENTORY_UPDATED]: [keys.stock.all, keys.medicines.all],
  [RealtimeEvent.NOTIFICATION_CREATED]: [keys.notifications.all],
  [RealtimeEvent.NOTIFICATION_UPDATED]: [keys.notifications.all],
  [RealtimeEvent.ACTIVITY_CREATED]: [keys.activity.all],
  [RealtimeEvent.SETTINGS_UPDATED]: [keys.settings.all],
};

/**
 * Subscribes once, for the whole application. Mounted by `AppShell`, which is
 * also what opens and closes the socket.
 */
export function useLiveCache(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribes = Object.entries(AFFECTS).map(([event, families]) =>
      onRealtime(event as RealtimeEvent, () => {
        for (const family of families ?? []) {
          void queryClient.invalidateQueries({ queryKey: family });
        }
      }),
    );
    return () => unsubscribes.forEach((stop) => stop());
  }, [queryClient]);
}
