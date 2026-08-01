import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  DeliveryFailureReason,
  DeliveryStatus,
  RealtimeEvent,
  UserRole,
} from '@medsupply/shared-types';
import type { Delivery } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';
import { isSafeOfflineDeliveryAction, queueDeliveryAction } from '../../src/delivery/offlineQueue';
import { useAuthStore } from '../../src/store/useAuth';
import { ActivityTimelineView } from '../../src/notifications/ActivityTimelineView';
import { onRealtime } from '../../src/notifications/realtime';

type ApiFailure = { response?: { status?: number; data?: { error?: { message?: string } } } };
const reasons = Object.values(DeliveryFailureReason);

export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useAuthStore((state) => state.user?.role);
  const isDriver = role === UserRole.DELIVERY_PERSON;
  const isStorekeeper = role === UserRole.STOREKEEPER;
  const canManageReturn =
    role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN || role === UserRole.MANAGER;
  const [delivery, setDelivery] = useState<Delivery>();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [failureReason, setFailureReason] = useState<DeliveryFailureReason>(
    DeliveryFailureReason.SHOP_CLOSED,
  );
  const [failureNotes, setFailureNotes] = useState('');
  const load = useCallback(async () => {
    try {
      setDelivery((await apiClient.get(`/deliveries/${id}`)).data.data);
      setError('');
    } catch {
      setError('Unable to load this delivery. Return to the list to use cached assignments.');
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  // A storekeeper handover or manager reassignment refreshes this screen live.
  useEffect(
    () =>
      onRealtime(RealtimeEvent.DELIVERY_UPDATED, (payload) => {
        if ((payload as { entityId?: string })?.entityId === id) void load();
      }),
    [id, load],
  );
  async function action(path: string, body: Record<string, unknown>, confirmation: string) {
    if (!delivery) return;
    try {
      await apiClient.post(`/deliveries/${id}/${path}`, {
        version: delivery.version,
        idempotencyKey: `mobile-${path}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...body,
      });
      setSuccess(confirmation);
      setError('');
      await load();
    } catch (caught) {
      const failure = caught as ApiFailure;
      if (
        (!failure.response || (failure.response.status ?? 0) >= 500) &&
        isSafeOfflineDeliveryAction(path)
      ) {
        await queueDeliveryAction(delivery._id, path, delivery.version, body);
        setSuccess(
          'Action saved offline. The delivery is not complete until the server confirms it.',
        );
      } else if (!failure.response || (failure.response.status ?? 0) >= 500) {
        setError('This action requires an immediate server response. Reconnect and retry.');
      } else setError(failure.response.data?.error?.message ?? 'Action was rejected.');
    }
  }
  if (!delivery)
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || 'Loading delivery...'}</Text>
        <Pressable style={styles.secondary} onPress={() => void load()}>
          <Text>Retry</Text>
        </Pressable>
      </View>
    );
  const pack = typeof delivery.packageId === 'string' ? undefined : delivery.packageId;
  const invoice = typeof delivery.invoiceId === 'string' ? undefined : delivery.invoiceId;
  const address = `${delivery.addressSnapshot.line1}, ${delivery.addressSnapshot.city}, ${delivery.addressSnapshot.district}`;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.reference}>{delivery.reference}</Text>
        <Text style={styles.status}>{delivery.status.replaceAll('_', ' ')}</Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}
      <View style={styles.card}>
        <Text style={styles.title}>{delivery.contactSnapshot.name}</Text>
        <Text>{delivery.contactSnapshot.phone}</Text>
        <Text>{address}</Text>
        <Text>
          {pack?.reference} · {pack?.packageCount} package(s)
        </Text>
        <Text>{invoice?.reference}</Text>
        {delivery.instructions ? (
          <Text style={styles.instructions}>Instruction: {delivery.instructions}</Text>
        ) : null}
        <View style={styles.row}>
          <Pressable
            style={styles.secondary}
            onPress={() => void Linking.openURL(`tel:${delivery.contactSnapshot.phone}`)}
          >
            <Text>Call shop</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={() =>
              void Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
              )
            }
          >
            <Text>Open map</Text>
          </Pressable>
        </View>
      </View>
      {isStorekeeper && delivery.status === DeliveryStatus.ASSIGNED && pack && invoice ? (
        <Action
          label="Confirm store handover"
          onPress={() =>
            void action(
              'handover',
              {
                packageReference: pack.reference,
                invoiceReference: invoice.reference,
                packageCount: pack.packageCount,
              },
              'Package handover confirmed.',
            )
          }
        />
      ) : null}
      {isStorekeeper && delivery.status === DeliveryStatus.RETURNING ? (
        <Action
          label="Confirm package returned to store"
          onPress={() => void action('returned', {}, 'Returned package accepted.')}
        />
      ) : null}
      {isDriver &&
      delivery.status === DeliveryStatus.HANDED_OVER &&
      !delivery.handover?.acknowledgedAt ? (
        <Action
          label="Acknowledge package receipt"
          onPress={() => void action('acknowledge', {}, 'Handover acknowledged.')}
        />
      ) : null}
      {isDriver &&
      delivery.status === DeliveryStatus.HANDED_OVER &&
      delivery.handover?.acknowledgedAt ? (
        <Action
          label="Confirm pickup"
          onPress={() => void action('pickup', {}, 'Pickup confirmed.')}
        />
      ) : null}
      {isDriver && delivery.status === DeliveryStatus.PICKED_UP ? (
        <Action
          label="Start delivery route"
          onPress={() => void action('start', {}, 'Delivery route started.')}
        />
      ) : null}
      {isDriver && delivery.status === DeliveryStatus.OUT_FOR_DELIVERY ? (
        <Action
          label="I have arrived"
          onPress={() => void action('arrived', {}, 'Arrival recorded.')}
        />
      ) : null}
      {isDriver && delivery.status === DeliveryStatus.ARRIVED ? (
        <View style={styles.card}>
          <Text style={styles.title}>At the shop</Text>
          <Action
            label="Send / resend receiver OTP"
            onPress={() => void action('send-otp', {}, 'OTP sent to the shop owner.')}
          />
          <Action
            label="Capture proof and complete"
            onPress={() =>
              router.push({ pathname: '/(protected)/delivery-proof', params: { id: delivery._id } })
            }
          />
        </View>
      ) : null}
      {isDriver &&
      [
        DeliveryStatus.ASSIGNED,
        DeliveryStatus.HANDED_OVER,
        DeliveryStatus.PICKED_UP,
        DeliveryStatus.OUT_FOR_DELIVERY,
        DeliveryStatus.ARRIVED,
      ].includes(delivery.status as typeof DeliveryStatus.ASSIGNED) ? (
        <View style={styles.card}>
          <Text style={styles.title}>Report failed delivery</Text>
          <Text style={styles.label}>Reason</Text>
          <View style={styles.wrap}>
            {reasons.map((reason) => (
              <Pressable
                key={reason}
                style={[styles.choice, failureReason === reason && styles.selected]}
                onPress={() => setFailureReason(reason)}
              >
                <Text style={failureReason === reason ? styles.selectedText : undefined}>
                  {reason.replaceAll('_', ' ')}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={failureNotes}
            onChangeText={setFailureNotes}
            placeholder="Required notes"
            multiline
          />
          <Pressable
            style={styles.danger}
            onPress={() =>
              failureNotes.trim().length >= 3
                ? void action(
                    'fail',
                    { reason: failureReason, notes: failureNotes.trim() },
                    'Failure reported to management.',
                  )
                : setError('Enter at least three characters of notes.')
            }
          >
            <Text style={styles.actionText}>Report failure</Text>
          </Pressable>
        </View>
      ) : null}
      {(isDriver || canManageReturn) && delivery.status === DeliveryStatus.FAILED ? (
        <Action
          label="Start return to store"
          onPress={() => void action('returning', {}, 'Return trip started.')}
        />
      ) : null}
      <View style={styles.card}>
        <Text style={styles.title}>Timeline</Text>
        {delivery.history.map((entry, index) => (
          <View style={styles.timeline} key={`${entry.to}-${index}`}>
            <Text style={styles.timelineTitle}>{entry.to.replaceAll('_', ' ')}</Text>
            <Text>{new Date(entry.at).toLocaleString('en-BD')}</Text>
          </View>
        ))}
      </View>
      <ActivityTimelineView
        entityType="Delivery"
        entityId={String(delivery._id)}
        title="Delivery activity"
      />
    </ScrollView>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={styles.action} onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 14, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  heading: { flexDirection: 'row', justifyContent: 'space-between' },
  reference: { fontWeight: '900', color: '#126b45', fontSize: 20 },
  status: { fontSize: 12 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, gap: 9 },
  title: { fontWeight: '800', fontSize: 18 },
  instructions: { backgroundColor: '#fff4d6', padding: 9 },
  row: { flexDirection: 'row', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  label: { fontWeight: '700' },
  choice: { borderWidth: 1, borderColor: '#ccd8d0', padding: 8, borderRadius: 20 },
  selected: { backgroundColor: '#183d2d' },
  selectedText: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#c7d2cb', borderRadius: 8, padding: 11, minHeight: 70 },
  action: { backgroundColor: '#126b45', padding: 14, borderRadius: 9, marginVertical: 3 },
  actionText: { color: '#fff', fontWeight: '800', textAlign: 'center' },
  secondary: { backgroundColor: '#e6eee9', padding: 11, borderRadius: 8 },
  danger: { backgroundColor: '#8b2525', padding: 14, borderRadius: 9 },
  error: { color: '#8b2525', backgroundColor: '#fff0ee', padding: 10 },
  success: { color: '#126b45', backgroundColor: '#e9f7ef', padding: 10 },
  timeline: { borderBottomWidth: 1, borderBottomColor: '#e5ece8', paddingVertical: 8 },
  timelineTitle: { fontWeight: '700' },
});
