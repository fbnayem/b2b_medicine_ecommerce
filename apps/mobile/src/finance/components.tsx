import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export function FinanceState({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading?: boolean;
  error?: string;
  empty?: string;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#126b45" />
        <Text style={styles.muted}>Loading financial data…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
        {onRetry ? (
          <Pressable accessibilityRole="button" style={styles.retry} onPress={onRetry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (empty) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{empty}</Text>
      </View>
    );
  }
  return null;
}

export function FinanceCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function StatusBadge({ value }: { value: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{value.replaceAll('_', ' ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    minHeight: 180,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 22,
  },
  muted: { color: '#66756d', textAlign: 'center' },
  error: {
    color: '#8b2525',
    backgroundColor: '#fff0ee',
    padding: 12,
    borderRadius: 8,
    textAlign: 'center',
  },
  retry: {
    backgroundColor: '#126b45',
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  retryText: { color: '#fff', fontWeight: '800' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 12, gap: 7 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e6eee9',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: { color: '#274b3b', fontWeight: '700', fontSize: 11 },
});
