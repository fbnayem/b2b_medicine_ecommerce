import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { DeliveryProofType } from '@medsupply/shared-types';
import type { Delivery } from '@medsupply/shared-types';
import { apiClient } from '../../src/api/client';
import {
  deliveryCollectionMethods,
  validateDeliveryCollection,
  type DeliveryCollectionMethod,
} from '../../src/finance/collection';
import { formatMoneyMinor } from '../../src/finance/money';
import { FinancePaymentMethod } from '../../src/finance/types';

type Point = { x: number; y: number };
type ApiFailure = { response?: { status?: number; data?: { error?: { message?: string } } } };

export default function DeliveryProofScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [delivery, setDelivery] = useState<Delivery>();
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [packageCount, setPackageCount] = useState('1');
  const [notes, setNotes] = useState('');
  const [noPaymentCollected, setNoPaymentCollected] = useState(true);
  const [collected, setCollected] = useState('');
  const [collectionMethod, setCollectionMethod] = useState<DeliveryCollectionMethod>(
    FinancePaymentMethod.CASH,
  );
  const [transactionReference, setTransactionReference] = useState('');
  const [paths, setPaths] = useState<Point[][]>([]);
  const [activePath, setActivePath] = useState<Point[]>([]);
  const [photo, setPhoto] = useState<string>();
  const [paymentPhoto, setPaymentPhoto] = useState<string>();
  const [gps, setGps] = useState<{
    latitude: number;
    longitude: number;
    accuracyMetres?: number;
    capturedAt: string;
  }>();
  const [cameraTarget, setCameraTarget] = useState<'delivery' | 'payment'>();
  const [cameraReady, setCameraReady] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const signatureRef = useRef<View>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const completionKey = useRef(
    `mobile-complete-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    apiClient
      .get(`/deliveries/${id}`)
      .then((response) => {
        const value: Delivery = response.data.data;
        setDelivery(value);
        const pack = typeof value.packageId === 'string' ? undefined : value.packageId;
        setPackageCount(String(pack?.packageCount ?? 1));
      })
      .catch(() => setError('Unable to load delivery proof requirements.'));
  }, [id]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) =>
          setActivePath([{ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }]),
        onPanResponderMove: (event) =>
          setActivePath((current) => [
            ...current,
            { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
          ]),
        onPanResponderRelease: () => {
          setActivePath((current) => {
            if (current.length) setPaths((existing) => [...existing, current]);
            return [];
          });
        },
        onPanResponderTerminate: () => setActivePath([]),
      }),
    [],
  );

  async function takePhoto() {
    if (!cameraReady) {
      setError('Wait for the camera preview to become ready.');
      return;
    }
    const picture = await cameraRef.current?.takePictureAsync({
      base64: true,
      quality: 0.35,
      skipProcessing: false,
    });
    if (!picture?.base64) {
      setError('The photograph could not be captured.');
      return;
    }
    if (cameraTarget === 'payment') setPaymentPhoto(picture.base64);
    else setPhoto(picture.base64);
    setCameraTarget(undefined);
    setCameraReady(false);
    setError('');
  }

  async function openCamera(target: 'delivery' | 'payment') {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Camera permission was denied.');
        return;
      }
    }
    setCameraReady(false);
    setCameraTarget(target);
    setError('');
  }

  async function captureLocation() {
    const permissionResult = await Location.requestForegroundPermissionsAsync();
    if (!permissionResult.granted) {
      setError('Location permission was denied. GPS proof cannot be recorded.');
      return;
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setGps({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMetres: position.coords.accuracy ?? undefined,
      capturedAt: new Date(position.timestamp).toISOString(),
    });
    setError('');
  }

  async function submit() {
    if (!delivery) return;
    const required = delivery.proofRequirements;
    if (receiverName.trim().length < 2 || !/^(\+8801|01)[3-9]\d{8}$/.test(receiverPhone)) {
      setError('Enter the receiver name and a valid Bangladesh phone number.');
      return;
    }
    if (required.includes(DeliveryProofType.OTP) && !/^\d{6}$/.test(otp)) {
      setError('Enter the six-digit OTP sent to the shop owner.');
      return;
    }
    if (required.includes(DeliveryProofType.PHOTOGRAPH) && !photo) {
      setError('A delivery photograph is required.');
      return;
    }
    if (required.includes(DeliveryProofType.SIGNATURE) && !paths.length) {
      setError('The receiver signature is required.');
      return;
    }
    if (required.includes(DeliveryProofType.GPS) && !gps) {
      setError('Location proof is required.');
      return;
    }
    const count = Number(packageCount);
    if (!Number.isInteger(count) || count < 1) {
      setError('Enter a valid delivered package count.');
      return;
    }
    const invoice = typeof delivery.invoiceId === 'string' ? undefined : delivery.invoiceId;
    const collection = validateDeliveryCollection(
      {
        noPaymentCollected,
        amount: collected,
        method: collectionMethod,
        transactionReference,
        paymentProof: paymentPhoto
          ? {
              fileName: `${delivery.reference}-payment-proof.jpg`,
              mimeType: 'image/jpeg',
              base64Data: paymentPhoto,
            }
          : undefined,
      },
      invoice?.amountDueMinor,
    );
    if (!collection.ok) {
      setError(collection.error);
      return;
    }
    setSubmitting(true);
    try {
      const signature =
        paths.length && signatureRef.current
          ? await captureRef(signatureRef, { format: 'png', result: 'base64', quality: 0.9 })
          : undefined;
      const body = {
        receiverName: receiverName.trim(),
        receiverPhone,
        otp: otp || undefined,
        signature: signature
          ? {
              fileName: `${delivery.reference}-signature.png`,
              mimeType: 'image/png',
              base64Data: signature,
            }
          : undefined,
        photograph: photo
          ? {
              fileName: `${delivery.reference}-photo.jpg`,
              mimeType: 'image/jpeg',
              base64Data: photo,
            }
          : undefined,
        gps,
        notes: notes || undefined,
        deliveredPackageCount: count,
        ...collection.payload,
      };
      try {
        const response = await apiClient.post<{
          data: Delivery;
          meta?: { payment?: { reference: string; status: string } };
        }>(`/deliveries/${id}/complete`, {
          version: delivery.version,
          idempotencyKey: completionKey.current,
          ...body,
        });
        const payment = response.data.meta?.payment;
        setSuccess(
          payment
            ? `Delivery confirmed. Collection ${payment.reference} is ${payment.status.replaceAll('_', ' ').toLowerCase()}.`
            : 'Delivery completion confirmed by the server. No payment was collected.',
        );
        setError('');
        setTimeout(() => router.replace('/(protected)/(tabs)/deliveries'), 900);
      } catch (caught) {
        const failure = caught as ApiFailure;
        if (!failure.response || (failure.response.status ?? 0) >= 500) {
          setError(
            'Server confirmation is required. Keep this screen open, reconnect, and tap Confirm delivery again; the same idempotency key will be retried.',
          );
        } else setError(failure.response.data?.error?.message ?? 'Completion was rejected.');
      }
    } catch {
      setError('Unable to prepare the proof files.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!delivery)
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || 'Loading proof form...'}</Text>
      </View>
    );
  const renderedPaths = [...paths, ...(activePath.length ? [activePath] : [])];
  const invoice = typeof delivery.invoiceId === 'string' ? undefined : delivery.invoiceId;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Complete {delivery.reference}</Text>
      <Text style={styles.notice}>
        Ask for consent before capturing a photograph, signature, or location. Location is requested
        only when you tap “Capture location”.
      </Text>
      <Text>Required proof: {delivery.proofRequirements.join(', ')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}
      <Field label="Receiver name" value={receiverName} onChangeText={setReceiverName} />
      <Field
        label="Receiver phone"
        value={receiverPhone}
        onChangeText={setReceiverPhone}
        keyboardType="phone-pad"
      />
      <Field
        label="Six-digit OTP"
        value={otp}
        onChangeText={setOtp}
        keyboardType="number-pad"
        maxLength={6}
      />
      <Field
        label="Delivered package count"
        value={packageCount}
        onChangeText={setPackageCount}
        keyboardType="number-pad"
      />
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Receiver signature</Text>
          <Pressable onPress={() => setPaths([])}>
            <Text style={styles.link}>Clear</Text>
          </Pressable>
        </View>
        <View
          ref={signatureRef}
          collapsable={false}
          style={styles.signature}
          {...panResponder.panHandlers}
        >
          <Svg width="100%" height="180">
            {renderedPaths.map((points, index) => (
              <Path
                key={index}
                d={points
                  .map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${point.x},${point.y}`)
                  .join(' ')}
                stroke="#17251e"
                strokeWidth={3}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </Svg>
          {!renderedPaths.length ? <Text style={styles.signHint}>Sign inside this box</Text> : null}
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Delivery photograph</Text>
        {photo ? (
          <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.photo} />
        ) : null}
        <Pressable style={styles.secondary} onPress={() => void openCamera('delivery')}>
          <Text>{photo ? 'Retake delivery photograph' : 'Open camera for delivery proof'}</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>GPS proof</Text>
        <Text>
          {gps
            ? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)} · ±${Math.round(gps.accuracyMetres ?? 0)}m`
            : 'No location captured'}
        </Text>
        <Pressable style={styles.secondary} onPress={() => void captureLocation()}>
          <Text>Capture current location</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Payment collection</Text>
        {invoice ? (
          <Text style={styles.dueText}>
            Invoice due: {formatMoneyMinor(invoice.amountDueMinor)}
          </Text>
        ) : null}
        <Text>Choose explicitly whether any payment was collected.</Text>
        <View style={styles.row}>
          <Pressable
            style={[styles.choice, noPaymentCollected && styles.selected]}
            onPress={() => setNoPaymentCollected(true)}
          >
            <Text style={noPaymentCollected ? styles.selectedText : undefined}>
              No payment collected
            </Text>
          </Pressable>
          <Pressable
            style={[styles.choice, !noPaymentCollected && styles.selected]}
            onPress={() => setNoPaymentCollected(false)}
          >
            <Text style={!noPaymentCollected ? styles.selectedText : undefined}>
              Payment collected
            </Text>
          </Pressable>
        </View>
      </View>
      {!noPaymentCollected ? (
        <View style={styles.card}>
          <Field
            label="Collected amount (৳)"
            value={collected}
            onChangeText={setCollected}
            keyboardType="decimal-pad"
          />
          <Text style={styles.label}>Collection method</Text>
          <View style={styles.row}>
            {deliveryCollectionMethods.map((method) => (
              <Pressable
                key={method}
                style={[styles.choice, collectionMethod === method && styles.selected]}
                onPress={() => setCollectionMethod(method)}
              >
                <Text style={collectionMethod === method ? styles.selectedText : undefined}>
                  {method.replaceAll('_', ' ')}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field
            label="Transaction / cheque reference"
            value={transactionReference}
            onChangeText={setTransactionReference}
          />
          <Text style={styles.label}>Payment proof</Text>
          {paymentPhoto ? (
            <Image
              source={{ uri: `data:image/jpeg;base64,${paymentPhoto}` }}
              style={styles.photo}
            />
          ) : null}
          <Pressable style={styles.secondary} onPress={() => void openCamera('payment')}>
            <Text>{paymentPhoto ? 'Retake payment proof' : 'Capture payment proof'}</Text>
          </Pressable>
          <Text style={styles.safety}>
            Transfer, mobile financial service, and cheque collections require a reference and proof
            photograph.
          </Text>
        </View>
      ) : null}
      {cameraTarget ? (
        <View style={styles.card}>
          <Text style={styles.label}>
            {cameraTarget === 'payment' ? 'Payment proof camera' : 'Delivery proof camera'}
          </Text>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="back"
            mode="picture"
            onCameraReady={() => setCameraReady(true)}
            onMountError={(event) => setError(event.message)}
          />
          <Pressable style={styles.action} onPress={() => void takePhoto()}>
            <Text style={styles.actionText}>Take photograph</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={() => {
              setCameraTarget(undefined);
              setCameraReady(false);
            }}
          >
            <Text>Cancel camera</Text>
          </Pressable>
        </View>
      ) : null}
      <Field label="Delivery notes" value={notes} onChangeText={setNotes} multiline />
      <Pressable
        disabled={submitting}
        style={[styles.action, submitting && styles.disabled]}
        onPress={() => void submit()}
      >
        <Text style={styles.actionText}>
          {submitting ? 'Confirming with server...' : 'Confirm delivery'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad' | 'decimal-pad';
  maxLength?: number;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput style={[styles.input, props.multiline && styles.multiline]} {...props} />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 14, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  heading: { fontSize: 22, fontWeight: '900', color: '#126b45' },
  notice: { backgroundColor: '#fff4d6', padding: 12, borderRadius: 9, lineHeight: 20 },
  card: { backgroundColor: '#fff', padding: 14, borderRadius: 11, gap: 10 },
  field: { gap: 5 },
  label: { fontWeight: '700' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#c7d2cb',
    borderRadius: 8,
    padding: 11,
  },
  multiline: { minHeight: 75, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 7 },
  signature: {
    backgroundColor: '#fff',
    height: 180,
    borderWidth: 1,
    borderColor: '#8fa198',
    borderRadius: 6,
    overflow: 'hidden',
  },
  signHint: { position: 'absolute', alignSelf: 'center', top: 78, color: '#8a9890' },
  link: { color: '#126b45', fontWeight: '700' },
  camera: { height: 330, borderRadius: 8, overflow: 'hidden' },
  photo: { height: 220, borderRadius: 8, resizeMode: 'cover' },
  action: { backgroundColor: '#126b45', padding: 15, borderRadius: 9 },
  actionText: { color: '#fff', fontWeight: '800', textAlign: 'center' },
  secondary: { backgroundColor: '#e6eee9', padding: 11, borderRadius: 8, alignItems: 'center' },
  choice: { borderWidth: 1, borderColor: '#c7d2cb', padding: 8, borderRadius: 18 },
  selected: { backgroundColor: '#183d2d' },
  selectedText: { color: '#fff' },
  dueText: { color: '#8b2525', fontWeight: '800' },
  safety: { color: '#66756d', fontSize: 12, lineHeight: 18 },
  disabled: { opacity: 0.55 },
  error: { color: '#8b2525', backgroundColor: '#fff0ee', padding: 10 },
  success: { color: '#126b45', backgroundColor: '#e9f7ef', padding: 10 },
});
