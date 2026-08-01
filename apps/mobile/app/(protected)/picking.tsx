import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, router } from 'expo-router';
import { apiClient } from '../../src/api/client';
import {
  buildPackingConfirmation,
  buildPickingProgress,
  findLineForBarcode,
} from '../../src/fulfilment/flow';

type PickingItem = {
  _id: string;
  medicineId: { _id: string; brandName: string; barcode?: string };
  batchId: string;
  quantity: number;
  pickedQuantity: number;
};
type PickingList = {
  _id: string;
  status: string;
  version: number;
  items: PickingItem[];
  orderId: { reference: string };
};
type ApiFailure = { response?: { data?: { error?: { message?: string } } } };
const discrepancyTypes = [
  'MISSING_QUANTITY',
  'DAMAGED_ITEM',
  'WRONG_BATCH',
  'EXPIRED_BATCH',
  'STOCK_MISMATCH',
  'PRODUCT_UNAVAILABLE',
  'OTHER',
] as const;

export default function PickingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [list, setList] = useState<PickingList>();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [barcode, setBarcode] = useState('');
  const [packageCount, setPackageCount] = useState('1');
  const [weightGrams, setWeightGrams] = useState('');
  const [discrepancyType, setDiscrepancyType] =
    useState<(typeof discrepancyTypes)[number]>('MISSING_QUANTITY');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [confirmedCodes, setConfirmedCodes] = useState<string[]>([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      const value: PickingList = (await apiClient.get(`/fulfilment/picking/${id}`)).data.data;
      setList(value);
      setQuantities(
        Object.fromEntries(
          value.items.map((item) => [item._id, String(item.pickedQuantity || item.quantity)]),
        ),
      );
      setError('');
    } catch {
      setError('Unable to load picking list.');
    }
  }

  useEffect(() => {
    void load();
  }, [id]);
  const failure = (caught: unknown, fallback: string) =>
    (caught as ApiFailure).response?.data?.error?.message ?? fallback;

  function confirmBarcode(value: string) {
    const normalized = value.trim();
    const match = list ? findLineForBarcode(list.items, normalized) : undefined;
    if (!match) {
      setError('The scanned code does not match an allocated medicine or batch.');
      return;
    }
    setConfirmedCodes((current) => Array.from(new Set([...current, match._id])));
    setBarcode(normalized);
    setScannerOpen(false);
    setError('');
  }

  async function openScanner() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Camera permission denied. Use manual confirmation below.');
        return;
      }
    }
    setScannerOpen(true);
  }

  async function start() {
    if (!list) return;
    try {
      await apiClient.post(`/fulfilment/picking/${id}/start`, { version: list.version });
      await load();
    } catch (caught: unknown) {
      setError(failure(caught, 'Unable to start picking.'));
    }
  }

  async function progress(action: 'SAVE' | 'PAUSE' | 'COMPLETE') {
    if (!list) return;
    try {
      await apiClient.post(
        `/fulfilment/picking/${id}/progress`,
        buildPickingProgress(list.version, list.items, quantities, action),
      );
      await load();
    } catch (caught: unknown) {
      setError(failure(caught, 'Unable to update picking.'));
    }
  }

  async function resume() {
    if (!list) return;
    try {
      await apiClient.post(`/fulfilment/picking/${id}/resume`, { version: list.version });
      await load();
    } catch (caught: unknown) {
      setError(failure(caught, 'Unable to resume picking.'));
    }
  }

  async function discrepancy() {
    if (!list?.items[0] || reason.length < 3) {
      setError('Enter a reason before reporting a discrepancy.');
      return;
    }
    try {
      await apiClient.post(`/fulfilment/picking/${id}/discrepancies`, {
        version: list.version,
        type: discrepancyType,
        medicineId: list.items[0].medicineId._id,
        batchId: list.items[0].batchId,
        quantity: 0,
        notes: reason,
      });
      router.back();
    } catch (caught: unknown) {
      setError(failure(caught, 'Unable to report discrepancy.'));
    }
  }

  async function pack() {
    if (!list) return;
    try {
      await apiClient.post(
        `/fulfilment/picking/${id}/pack`,
        buildPackingConfirmation(
          list.version,
          list.items,
          quantities,
          reason,
          barcode,
          Number(packageCount),
          weightGrams ? Number(weightGrams) : undefined,
        ),
      );
      Alert.alert('Packed', 'Invoice and package created from actual packed quantities.');
      router.back();
    } catch (caught: unknown) {
      setError(failure(caught, 'Packing failed.'));
    }
  }

  if (!list)
    return (
      <View style={styles.center}>
        <Text>{error || 'Loading...'}</Text>
      </View>
    );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.reference}>{list.orderId.reference}</Text>
      <Text style={styles.heading}>{list.status.replaceAll('_', ' ')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {list.items.map((item) => (
        <View style={styles.card} key={item._id}>
          <Text style={styles.title}>{item.medicineId.brandName}</Text>
          <Text>Batch: {item.batchId}</Text>
          <Text>Allocated: {item.quantity}</Text>
          <Text>
            {confirmedCodes.includes(item._id)
              ? 'Barcode confirmed'
              : 'Manual quantity confirmation available'}
          </Text>
          {list.status === 'PICKING' || list.status === 'PACKING' ? (
            <TextInput
              accessibilityLabel={`${list.status === 'PACKING' ? 'Packed' : 'Picked'} quantity for ${item.medicineId.brandName}`}
              style={styles.input}
              keyboardType="number-pad"
              value={quantities[item._id] ?? ''}
              onChangeText={(value) =>
                setQuantities((current) => ({ ...current, [item._id]: value }))
              }
            />
          ) : (
            <Text>Picked: {item.pickedQuantity}</Text>
          )}
        </View>
      ))}
      {['PICKING', 'PAUSED', 'PACKING'].includes(list.status) ? (
        <>
          <Text style={styles.label}>Barcode confirmation</Text>
          {scannerOpen ? (
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'qr'] }}
              onBarcodeScanned={({ data }) => confirmBarcode(data)}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() => void openScanner()}
          >
            <Text>Scan with camera</Text>
          </Pressable>
          <TextInput
            accessibilityLabel="Medicine or batch barcode"
            style={styles.input}
            placeholder="Enter medicine barcode or batch ID"
            value={barcode}
            onChangeText={setBarcode}
          />
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() => confirmBarcode(barcode)}
          >
            <Text>Confirm code manually</Text>
          </Pressable>
          <TextInput
            accessibilityLabel="Shortfall or discrepancy reason"
            style={styles.notes}
            placeholder="Required shortfall/discrepancy reason"
            multiline
            value={reason}
            onChangeText={setReason}
          />
        </>
      ) : null}
      {list.status === 'PENDING' ? (
        <Pressable accessibilityRole="button" style={styles.primary} onPress={() => void start()}>
          <Text style={styles.primaryText}>Start picking</Text>
        </Pressable>
      ) : null}
      {list.status === 'PICKING' ? (
        <>
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() => void progress('SAVE')}
          >
            <Text>Save progress</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() => void progress('PAUSE')}
          >
            <Text>Pause picking</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.primary}
            onPress={() => void progress('COMPLETE')}
          >
            <Text style={styles.primaryText}>Complete picking</Text>
          </Pressable>
        </>
      ) : null}
      {list.status === 'PAUSED' ? (
        <Pressable accessibilityRole="button" style={styles.primary} onPress={() => void resume()}>
          <Text style={styles.primaryText}>Resume picking</Text>
        </Pressable>
      ) : null}
      {list.status === 'PACKING' ? (
        <>
          <Text style={styles.label}>Package count</Text>
          <TextInput
            accessibilityLabel="Package count"
            style={styles.input}
            keyboardType="number-pad"
            value={packageCount}
            onChangeText={setPackageCount}
          />
          <Text style={styles.label}>Weight in grams (optional)</Text>
          <TextInput
            accessibilityLabel="Package weight in grams"
            style={styles.input}
            keyboardType="number-pad"
            value={weightGrams}
            onChangeText={setWeightGrams}
          />
          <Pressable accessibilityRole="button" style={styles.primary} onPress={() => void pack()}>
            <Text style={styles.primaryText}>Confirm packing</Text>
          </Pressable>
        </>
      ) : null}
      {['PICKING', 'PAUSED', 'PACKING'].includes(list.status) ? (
        <>
          <Text style={styles.label}>Discrepancy type</Text>
          <View style={styles.typeGrid}>
            {discrepancyTypes.map((type) => (
              <Pressable
                key={type}
                accessibilityRole="button"
                style={[styles.typeButton, discrepancyType === type && styles.typeSelected]}
                onPress={() => setDiscrepancyType(type)}
              >
                <Text style={discrepancyType === type ? styles.typeSelectedText : undefined}>
                  {type.replaceAll('_', ' ')}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() => void discrepancy()}
          >
            <Text>Report discrepancy</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reference: { color: '#126b45' },
  heading: { fontSize: 23, fontWeight: '800' },
  card: { backgroundColor: '#fff', padding: 14, borderRadius: 10, marginTop: 10 },
  title: { fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#bdcbc2', borderRadius: 8, padding: 10, marginTop: 8 },
  notes: { backgroundColor: '#fff', minHeight: 80, padding: 12, marginTop: 12 },
  label: { fontWeight: '700', marginTop: 15 },
  camera: { height: 260, marginTop: 10, borderRadius: 10, overflow: 'hidden' },
  primary: { backgroundColor: '#126b45', padding: 14, borderRadius: 9, marginTop: 12 },
  primaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  secondary: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 9,
    marginTop: 10,
    alignItems: 'center',
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  typeButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#bdcbc2',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  typeSelected: { backgroundColor: '#126b45', borderColor: '#126b45' },
  typeSelectedText: { color: '#fff' },
  error: { color: '#8b2525', padding: 10 },
});
