import { useCallback, useEffect, useState } from 'react';
import {
  RealtimeEvent,
  type ActivityEntityType,
  type ActivityEventRecord,
  type UserRole,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useRealtimeEvent } from '../realtime/useRealtime';
import { formatFinanceDateTime } from '../lib/finance';
import { useLanguage } from '../lib/useLanguage';
import { Button, EmptyState, ErrorState, LoadingState } from './ui';

interface Props {
  entityType: ActivityEntityType;
  entityId: string;
  title?: string;
  limit?: number;
}

/**
 * Permission-filtered history for one record. The server decides what the
 * viewer may read, so this renders whatever it returns without extra gating.
 *
 * Every class it used — `activity-timeline`, `timeline-summary`, `link-button`,
 * `state` — came from the deleted `inventory.css`, so on the order, delivery
 * and return detail screens the history rendered as an undifferentiated run of
 * paragraphs. It is a sequence, so it now looks like one: a rule down the side
 * and a marker per entry, newest first as the server returns them.
 */
export function ActivityTimeline({ entityType, entityId, title, limit = 50 }: Props) {
  const { t, c } = useLanguage();
  const [items, setItems] = useState<ActivityEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  /*
   * A flag, not a sentence.
   *
   * Holding the *message* meant `load` had to close over `t`, which made it a
   * dependency of the `useCallback` — and `t` changes identity on every render,
   * so `useEffect(…, [load])` refetched the timeline on every render, forever.
   * The wording belongs at the point of display anyway: it is the only place
   * that knows which language is current when the message is read.
   */
  const [failed, setFailed] = useState(false);

  const heading = title ?? t('activity.timelineTitle');

  const load = useCallback(
    async (silent = false) => {
      if (!entityId) return;
      if (!silent) setLoading(true);
      try {
        const response = await apiClient.get('/activity/timeline', {
          params: { entityType, entityId, limit },
        });
        // A truncated or unexpected payload should degrade to "no activity"
        // rather than throwing and blanking the record it is embedded in.
        setItems(Array.isArray(response.data.data) ? response.data.data : []);
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [entityId, entityType, limit],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeEvent<{ entityId?: string; orderId?: string }>(
    RealtimeEvent.ACTIVITY_CREATED,
    (payload) => {
      // Only refetch when the pushed event belongs to this record.
      if (payload?.entityId === entityId || payload?.orderId === entityId) void load(true);
    },
  );

  return (
    <section
      aria-label={heading}
      className="rounded-lg border border-border bg-surface p-4 shadow-sm"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text">{heading}</h2>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          {t('activity.refresh')}
        </Button>
      </header>

      {failed ? (
        <ErrorState message={t('activity.timelineCouldNotLoad')} onRetry={() => void load()} />
      ) : loading ? (
        <LoadingState label={t('activity.loading')} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('activity.timelineNone')}
          description={t('activity.timelineNoneBody')}
        />
      ) : (
        <ol className="flex flex-col border-s border-border ps-4">
          {items.map((item) => (
            <li key={item._id} className="relative pb-4 last:pb-0">
              <span
                aria-hidden="true"
                className="absolute -start-[1.3125rem] top-1.5 size-2 rounded-full bg-border-strong ring-4 ring-surface"
              />
              <p className="font-medium text-text">{item.summary}</p>
              {item.detail && <p className="text-sm text-text-muted">{item.detail}</p>}
              <p className="text-xs text-text-muted">
                {formatFinanceDateTime(item.occurredAt)}
                {item.actorName ? ` · ${item.actorName}` : ''}
                {/* Was `replaceAll('_', ' ')`, which put "DELIVERY PERSON" on
                    screen. The catalogue has these in both languages. */}
                {item.actorRole ? ` (${c.roles[item.actorRole as UserRole]})` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
