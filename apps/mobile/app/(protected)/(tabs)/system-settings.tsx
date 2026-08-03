import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  fetchEffectiveSettings,
  SOURCE_LABELS,
  toRows,
  type EffectiveSettings,
} from '../../../src/settings/api';

const GROUP_LABELS: Record<string, string> = {
  business: 'Business identity',
  finance: 'Finance and credit',
  inventory: 'Inventory thresholds',
  delivery: 'Delivery proof',
  notifications: 'Notification defaults',
  localisation: 'Localisation',
  security: 'Security policy',
};

/**
 * Read-only view of what is actually in force. Editing lives on the web
 * application, which Super Admins and Admins have full access to; showing the
 * values here means an administrator in the field can confirm configuration
 * without guessing.
 */
export default function SystemSettingsScreen() {
  const [data, setData] = useState<EffectiveSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchEffectiveSettings());
      setError('');
    } catch (caught) {
      const failure = caught as { response?: { status?: number } };
      setError(
        failure.response?.status === 403
          ? 'Your role cannot view system settings.'
          : 'Unable to load system settings.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading system settings...</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || 'System settings are unavailable.'}</Text>
        <Pressable style={styles.secondary} onPress={() => void load()}>
          <Text style={styles.secondaryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.muted}>
        These values are in force now. Change them on the web application.
      </Text>
      {Object.entries(GROUP_LABELS).map(([group, label]) => {
        const values = (data.settings as unknown as Record<string, Record<string, unknown>>)[group];
        if (!values) return null;
        return (
          <View key={group} style={styles.card}>
            <Text style={styles.heading}>{label}</Text>
            <Text style={styles.source}>
              {SOURCE_LABELS[data.sources[group]] ?? data.sources[group]}
            </Text>
            {toRows(values).map((row) => (
              <View key={row.label} style={styles.row}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        );
      })}
      <Pressable style={styles.secondary} onPress={() => void load()}>
        <Text style={styles.secondaryText}>Reload</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 14, gap: 12, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, gap: 6 },
  heading: { fontWeight: '700', fontSize: 17 },
  source: { color: '#718077', fontSize: 12, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f4f2',
  },
  rowLabel: { color: '#4b5a52', flexShrink: 1 },
  rowValue: { fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  muted: { color: '#718077' },
  error: { color: '#8b2525' },
  secondary: {
    borderWidth: 1,
    borderColor: '#d9e3dd',
    backgroundColor: '#fff',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryText: { color: '#16724a', fontWeight: '700' },
});
