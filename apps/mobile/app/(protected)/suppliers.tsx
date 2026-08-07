import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Supplier } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { createSupplier, getSuppliers } from '../../src/warehouse/purchasing';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListRow,
  LoadingState,
  Screen,
  toast,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Who we buy from.
 *
 * Adding one is a form on this screen rather than a screen of its own: a
 * supplier is four fields, and a phone that pushes to a separate page to
 * collect four fields has made a decision on behalf of somebody standing at a
 * goods-in door with a driver waiting.
 *
 * The **drug licence number** is asked for here although the schema leaves it
 * optional. It is what an inspector asks about a supplier, and the moment
 * somebody is looking at the paperwork is the moment it is to hand.
 */
export default function SuppliersScreen() {
  const { t, language } = useLanguage();
  const [suppliers, setSuppliers] = useState<Supplier[]>();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', primaryPhone: '', contactName: '', licence: '' });
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setSuppliers(await getSuppliers());
    } catch (caught) {
      setError(errorMessage(caught, language, t('purchasing.suppliersCouldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function save() {
    if (form.name.trim().length < 2 || form.primaryPhone.trim().length === 0) {
      toast.error(t('purchasing.supplierNeedsNameAndPhone'));
      return;
    }
    setSaving(true);
    try {
      await createSupplier({
        name: form.name.trim(),
        primaryPhone: form.primaryPhone.trim(),
        ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
        ...(form.licence.trim() ? { drugLicenceNumber: form.licence.trim() } : {}),
      });
      setForm({ name: '', primaryPhone: '', contactName: '', licence: '' });
      setAdding(false);
      toast.success(t('purchasing.supplierSaved'));
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('purchasing.supplierFailed')));
    } finally {
      setSaving(false);
    }
  }

  if (!suppliers && !error) {
    return (
      <Screen>
        <LoadingState label={t('purchasing.suppliersLoading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Button
        variant={adding ? 'secondary' : 'primary'}
        label={adding ? t('common.cancel') : t('purchasing.addSupplier')}
        onPress={() => setAdding((current) => !current)}
      />

      {adding ? (
        <Card>
          <Field label={t('purchasing.supplierName')}>
            <Input
              label={t('purchasing.supplierName')}
              value={form.name}
              onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
            />
          </Field>
          <Field label={t('fields.phone')} hint={t('hints.supplierPhone')}>
            <Input
              label={t('fields.phone')}
              keyboardType="phone-pad"
              value={form.primaryPhone}
              onChangeText={(value) => setForm((current) => ({ ...current, primaryPhone: value }))}
            />
          </Field>
          <Field label={t('purchasing.contactName')}>
            <Input
              label={t('purchasing.contactName')}
              value={form.contactName}
              onChangeText={(value) => setForm((current) => ({ ...current, contactName: value }))}
            />
          </Field>
          <Field label={t('shops.drugLicenceNumber')} hint={t('purchasing.licenceHint')}>
            <Input
              label={t('shops.drugLicenceNumber')}
              autoCapitalize="characters"
              value={form.licence}
              onChangeText={(value) => setForm((current) => ({ ...current, licence: value }))}
            />
          </Field>
          <Button busy={saving} label={t('purchasing.saveSupplier')} onPress={() => void save()} />
        </Card>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <FlatList
        data={suppliers ?? []}
        keyExtractor={(supplier) => supplier._id}
        contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title={t('purchasing.suppliersNone')}
            description={t('purchasing.suppliersNoneBody')}
          />
        }
        renderItem={({ item }) => (
          <Card>
            <Text style={{ color: colour.text, fontWeight: '600' }}>{item.name}</Text>
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {item.reference}
            </Text>
            <ListRow label={t('fields.phone')} value={item.primaryPhone} />
            {item.contactName ? (
              <ListRow label={t('purchasing.contactName')} value={item.contactName} />
            ) : null}
            {item.drugLicenceNumber ? (
              <ListRow label={t('shops.drugLicenceNumber')} value={item.drugLicenceNumber} />
            ) : null}
            <ListRow
              label={t('purchasing.paymentTerms')}
              value={t('purchasing.days', { count: item.paymentTermsDays })}
              numeric
            />
            {item.isActive ? null : <Badge tone="neutral">{t('purchasing.notInUse')}</Badge>}
          </Card>
        )}
      />
    </Screen>
  );
}
