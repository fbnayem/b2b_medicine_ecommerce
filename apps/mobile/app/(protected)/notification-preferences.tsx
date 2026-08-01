import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { NotificationChannel } from '@medsupply/shared-types';
import {
  effectiveChannels,
  fetchCatalogue,
  fetchPreferences,
  savePreferences,
  toggleChannel,
  toggleMuted,
  type CatalogueEntry,
  type PreferencePayload,
} from '../../src/notifications/api';
import { registerForPush } from '../../src/notifications/push';

export default function NotificationPreferencesScreen() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [preference, setPreference] = useState<PreferencePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pushState, setPushState] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catalogueData, preferenceData] = await Promise.all([
        fetchCatalogue(),
        fetchPreferences(),
      ]);
      setChannels(catalogueData.channels);
      setCatalogue(catalogueData.events);
      setPreference(preferenceData);
      setError('');
    } catch {
      setError('Unable to load notification preferences.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!preference) return;
    setStatus('Saving...');
    try {
      await savePreferences(preference);
      setStatus('Preferences saved.');
      setError('');
    } catch {
      setStatus('');
      setError('Unable to save preferences.');
    }
  };

  const enablePush = async () => {
    setPushState('Requesting permission...');
    const outcome = await registerForPush();
    if (outcome.status === 'REGISTERED') setPushState('This device is registered for push.');
    else if (outcome.status === 'DENIED')
      setPushState('Push permission was declined. Enable it in the device settings.');
    else setPushState(outcome.reason);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading preferences...</Text>
      </View>
    );
  }

  if (!preference) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || 'Preferences are unavailable.'}</Text>
        <Pressable style={styles.secondary} onPress={() => void load()}>
          <Text style={styles.secondaryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.success}>{status}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.heading}>Push on this device</Text>
        <Text style={styles.muted}>
          Registering stores this device's push token against your account. Signing out removes it.
        </Text>
        <Pressable style={styles.primary} onPress={() => void enablePush()}>
          <Text style={styles.primaryText}>Enable push on this device</Text>
        </Pressable>
        {pushState ? <Text style={styles.muted}>{pushState}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Quiet hours (Asia/Dhaka)</Text>
        <Text style={styles.muted}>
          Push, SMS and WhatsApp are held during quiet hours. Email still arrives and critical
          alerts such as delivery verification codes always come through.
        </Text>
        <View style={styles.row}>
          <Text>Enable quiet hours</Text>
          <Switch
            value={preference.quietHours.enabled}
            onValueChange={(value) =>
              setPreference({
                ...preference,
                quietHours: { ...preference.quietHours, enabled: value },
              })
            }
          />
        </View>
        <Text style={styles.muted}>
          {preference.quietHours.start} to {preference.quietHours.end}. Adjust the exact window on
          the web application.
        </Text>
      </View>

      <Text style={styles.heading}>Channels by event</Text>
      {catalogue.map((entry) => {
        const muted = preference.mutedEvents.includes(entry.event);
        const active = effectiveChannels(entry, preference);
        return (
          <View key={entry.event} style={[styles.card, muted ? styles.mutedCard : null]}>
            <View style={styles.row}>
              <Text style={styles.eventTitle}>{entry.event.replaceAll('_', ' ')}</Text>
              <Switch
                value={!muted}
                accessibilityLabel={`Notifications for ${entry.event}`}
                onValueChange={() => setPreference(toggleMuted(entry, preference))}
              />
            </View>
            <Text style={styles.muted}>
              {entry.category} · {entry.priority}
            </Text>
            <View style={styles.chips}>
              {channels.map((channel) => {
                const on = active.includes(channel);
                return (
                  <Pressable
                    key={channel}
                    disabled={muted}
                    accessibilityRole="button"
                    accessibilityLabel={`${channel} for ${entry.event}`}
                    accessibilityState={{ selected: on, disabled: muted }}
                    style={[styles.chip, on ? styles.chipOn : null, muted ? styles.chipOff : null]}
                    onPress={() => setPreference(toggleChannel(entry, preference, channel))}
                  >
                    <Text style={on ? styles.chipOnText : styles.chipText}>{channel}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}

      <Text style={styles.muted}>
        In-app notifications are always delivered and cannot be switched off.
      </Text>
      <Pressable style={styles.primary} onPress={() => void save()}>
        <Text style={styles.primaryText}>Save preferences</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => void load()}>
        <Text style={styles.secondaryText}>Discard changes</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 14, gap: 12, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, gap: 8 },
  mutedCard: { opacity: 0.6 },
  heading: { fontWeight: '700', fontSize: 17 },
  eventTitle: { fontWeight: '700', fontSize: 15, flexShrink: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d9e3dd',
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: '#16724a', borderColor: '#16724a' },
  chipOff: { opacity: 0.5 },
  chipText: { color: '#17211b', fontWeight: '600' },
  chipOnText: { color: '#fff', fontWeight: '700' },
  primary: {
    backgroundColor: '#16724a',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: {
    borderWidth: 1,
    borderColor: '#d9e3dd',
    backgroundColor: '#fff',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryText: { color: '#16724a', fontWeight: '700' },
  muted: { color: '#718077' },
  error: { color: '#8b2525' },
  success: { color: '#16724a' },
});
