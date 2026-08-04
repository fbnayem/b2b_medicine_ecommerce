import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { DeliveryProofType } from '@medsupply/shared-types';
import type { Delivery } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { humaniseEnum } from '@medsupply/utilities';
import { neutral } from '@medsupply/design-tokens';
import { apiClient } from '../../src/api/client';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import {
  deliveryCollectionMethods,
  validateDeliveryCollection,
  type DeliveryCollectionMethod,
} from '../../src/finance/collection';
import { formatMoneyMinor } from '../../src/finance/money';
import { FinancePaymentMethod } from '../../src/finance/types';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  ErrorState,
  Field,
  FilterChips,
  Input,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  toast,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

type Point = { x: number; y: number };
type ApiFailure = { response?: { status?: number } };

export default function DeliveryProofScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /**
   * Held across retries, deliberately.
   *
   * A rider at a shop door with one bar of signal will tap Confirm again, and
   * the second attempt must be recognised as the same delivery rather than post
   * a second collection to the customer's account.
   */
  const completionKey = useRef(
    createFinancialIdempotencyKey('delivery-complete', String(id ?? 'unknown')),
  );

  const load = useCallback(async () => {
    try {
      const value: Delivery = (await apiClient.get(`/deliveries/${id}`)).data.data;
      setDelivery(value);
      const pack = typeof value.packageId === 'string' ? undefined : value.packageId;
      setPackageCount(String(pack?.packageCount ?? 1));
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('deliveryDetail.couldNotLoad')));
    } finally {
      setLoading(false);
    }
  }, [id, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

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
      toast.error(t('delivery.cameraNotReady'));
      return;
    }
    const picture = await cameraRef.current?.takePictureAsync({
      base64: true,
      quality: 0.35,
      skipProcessing: false,
    });
    if (!picture?.base64) {
      toast.error(t('delivery.photoFailed'));
      return;
    }
    if (cameraTarget === 'payment') setPaymentPhoto(picture.base64);
    else setPhoto(picture.base64);
    setCameraTarget(undefined);
    setCameraReady(false);
  }

  async function openCamera(target: 'delivery' | 'payment') {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        toast.error(t('delivery.cameraDenied'));
        return;
      }
    }
    setCameraReady(false);
    setCameraTarget(target);
  }

  async function captureLocation() {
    const permissionResult = await Location.requestForegroundPermissionsAsync();
    if (!permissionResult.granted) {
      toast.error(t('delivery.locationDenied'));
      return;
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setGps({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMetres: position.coords.accuracy ?? undefined,
      capturedAt: new Date(position.timestamp).toISOString(),
    });
  }

  async function submit() {
    if (!delivery || submitting) return;
    const required = delivery.proofRequirements;

    /*
     * Still the Bangladesh regex, and still in a screen rather than in the
     * jurisdiction pack. Phase 12 recorded that deliberately: phone validation
     * is one of the three things left for the phase that adds a second country,
     * because abstracting a format against a country nobody has named would be
     * guessing. It is noted here so it is a deferral rather than an oversight.
     */
    if (receiverName.trim().length < 2 || !/^(\+8801|01)[3-9]\d{8}$/.test(receiverPhone)) {
      toast.error(t('delivery.needReceiver'));
      return;
    }
    if (required.includes(DeliveryProofType.OTP) && !/^\d{6}$/.test(otp)) {
      toast.error(t('delivery.needOtp'));
      return;
    }
    if (required.includes(DeliveryProofType.PHOTOGRAPH) && !photo) {
      toast.error(t('delivery.needPhoto'));
      return;
    }
    if (required.includes(DeliveryProofType.SIGNATURE) && !paths.length) {
      toast.error(t('delivery.needSignature'));
      return;
    }
    if (required.includes(DeliveryProofType.GPS) && !gps) {
      toast.error(t('delivery.needLocation'));
      return;
    }

    const count = Number(packageCount.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(count) || count < 1) {
      toast.error(t('delivery.badPackageCount'));
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
      // A key now, not a sentence: these are the four words standing between a
      // rider and a mis-posted collection, and they were English only.
      toast.error(t(collection.error));
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
        toast.success(
          payment
            ? t('delivery.completedWithPayment', {
                reference: payment.reference,
                status: t(`paymentStatus.${payment.status}`),
              })
            : t('delivery.completedNoPayment'),
        );
        setError('');
        router.replace('/(protected)/(tabs)/deliveries');
      } catch (caught) {
        const status = (caught as ApiFailure).response?.status ?? 0;
        if (!(caught as ApiFailure).response || status >= 500) {
          setError(t('delivery.keepOpenAndRetry'));
        } else {
          setError(errorMessage(caught, language, t('delivery.completionRejected')));
        }
      }
    } catch {
      setError(t('delivery.proofFilesFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('deliveryDetail.loading')} />
      </Screen>
    );
  }

  if (!delivery) {
    return (
      <Screen>
        <ErrorState
          message={error || t('deliveryDetail.couldNotLoad')}
          onRetry={() => void load()}
        />
      </Screen>
    );
  }

  const renderedPaths = [...paths, ...(activePath.length ? [activePath] : [])];
  const invoice = typeof delivery.invoiceId === 'string' ? undefined : delivery.invoiceId;

  return (
    <Screen>
      <SectionTitle>{t('delivery.completeTitle', { reference: delivery.reference })}</SectionTitle>

      {/*
       * Consent before capture. Kept as a warning-bordered card rather than an
       * `ErrorState`: nothing has gone wrong, and a red failure box at the top
       * of every delivery would train riders to ignore red boxes.
       */}
      <Card style={{ borderColor: colour.warning }}>
        <Text style={{ color: colour.text }}>{t('delivery.consentNotice')}</Text>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      <Card>
        <SectionTitle>{t('delivery.requiredProof')}</SectionTitle>
        {delivery.proofRequirements.map((requirement) => (
          <ListRow
            key={requirement}
            // Was `proofRequirements.join(', ')` — `OTP, SIGNATURE, GPS`.
            label={t(`deliveryProofType.${requirement}`)}
            value=""
          />
        ))}
      </Card>

      <Field label={t('delivery.receiverName')}>
        <Input
          label={t('delivery.receiverName')}
          value={receiverName}
          onChangeText={setReceiverName}
        />
      </Field>
      <Field label={t('delivery.receiverPhone')}>
        <Input
          label={t('delivery.receiverPhone')}
          value={receiverPhone}
          onChangeText={setReceiverPhone}
          keyboardType="phone-pad"
        />
      </Field>
      <Field label={t('delivery.otp')} hint={t('delivery.otpHint')}>
        <Input
          label={t('delivery.otp')}
          value={otp}
          onChangeText={setOtp}
          keyboardType="number-pad"
          maxLength={6}
        />
      </Field>
      <Field label={t('deliveryDetail.packages')}>
        <Input
          label={t('deliveryDetail.packages')}
          value={packageCount}
          onChangeText={setPackageCount}
          keyboardType="number-pad"
        />
      </Field>

      <Card>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: layout.space[2],
          }}
        >
          <SectionTitle>{t('delivery.receiverName')}</SectionTitle>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('delivery.clearSignature')}
            onPress={() => setPaths([])}
            style={{
              minHeight: layout.minTapTarget,
              justifyContent: 'center',
              paddingHorizontal: layout.space[3],
            }}
          >
            <Text style={{ color: colour.brand, fontWeight: '600' }}>
              {t('delivery.clearSignature')}
            </Text>
          </Pressable>
        </View>
        <View
          ref={signatureRef}
          collapsable={false}
          style={{
            backgroundColor: colour.surface,
            height: 180,
            borderWidth: 1,
            borderColor: colour.border,
            borderRadius: layout.radius.md,
            overflow: 'hidden',
          }}
          {...panResponder.panHandlers}
        >
          <Svg width="100%" height="180">
            {renderedPaths.map((points, index) => (
              <Path
                key={index}
                d={points
                  .map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${point.x},${point.y}`)
                  .join(' ')}
                // Ink, from the token ramp rather than a hand-picked near-black.
                stroke={neutral[900]}
                strokeWidth={3}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </Svg>
          {!renderedPaths.length ? (
            <Text
              style={{
                position: 'absolute',
                alignSelf: 'center',
                top: 78,
                color: colour.textMuted,
              }}
            >
              {t('delivery.signHere')}
            </Text>
          ) : null}
        </View>
      </Card>

      <Card>
        <SectionTitle>{t('delivery.deliveryPhoto')}</SectionTitle>
        {photo ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: `data:image/jpeg;base64,${photo}` }}
            style={{ height: 220, borderRadius: layout.radius.md, resizeMode: 'cover' }}
          />
        ) : null}
        <Button
          variant="secondary"
          label={photo ? t('delivery.retakeDeliveryPhoto') : t('delivery.openDeliveryCamera')}
          onPress={() => void openCamera('delivery')}
        />
      </Card>

      <Card>
        <SectionTitle>{t('deliveryDetail.gps')}</SectionTitle>
        <Text style={{ color: colour.text, fontVariant: ['tabular-nums'] }}>
          {gps
            ? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)} · ±${Math.round(
                gps.accuracyMetres ?? 0,
              )}m`
            : t('delivery.noLocation')}
        </Text>
        <Button
          variant="secondary"
          label={t('delivery.captureLocation')}
          onPress={() => void captureLocation()}
        />
      </Card>

      <Card>
        <SectionTitle>{t('delivery.paymentSection')}</SectionTitle>
        {invoice ? (
          <ListRow
            label={t('delivery.invoiceDue')}
            value={formatMoneyMinor(invoice.amountDueMinor)}
            numeric
          />
        ) : null}
        <Text style={{ color: colour.textMuted }}>{t('delivery.sayWhether')}</Text>
        <FilterChips
          label={t('delivery.paymentSection')}
          value={noPaymentCollected ? 'none' : 'some'}
          onChange={(next) => setNoPaymentCollected(next === 'none')}
          options={[
            { value: 'none', label: t('delivery.noPaymentCollected') },
            { value: 'some', label: t('delivery.paymentCollected') },
          ]}
        />
      </Card>

      {!noPaymentCollected ? (
        <Card>
          <Field label={t('delivery.amountCollected')}>
            <Input
              label={t('delivery.amountCollected')}
              value={collected}
              onChangeText={setCollected}
              keyboardType="decimal-pad"
            />
          </Field>

          <FilterChips
            label={t('delivery.paymentMethod')}
            value={collectionMethod}
            onChange={(next) => setCollectionMethod(next as DeliveryCollectionMethod)}
            options={deliveryCollectionMethods.map((method) => ({
              value: method,
              // Was `method.replaceAll('_', ' ')` — `MOBILE FINANCIAL SERVICE`.
              label: t(`paymentMethod.${method}`),
            }))}
          />

          <Field label={t('delivery.referenceLabel')} hint={t('delivery.referenceNeeded')}>
            <Input
              label={t('delivery.referenceLabel')}
              value={transactionReference}
              onChangeText={setTransactionReference}
              autoCapitalize="characters"
            />
          </Field>

          <SectionTitle>{t('delivery.paymentProof')}</SectionTitle>
          {paymentPhoto ? (
            <Image
              accessibilityIgnoresInvertColors
              source={{ uri: `data:image/jpeg;base64,${paymentPhoto}` }}
              style={{ height: 220, borderRadius: layout.radius.md, resizeMode: 'cover' }}
            />
          ) : null}
          <Button
            variant="secondary"
            label={
              paymentPhoto ? t('delivery.retakePaymentProof') : t('delivery.capturePaymentProof')
            }
            onPress={() => void openCamera('payment')}
          />
        </Card>
      ) : null}

      {cameraTarget ? (
        <Card>
          <SectionTitle>
            {cameraTarget === 'payment' ? t('delivery.paymentProof') : t('delivery.deliveryPhoto')}
          </SectionTitle>
          <CameraView
            ref={cameraRef}
            style={{ height: 330, borderRadius: layout.radius.md, overflow: 'hidden' }}
            facing="back"
            mode="picture"
            onCameraReady={() => setCameraReady(true)}
            onMountError={(event) => setError(humaniseEnum(event.message))}
          />
          <Button label={t('delivery.takePhoto')} onPress={() => void takePhoto()} />
          <Button
            variant="secondary"
            label={t('delivery.closeCamera')}
            onPress={() => {
              setCameraTarget(undefined);
              setCameraReady(false);
            }}
          />
        </Card>
      ) : null}

      <Field label={t('delivery.notes')}>
        <Input
          label={t('delivery.notes')}
          value={notes}
          onChangeText={setNotes}
          multiline
          style={{ minHeight: layout.space[10], paddingTop: layout.space[3] }}
        />
      </Field>

      <Button
        label={t('delivery.confirmDelivery')}
        busy={submitting}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
