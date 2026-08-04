import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorMessage } from '@medsupply/api-client';
import { fetchTimeline, type ActivityItem } from './api';
import { formatFinanceDateTime } from '../finance/date';
import { useLanguage } from '../i18n/useLanguage';
import { Card, ErrorState, LoadingState, SectionTitle } from '../components';
import { colour, layout } from '../theme';

interface Props {
  entityType: string;
  entityId: string;
  title?: string;
}

/**
 * Permission-filtered history for one record. The server decides what this
 * viewer may read, so everything returned is safe to render.
 */
export function ActivityTimelineView({ entityType, entityId, title }: Props) {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      setItems(await fetchTimeline(entityType, entityId));
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('activity.couldNotLoad')));
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <SectionTitle>{title ?? t('activity.title')}</SectionTitle>
      {loading ? (
        <LoadingState label={t('activity.loading')} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <Text style={{ color: colour.textMuted }}>{t('activity.none')}</Text>
      ) : (
        items.map((item) => (
          <View
            key={item._id}
            style={{
              borderLeftWidth: 2,
              borderLeftColor: colour.border,
              paddingLeft: layout.space[3],
              paddingBottom: layout.space[2],
            }}
          >
            <Text style={{ fontWeight: '600', color: colour.text }}>{item.summary}</Text>
            {item.detail ? <Text style={{ color: colour.textMuted }}>{item.detail}</Text> : null}
            <Text
              style={{
                color: colour.textMuted,
                fontSize: layout.fontSize.sm,
                marginTop: layout.space[1],
              }}
            >
              {formatFinanceDateTime(item.occurredAt)}
              {item.actorName ? ` · ${item.actorName}` : ''}
            </Text>
          </View>
        ))
      )}
    </Card>
  );
}
