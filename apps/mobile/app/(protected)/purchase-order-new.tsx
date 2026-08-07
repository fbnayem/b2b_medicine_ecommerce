import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Medicine, Supplier } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { createPurchaseOrder, getSuppliers } from '../../src/warehouse/purchasing';
import { formatMoneyMinor } from '../../src/finance/money';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ListRow,
  Screen,
  SectionTitle,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

interface Line {
  medicineId: string;
  brandName: string;
  orderedQuantity: string;
  unitCostMinor: string;
}

/**
 * Raising a purchase order from a phone.
 *
 * Search, add, type a quantity and a cost, repeat. Deliberately not the web
 * grid: a phone adds one line at a time and shows what has been added, because
 * a table of six columns on a narrow screen is a table nobody checks before
 * pressing send.
 *
 * **The cost is typed in taka and stored in poisha.** Every figure in this
 * product is an integer of minor units, and the conversion happens once, here,
 * where somebody can see it — not in three places that disagree by a factor of
 * a hundred.
 */
export default function PurchaseOrderNewScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [supplier, setSupplier] = useState<Supplier>();
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Medicine[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [expected, setExpected] = useState('');
  const [saving, setSaving] = useState(false);

  async function chooseSupplier() {
    try {
      const suppliers = await getSuppliers();
      if (suppliers.length === 0) {
        toast.error(t('purchasing.noSuppliersYet'));
        return;
      }
      const chosen = await ask.choose({
        title: t('purchasing.supplier'),
        options: suppliers.map((entry) => ({ value: entry._id, label: entry.name })),
      });
      if (chosen) setSupplier(suppliers.find((entry) => entry._id === chosen));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('purchasing.suppliersCouldNotLoad')));
    }
  }

  async function search(value: string) {
    setTerm(value);
    if (value.trim().length < 2) {
      setFound([]);
      return;
    }
    try {
      const response = await apiClient.get('/inventory/medicines', {
        params: { search: value.trim(), limit: 20 },
      });
      setFound(response.data.data as Medicine[]);
    } catch {
      // A failed search is an empty list, not an error card: the person is
      // mid-type and the next keystroke will ask again.
      setFound([]);
    }
  }

  function add(medicine: Medicine) {
    const id = String(medicine._id);
    if (lines.some((line) => line.medicineId === id)) {
      toast.error(t('purchasing.alreadyOnOrder'));
      return;
    }
    setLines((current) => [
      ...current,
      {
        medicineId: id,
        brandName: medicine.brandName,
        orderedQuantity: '',
        /*
         * **Not seeded from `costPriceMinor`.** It was, and `customerMoney.test.ts`
         * refused it — correctly, and for a reason that survives the fact that
         * this is a staff screen: the cost on the catalogue is what we paid
         * last time, and the field is asking what we are paying now. Filling it
         * in with the old figure invites somebody to press save without
         * reading, on the one number that decides the margin.
         */
        unitCostMinor: '',
      },
    ]);
    setTerm('');
    setFound([]);
  }

  const set = (medicineId: string, field: 'orderedQuantity' | 'unitCostMinor', value: string) =>
    setLines((current) =>
      current.map((line) => (line.medicineId === medicineId ? { ...line, [field]: value } : line)),
    );

  async function raise() {
    if (!supplier) {
      toast.error(t('purchasing.needSupplier'));
      return;
    }
    const ready = lines.filter((line) => Number(line.orderedQuantity) > 0);
    if (ready.length === 0) {
      toast.error(t('purchasing.needLine'));
      return;
    }

    setSaving(true);
    try {
      const order = await createPurchaseOrder({
        supplierId: supplier._id,
        lines: ready.map((line) => ({
          medicineId: line.medicineId,
          orderedQuantity: Number(line.orderedQuantity),
          // Taka in, poisha stored. `Math.round` and not truncation: 12.005
          // typed by somebody reading a quote should not silently lose a paisa.
          unitCostMinor: Math.round(Number(line.unitCostMinor || 0) * 100),
        })),
        ...(expected.trim() ? { expectedDate: expected.trim() } : {}),
      });
      toast.success(t('purchasing.orderRaised', { reference: order.reference }));
      router.replace(`/(protected)/purchase-order-detail?id=${order._id}` as never);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('purchasing.orderFailed')));
    } finally {
      setSaving(false);
    }
  }

  const total = lines.reduce(
    (sum, line) =>
      sum + Number(line.orderedQuantity || 0) * Math.round(Number(line.unitCostMinor || 0) * 100),
    0,
  );

  return (
    <Screen>
      <Card>
        <ListRow
          label={t('purchasing.supplier')}
          value={supplier?.name ?? t('purchasing.notChosen')}
        />
        <Button
          variant="secondary"
          label={supplier ? t('purchasing.changeSupplier') : t('purchasing.supplier')}
          onPress={() => void chooseSupplier()}
        />
        <Field label={t('purchasing.expectedDate')} hint={t('purchasing.dateHint')}>
          <Input
            label={t('purchasing.expectedDate')}
            placeholder="YYYY-MM-DD"
            value={expected}
            onChangeText={setExpected}
          />
        </Field>
      </Card>

      <Field label={t('purchasing.chooseMedicine')} hint={t('purchasing.chooseMedicineHint')}>
        <Input
          label={t('purchasing.chooseMedicine')}
          value={term}
          onChangeText={(value) => void search(value)}
        />
      </Field>

      {found.map((medicine) => (
        <Button
          key={String(medicine._id)}
          variant="secondary"
          label={`${medicine.brandName} ${medicine.strength ?? ''}`.trim()}
          onPress={() => add(medicine)}
        />
      ))}

      <SectionTitle>{t('purchasing.onThisOrder')}</SectionTitle>

      {lines.length === 0 ? (
        <EmptyState
          title={t('purchasing.nothingAdded')}
          description={t('purchasing.nothingAddedBody')}
        />
      ) : (
        lines.map((line) => (
          <Card key={line.medicineId}>
            <Text style={{ color: colour.text, fontWeight: '600' }}>{line.brandName}</Text>
            <Field label={t('purchasing.quantity')}>
              <Input
                label={t('purchasing.quantity')}
                keyboardType="number-pad"
                value={line.orderedQuantity}
                onChangeText={(value) =>
                  set(line.medicineId, 'orderedQuantity', value.replace(/[^0-9]/g, ''))
                }
              />
            </Field>
            <Field label={t('purchasing.unitCostTaka')} hint={t('purchasing.unitCostHint')}>
              <Input
                label={t('purchasing.unitCostTaka')}
                keyboardType="decimal-pad"
                value={line.unitCostMinor}
                onChangeText={(value) =>
                  set(line.medicineId, 'unitCostMinor', value.replace(/[^0-9.]/g, ''))
                }
              />
            </Field>
            <Button
              variant="secondary"
              label={t('purchasing.removeLine')}
              accessibilityLabel={t('purchasing.removeLineNamed', { brand: line.brandName })}
              onPress={() =>
                setLines((current) =>
                  current.filter((entry) => entry.medicineId !== line.medicineId),
                )
              }
            />
          </Card>
        ))
      )}

      {lines.length > 0 ? (
        <Card>
          {/*
            An arithmetic total of what has been typed, and labelled as such.
            It is not a quote and there is no endpoint that prices a purchase
            order — the supplier's own invoice is what will be paid.
          */}
          <ListRow label={t('purchasing.orderTotal')} value={formatMoneyMinor(total)} numeric />
          <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
            {t('purchasing.orderValueNote')}
          </Text>
        </Card>
      ) : null}

      <View style={{ paddingTop: layout.space[2] }}>
        <Button busy={saving} label={t('purchasing.raiseOrder')} onPress={() => void raise()} />
      </View>
    </Screen>
  );
}
