import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchTimeline, type ActivityItem } from './api';

interface Props {
  entityType: string;
  entityId: string;
  title?: string;
}

/**
 * Permission-filtered history for one record. The server decides what this
 * viewer may read, so everything returned is safe to render.
 */
export function ActivityTimelineView({ entityType, entityId, title = 'Activity' }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      setItems(await fetchTimeline(entityType, entityId));
      setError('');
    } catch {
      setError('Unable to load the activity timeline.');
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{title}</Text>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.secondary} onPress={() => void load()}>
            <Text style={styles.secondaryText}>Retry</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <Text style={styles.muted}>No activity has been recorded yet.</Text>
      ) : (
        items.map((item) => (
          <View key={item._id} style={styles.entry}>
            <Text style={styles.summary}>{item.summary}</Text>
            {item.detail ? <Text style={styles.muted}>{item.detail}</Text> : null}
            <Text style={styles.meta}>
              {new Date(item.occurredAt).toLocaleString('en-GB')}
              {item.actorName ? ` · ${item.actorName}` : ''}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginTop: 12, gap: 8 },
  heading: { fontWeight: '700', fontSize: 17 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  entry: { borderLeftWidth: 2, borderLeftColor: '#dfeae4', paddingLeft: 12, paddingBottom: 8 },
  summary: { fontWeight: '600' },
  meta: { color: '#718077', fontSize: 12, marginTop: 4 },
  muted: { color: '#718077' },
  error: { color: '#8b2525' },
  secondary: {
    borderWidth: 1,
    borderColor: '#d9e3dd',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  secondaryText: { color: '#16724a', fontWeight: '700' },
});
