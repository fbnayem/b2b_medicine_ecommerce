import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { Medicine } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { priceProblem, toMinor, toTaka } from '../../src/pricing/api';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  Field,
  Input,
  LoadingState,
  Screen,
  SectionTitle,
  toast,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Adding a medicine to the catalogue, or correcting one.
 *
 * One screen for both, because the difference is an identifier: the fields, the
 * rules and the consequences are the same, and two files would be two places to
 * forget a field.
 *
 * **The price here is the list price**, which is what a customer with no price
 * list of their own pays. It is not what any particular shop pays — that comes
 * from their price list and their discount, and `POST /orders/quote` is the
 * only thing that knows it. Said on the screen, because a catalogue price
 * typed by somebody who thinks it is *the* price is how a margin disappears.
 */
export default function MedicineFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(Boolean(id));
  const [form, setForm] = useState({
    brandName: '',
    genericName: '',
    strength: '',
    manufacturer: '',
    packSize: '',
    price: '',
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const response = await apiClient.get(`/inventory/medicines/${id}`);
      const medicine = response.data.data as Medicine;
      setForm({
        brandName: medicine.brandName ?? '',
        genericName: medicine.genericName ?? '',
        strength: medicine.strength ?? '',
        manufacturer: medicine.manufacturer ?? '',
        packSize: medicine.packSize ?? '',
        price: medicine.defaultSellingPriceMinor ? toTaka(medicine.defaultSellingPriceMinor) : '',
      });
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('catalogue.couldNotLoad')));
    } finally {
      setLoading(false);
    }
  }, [id, language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function save() {
    if (form.brandName.trim().length < 2 || form.genericName.trim().length < 2) {
      toast.error(t('medicineForm.needNames'));
      return;
    }
    const problem = priceProblem(form.price);
    if (problem) {
      toast.error(t(problem));
      return;
    }

    setSaving(true);
    try {
      const body = {
        brandName: form.brandName.trim(),
        genericName: form.genericName.trim(),
        ...(form.strength.trim() ? { strength: form.strength.trim() } : {}),
        ...(form.manufacturer.trim() ? { manufacturer: form.manufacturer.trim() } : {}),
        ...(form.packSize.trim() ? { packSize: form.packSize.trim() } : {}),
        defaultSellingPriceMinor: toMinor(form.price),
      };
      if (id) {
        await apiClient.patch(`/inventory/medicines/${id}`, body);
        toast.success(t('medicineForm.saved'));
      } else {
        const created = await apiClient.post('/inventory/medicines', body);
        toast.success(t('medicineForm.created'));
        router.replace(`/(protected)/medicine-detail?id=${created.data.data._id}` as never);
        return;
      }
      router.back();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('medicineForm.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('catalogue.loading')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionTitle>{id ? t('medicineForm.editTitle') : t('medicineForm.addTitle')}</SectionTitle>

      <Card>
        <Field label={t('medicineForm.brandName')}>
          <Input
            label={t('medicineForm.brandName')}
            value={form.brandName}
            onChangeText={set('brandName')}
          />
        </Field>
        <Field label={t('medicineForm.genericName')}>
          <Input
            label={t('medicineForm.genericName')}
            value={form.genericName}
            onChangeText={set('genericName')}
          />
        </Field>
        <Field label={t('medicineForm.strength')}>
          <Input
            label={t('medicineForm.strength')}
            value={form.strength}
            onChangeText={set('strength')}
          />
        </Field>
        <Field label={t('medicineForm.manufacturer')}>
          <Input
            label={t('medicineForm.manufacturer')}
            value={form.manufacturer}
            onChangeText={set('manufacturer')}
          />
        </Field>
        <Field label={t('medicineForm.packSize')}>
          <Input
            label={t('medicineForm.packSize')}
            value={form.packSize}
            onChangeText={set('packSize')}
          />
        </Field>

        <Field label={t('catalogue.listPrice')} hint={t('medicineForm.listPriceHint')}>
          <Input
            label={t('catalogue.listPrice')}
            keyboardType="decimal-pad"
            value={form.price}
            onChangeText={(value) => set('price')(value.replace(/[^0-9.]/g, ''))}
          />
        </Field>

        {/*
          Said out loud beside the field. A catalogue price typed by somebody
          who believes it is what customers pay is how a margin disappears: the
          shop's own price list and discount come first, and only
          `POST /orders/quote` knows the answer.
        */}
        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('medicineForm.notWhatAnyShopPays')}
        </Text>

        <Button busy={saving} label={t('medicineForm.saveChanges')} onPress={() => void save()} />
      </Card>
    </Screen>
  );
}
