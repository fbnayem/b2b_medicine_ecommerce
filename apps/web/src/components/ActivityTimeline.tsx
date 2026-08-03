import { useCallback, useEffect, useState } from 'react';
import {
  RealtimeEvent,
  type ActivityEntityType,
  type ActivityEventRecord,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useRealtimeEvent } from '../realtime/useRealtime';
import { formatFinanceDateTime } from '../lib/finance';

interface Props {
  entityType: ActivityEntityType;
  entityId: string;
  title?: string;
  limit?: number;
}

function formatMoment(value: string) {
  return formatFinanceDateTime(value);
}

/**
 * Permission-filtered history for one record. The server decides what the
 * viewer may read, so this renders whatever it returns without extra gating.
 */
export function ActivityTimeline({ entityType, entityId, title = 'Activity', limit = 50 }: Props) {
  const [items, setItems] = useState<ActivityEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        setError('');
      } catch {
        setError('Unable to load the activity timeline.');
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
    <section className="activity-timeline" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="link-button" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {error ? (
        <p className="state error">
          {error}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}

      {loading ? (
        <p className="state">Loading activity...</p>
      ) : items.length === 0 ? (
        <p className="state">No activity has been recorded yet.</p>
      ) : (
        <ol>
          {items.map((item) => (
            <li key={item._id}>
              <p className="timeline-summary">{item.summary}</p>
              {item.detail ? <p className="timeline-detail">{item.detail}</p> : null}
              <p className="timeline-meta">
                {formatMoment(item.occurredAt)}
                {item.actorName ? ` · ${item.actorName}` : ''}
                {item.actorRole ? ` (${item.actorRole.replaceAll('_', ' ')})` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
