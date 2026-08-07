import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Warehouse } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { createWarehouse, getWarehouses } from '../../src/warehouse/purchasing';
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
 * Where stock is kept, and how much of it is in each place.
 *
 * The three figures are not the same thing and the difference matters at a
 * shelf: **on hand** is what is physically there, **available** is what may be
 * promised to a new order, and the gap between them is stock already reserved
 * for orders that have not been picked yet. A storekeeper told only "on hand"
 * promises stock that is spoken for.
 */
export default function WarehousesScreen() {
  const { t, language } = useLanguage();
  const [warehouses, setWarehouses] = useState<Warehouse[]>();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', contactPhone: '' });
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setWarehouses(await getWarehouses());
    } catch (caught) {
      setError(errorMessage(caught, language, t('warehouses.couldNotLoad')));
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
    if (form.code.trim().length < 2 || form.name.trim().length < 2) {
      toast.error(t('warehouses.needsCodeAndName'));
      return;
    }
    setSaving(true);
    try {
      await createWarehouse({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
      });
      setForm({ code: '', name: '', contactPhone: '' });
      setAdding(false);
      toast.success(t('warehouses.saved'));
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('warehouses.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  if (!warehouses && !error) {
    return (
      <Screen>
        <LoadingState label={t('warehouses.loading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Button
        variant={adding ? 'secondary' : 'primary'}
        label={adding ? t('common.cancel') : t('warehouses.add')}
        onPress={() => setAdding((current) => !current)}
      />

      {adding ? (
        <Card>
          <Field label={t('warehouses.code')} hint={t('warehouses.codeHint')}>
            <Input
              label={t('warehouses.code')}
              autoCapitalize="characters"
              value={form.code}
              onChangeText={(value) => setForm((current) => ({ ...current, code: value }))}
            />
          </Field>
          <Field label={t('warehouses.name')}>
            <Input
              label={t('warehouses.name')}
              value={form.name}
              onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
            />
          </Field>
          <Field label={t('fields.phone')} hint={t('hints.supplierPhone')}>
            <Input
              label={t('fields.phone')}
              keyboardType="phone-pad"
              value={form.contactPhone}
              onChangeText={(value) => setForm((current) => ({ ...current, contactPhone: value }))}
            />
          </Field>
          {/*
            No "make this the default" here. The first warehouse becomes the
            default on the server; moving it afterwards moves where unassigned
            stock is counted, which is a decision for a desk and a person who
            can see all of them at once.
          */}
          <Button busy={saving} label={t('warehouses.save')} onPress={() => void save()} />
        </Card>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <FlatList
        data={warehouses ?? []}
        keyExtractor={(warehouse) => warehouse._id}
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
          <EmptyState title={t('warehouses.none')} description={t('warehouses.noneBody')} />
        }
        renderItem={({ item }) => (
          <Card>
            <Text style={{ color: colour.text, fontWeight: '600' }}>
              {item.code} · {item.name}
            </Text>
            {item.isDefault ? <Badge tone="brand">{t('warehouses.isDefault')}</Badge> : null}
            <ListRow label={t('warehouses.batches')} value={item.stock.batches} numeric />
            <ListRow label={t('warehouses.onHand')} value={item.stock.onHand} numeric />
            {/*
              Said separately, because promising the on-hand figure to a new
              order is how stock gets promised twice.
            */}
            <ListRow label={t('warehouses.available')} value={item.stock.available} numeric />
          </Card>
        )}
      />
    </Screen>
  );
}
