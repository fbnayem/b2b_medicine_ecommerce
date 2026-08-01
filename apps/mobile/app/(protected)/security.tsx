import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  describeDevice,
  fetchSessions,
  isRevocable,
  orderSessions,
  revocationLabel,
  revokeEverySession,
  revokeSession,
  type SessionSummary,
} from '../../src/security/api';
import { formatFinanceDate } from '../../src/finance/date';

/**
 * Where this account is signed in, and how to end a session.
 *
 * A phone is the device most likely to be lost or handed to somebody else, so
 * this is the screen that most needs to exist on mobile: until this phase the
 * only way to end a session was to ask an administrator.
 */
export default function SecurityScreen() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    try {
      setSessions(orderSessions(await fetchSessions()));
      setError('');
    } catch (caught) {
      const failure = caught as { response?: { status?: number } };
      setError(
        failure.response?.status === 401
          ? 'This session has ended. Sign in again.'
          : 'Unable to load your sign-ins.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirm = (title: string, message: string, action: () => Promise<void>) => {
    // Ending a session is destructive and cannot be undone from here, so it is
    // always confirmed.
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void action() },
    ]);
  };

  const endOne = (session: SessionSummary) =>
    confirm(
      session.current ? 'Sign out of this device?' : 'Sign out of that device?',
      session.current
        ? 'You will need to sign in again on this device.'
        : `${describeDevice(session.userAgent)} will be signed out immediately.`,
      async () => {
        setBusyId(session._id);
        try {
          await revokeSession(session._id);
          setFeedback(
            session.current ? 'This device was signed out.' : 'That device was signed out.',
          );
          await load();
        } catch {
          setError('Unable to sign that device out.');
        } finally {
          setBusyId('');
        }
      },
    );

  const endAll = () =>
    confirm(
      'Sign out everywhere?',
      'Every device, including this one, will be signed out.',
      async () => {
        setBusyId('all');
        try {
          const revoked = await revokeEverySession();
          setFeedback(`Signed out of ${revoked} device(s).`);
          await load();
        } catch {
          setError('Unable to sign out everywhere.');
        } finally {
          setBusyId('');
        }
      },
    );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading your sign-ins...</Text>
      </View>
    );
  }

  const live = sessions.filter((session) => isRevocable(session));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.secondary} onPress={() => void load()}>
            <Text style={styles.secondaryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {feedback ? (
        <View style={styles.successCard}>
          <Text style={styles.success}>{feedback}</Text>
        </View>
      ) : null}

      <Text style={styles.muted}>
        Sign a device out if you do not recognise it. It stops working immediately, not at the end
        of its sign-in.
      </Text>

      {sessions.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.muted}>There are no recorded sign-ins for this account.</Text>
        </View>
      ) : (
        sessions.map((session) => (
          <View key={session._id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.heading}>{describeDevice(session.userAgent)}</Text>
              {session.current ? <Text style={styles.badge}>This device</Text> : null}
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Signed in</Text>
              <Text style={styles.rowValue}>{formatFinanceDate(session.createdAt)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Last used</Text>
              <Text style={styles.rowValue}>
                {session.lastUsedAt ? formatFinanceDate(session.lastUsedAt) : '—'}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Address</Text>
              <Text style={styles.rowValue}>{session.ipAddress ?? '—'}</Text>
            </View>
            {isRevocable(session) ? (
              <Pressable
                style={styles.danger}
                disabled={busyId !== ''}
                onPress={() => endOne(session)}
              >
                <Text style={styles.dangerText}>
                  {busyId === session._id ? 'Signing out...' : 'Sign out'}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.ended}>{revocationLabel(session.revokedReason)}</Text>
            )}
          </View>
        ))
      )}

      {live.length > 1 ? (
        <Pressable style={styles.danger} disabled={busyId !== ''} onPress={endAll}>
          <Text style={styles.dangerText}>
            {busyId === 'all' ? 'Signing out...' : 'Sign out everywhere'}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 14, gap: 12, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, gap: 6 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  errorCard: { backgroundColor: '#fdecea', padding: 16, borderRadius: 12, gap: 10 },
  successCard: { backgroundColor: '#e7f6ec', padding: 16, borderRadius: 12 },
  heading: { fontWeight: '700', fontSize: 16, flexShrink: 1 },
  badge: { color: '#16724a', fontWeight: '700', fontSize: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f4f2',
  },
  rowLabel: { color: '#4b5a52', flexShrink: 1 },
  rowValue: { fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  ended: { color: '#718077', fontSize: 12, paddingTop: 6 },
  muted: { color: '#718077' },
  error: { color: '#8b2525' },
  success: { color: '#16724a', fontWeight: '600' },
  secondary: {
    borderWidth: 1,
    borderColor: '#d9e3dd',
    backgroundColor: '#fff',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryText: { color: '#16724a', fontWeight: '700' },
  danger: {
    borderWidth: 1,
    borderColor: '#e7c3c3',
    backgroundColor: '#fff',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  dangerText: { color: '#8b2525', fontWeight: '700' },
});
