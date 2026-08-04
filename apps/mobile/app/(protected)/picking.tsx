import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, router } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import {
  buildPackingConfirmation,
  buildPickingProgress,
  findLineForBarcode,
} from '../../src/fulfilment/flow';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

interface PickingItem {
  _id: string;
  medicineId: { _id: string; brandName: string; barcode?: string };
  batchId: string;
  quantity: number;
  pickedQuantity: number;
}

interface PickingList {
  _id: string;
  status: string;
  version: number;
  items: PickingItem[];
  orderId: { reference: string };
  /**
   * Sent alongside the items rather than populated over `batchId`, because the
   * client posts that id straight back when recording progress. This screen
   * ignored it and rendered the 24-character id at the picker — U11 verbatim,
   * fixed on the web client and still live here.
   */
  batchNumbers?: Record<string, { batchNumber: string; expiryDate: string }>;
}

/** Local to fulfilment; there is no shared enum for these. */
const DISCREPANCY_TYPES = [
  'MISSING_QUANTITY',
  'DAMAGED_ITEM',
  'WRONG_BATCH',
  'EXPIRED_BATCH',
  'STOCK_MISMATCH',
  'PRODUCT_UNAVAILABLE',
  'OTHER',
] as const;

const WORKING = ['PICKING', 'PAUSED', 'PACKING'];

export default function PickingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [permission, requestPermission] = useCameraPermissions();

  const [list, setList] = useState<PickingList>();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [shortfall, setShortfall] = useState('');
  const [barcode, setBarcode] = useState('');
  const [packageCount, setPackageCount] = useState('1');
  const [weightGrams, setWeightGrams] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [confirmedLines, setConfirmedLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const value: PickingList = (await apiClient.get(`/fulfilment/picking/${id}`)).data.data;
      setList(value);
      setQuantities(
        Object.fromEntries(
          value.items.map((item) => [item._id, String(item.pickedQuantity || item.quantity)]),
        ),
      );
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('picking.couldNotLoad')));
    } finally {
      setLoading(false);
    }
  }, [id, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const batchNumber = (item: PickingItem) => list?.batchNumbers?.[item.batchId]?.batchNumber ?? '—';

  async function post(
    path: string,
    body: Record<string, unknown>,
    done: string,
    fallback: string,
    andBack = false,
  ) {
    if (busy) return;
    setBusy(path);
    try {
      await apiClient.post(`/fulfilment/picking/${id}/${path}`, body);
      toast.success(done);
      if (andBack) router.back();
      else await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, fallback));
    } finally {
      setBusy('');
    }
  }

  function confirmBarcode(value: string) {
    const code = value.trim();
    const match = list ? findLineForBarcode(list.items, code) : undefined;
    if (!match) {
      toast.error(t('picking.codeNoMatch'));
      return;
    }
    setConfirmedLines((current) => Array.from(new Set([...current, match._id])));
    setBarcode(code);
    setScannerOpen(false);
    toast.success(t('picking.codeConfirmed'));
  }

  async function openScanner() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        toast.error(t('picking.cameraDenied'));
        return;
      }
    }
    setScannerOpen(true);
  }

  /**
   * A problem, recorded against the line it is actually on.
   *
   * This posted `items[0]` — the *first* line — whatever the picker was looking
   * at, so a damaged item on line four was filed against line one's medicine and
   * line one's batch. That record is what management reads to decide whether to
   * re-pick, adjust stock or quarantine it, and it named the wrong carton.
   */
  async function reportDiscrepancy(item: PickingItem) {
    if (!list) return;
    const type = await ask.choose({
      title: t('picking.reportTitle'),
      description: `${item.medicineId.brandName} · ${batchNumber(item)}`,
      options: DISCREPANCY_TYPES.map((value) => ({
        value,
        label: t(`discrepancyType.${value}`),
      })),
    });
    if (!type) return;

    const affected = await ask.prompt({
      title: t('picking.affectedQuantity'),
      label: t('picking.affectedQuantity'),
      numeric: true,
      initialValue: '0',
      confirmLabel: t('actions.confirm'),
      validate: (value) =>
        Number.isInteger(Number(value)) && Number(value) >= 0 ? null : t('inventory.badQuantity'),
    });
    if (affected === null) return;

    const notes = await ask.prompt({
      title: t(`discrepancyType.${type}`),
      description: t('picking.reportTitle'),
      label: t('fields.notes'),
      multiline: true,
      confirmLabel: t('picking.report'),
      danger: true,
      validate: (value) => (value.trim().length >= 3 ? null : t('picking.needNotes')),
    });
    if (!notes) return;

    await post(
      'discrepancies',
      {
        version: list.version,
        type,
        medicineId: item.medicineId._id,
        batchId: item.batchId,
        quantity: Number(affected),
        notes,
      },
      t('picking.reported'),
      t('picking.reportFailed'),
    );
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('picking.loading')} />
      </Screen>
    );
  }

  if (!list) {
    return (
      <Screen>
        <ErrorState message={error || t('picking.couldNotLoad')} onRetry={() => void load()} />
      </Screen>
    );
  }

  const working = WORKING.includes(list.status);
  const editing = list.status === 'PICKING' || list.status === 'PACKING';

  return (
    <Screen>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Card>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: layout.space[2],
          }}
        >
          <SectionTitle>{list.orderId.reference}</SectionTitle>
          {/* Was `status.replaceAll('_', ' ')` — `BLOCKED DISCREPANCY`. */}
          <Badge tone={list.status === 'PACKED' ? 'success' : 'info'}>
            {t(`pickingStatus.${list.status}`)}
          </Badge>
        </View>
      </Card>

      <SectionTitle>{t('picking.allocated')}</SectionTitle>
      {list.items.map((item) => (
        <Card key={item._id}>
          <Text style={{ fontSize: layout.fontSize.base, fontWeight: '600', color: colour.text }}>
            {item.medicineId.brandName}
          </Text>
          {/* The number printed on the carton, which is what a picker can check. */}
          <ListRow label={t('fields.batch')} value={batchNumber(item)} />
          <ListRow label={t('picking.columnAllocated')} value={item.quantity} numeric />
          <Badge tone={confirmedLines.includes(item._id) ? 'success' : 'neutral'}>
            {confirmedLines.includes(item._id)
              ? t('picking.confirmedByScan')
              : t('picking.notYetConfirmed')}
          </Badge>

          {editing ? (
            <Field
              label={
                list.status === 'PACKING'
                  ? t('picking.packedFor', { brand: item.medicineId.brandName })
                  : t('picking.pickedFor', { brand: item.medicineId.brandName })
              }
            >
              <Input
                label={
                  list.status === 'PACKING'
                    ? t('picking.packedFor', { brand: item.medicineId.brandName })
                    : t('picking.pickedFor', { brand: item.medicineId.brandName })
                }
                keyboardType="number-pad"
                value={quantities[item._id] ?? ''}
                onChangeText={(value) =>
                  setQuantities((current) => ({ ...current, [item._id]: value }))
                }
              />
            </Field>
          ) : (
            <ListRow label={t('picking.columnPicked')} value={item.pickedQuantity} numeric />
          )}

          {working ? (
            <Button
              variant="secondary"
              label={t('picking.reportOnLine', { brand: item.medicineId.brandName })}
              disabled={busy !== ''}
              onPress={() => void reportDiscrepancy(item)}
            />
          ) : null}
        </Card>
      ))}

      {working ? (
        <Card>
          <SectionTitle>{t('fulfilment.barcodeLabel')}</SectionTitle>
          {scannerOpen ? (
            <>
              <CameraView
                style={{
                  height: 260,
                  borderRadius: layout.radius.lg,
                  overflow: 'hidden',
                }}
                barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'qr'] }}
                onBarcodeScanned={({ data }) => confirmBarcode(data)}
              />
              <Button
                variant="secondary"
                label={t('picking.closeScanner')}
                onPress={() => setScannerOpen(false)}
              />
            </>
          ) : (
            <Button
              variant="secondary"
              label={t('picking.scanWithCamera')}
              onPress={() => void openScanner()}
            />
          )}

          <Field label={t('fulfilment.barcodeLabel')} hint={t('picking.barcodeHint')}>
            <Input
              label={t('fulfilment.barcodeLabel')}
              value={barcode}
              onChangeText={setBarcode}
              autoCapitalize="none"
            />
          </Field>
          <Button
            variant="secondary"
            label={t('picking.confirmCodeManually')}
            onPress={() => confirmBarcode(barcode)}
          />

          <Field label={t('picking.columnShortfall')}>
            <Input
              label={t('picking.columnShortfall')}
              multiline
              value={shortfall}
              onChangeText={setShortfall}
              style={{ minHeight: layout.space[10], paddingTop: layout.space[3] }}
            />
          </Field>
        </Card>
      ) : null}

      {list.status === 'PENDING' ? (
        <Button
          label={t('picking.startPicking')}
          busy={busy === 'start'}
          onPress={() =>
            void post(
              'start',
              { version: list.version },
              t('picking.started'),
              t('picking.startFailed'),
            )
          }
        />
      ) : null}

      {list.status === 'PICKING' ? (
        <>
          <Button
            variant="secondary"
            label={t('picking.saveProgress')}
            busy={busy === 'progress'}
            onPress={() =>
              void post(
                'progress',
                buildPickingProgress(list.version, list.items, quantities, 'SAVE'),
                t('picking.saved'),
                t('picking.updateFailed'),
              )
            }
          />
          <Button
            variant="secondary"
            label={t('picking.pause')}
            busy={busy === 'progress'}
            onPress={() =>
              void post(
                'progress',
                buildPickingProgress(list.version, list.items, quantities, 'PAUSE'),
                t('picking.paused'),
                t('picking.updateFailed'),
              )
            }
          />
          <Button
            label={t('picking.completePicking')}
            busy={busy === 'progress'}
            onPress={() =>
              void post(
                'progress',
                buildPickingProgress(list.version, list.items, quantities, 'COMPLETE'),
                t('picking.completed'),
                t('picking.updateFailed'),
              )
            }
          />
        </>
      ) : null}

      {list.status === 'PAUSED' ? (
        <Button
          label={t('picking.resumePicking')}
          busy={busy === 'resume'}
          onPress={() =>
            void post(
              'resume',
              { version: list.version },
              t('picking.resumed'),
              t('picking.updateFailed'),
            )
          }
        />
      ) : null}

      {list.status === 'PACKING' ? (
        <Card>
          <Field label={t('picking.packageCount')}>
            <Input
              label={t('picking.packageCount')}
              keyboardType="number-pad"
              value={packageCount}
              onChangeText={setPackageCount}
            />
          </Field>
          <Field label={t('picking.weight')} hint={t('picking.weightHint')}>
            <Input
              label={t('picking.weight')}
              keyboardType="number-pad"
              value={weightGrams}
              onChangeText={setWeightGrams}
            />
          </Field>
          <Button
            label={t('picking.confirmPacking')}
            busy={busy === 'pack'}
            onPress={() =>
              void post(
                'pack',
                buildPackingConfirmation(
                  list.version,
                  list.items,
                  quantities,
                  shortfall,
                  barcode,
                  Number(packageCount.replace(/[^0-9]/g, '') || '1'),
                  weightGrams ? Number(weightGrams.replace(/[^0-9]/g, '')) : undefined,
                ),
                // Was `Alert.alert('Packed', 'Invoice and package created from
                // actual packed quantities.')` — outside React, untranslatable,
                // invisible to a test, and it said "invoice" and "package"
                // rather than what had happened.
                t('picking.packed'),
                t('picking.packFailed'),
                true,
              )
            }
          />
        </Card>
      ) : null}
    </Screen>
  );
}
