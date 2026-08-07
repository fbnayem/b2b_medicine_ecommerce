import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { Medicine, SchemeRecord } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { createScheme, getScheme, updateScheme } from '../../src/pricing/api';
import { formatFinanceDate } from '../../src/finance/date';
import { useAuthStore } from '../../src/store/useAuth';
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

const MAY_EDIT = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

/**
 * One free-goods offer, read or written.
 *
 * The screen doubles as the form for a new one, because an offer is four
 * fields — a name, a medicine, a quantity to buy and a quantity free — and a
 * separate "new" screen for four fields is a push nobody needs.
 *
 * **Changing an offer does not change orders already placed.** The server
 * snapshots what an order was given, so this is a decision about what happens
 * next rather than a restatement of what happened. Said on the screen, because
 * it is the question somebody asks before pressing save.
 */
export default function SchemeDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const role = useAuthStore((state) => state.user?.role);
  const [scheme, setScheme] = useState<SchemeRecord>();
  const [name, setName] = useState('');
  const [medicine, setMedicine] = useState<{ id: string; label: string }>();
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Medicine[]>([]);
  const [buy, setBuy] = useState('');
  const [free, setFree] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const record = await getScheme(id);
      setScheme(record);
      setBuy(String(record.buyQuantity));
      setFree(String(record.freeQuantity));
    } catch (caught) {
      setError(errorMessage(caught, language, t('schemes.couldNotLoadOne')));
    }
  }, [id, language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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
      setFound([]);
    }
  }

  function numbersAreSensible(): boolean {
    const buyQuantity = Number(buy);
    const freeQuantity = Number(free);
    if (!Number.isInteger(buyQuantity) || buyQuantity < 1) {
      toast.error(t('schemes.buyRequired'));
      return false;
    }
    if (!Number.isInteger(freeQuantity) || freeQuantity < 1) {
      toast.error(t('schemes.freeRequired'));
      return false;
    }
    /*
     * More free than bought is almost always a transposed pair, and it is a
     * mistake nobody catches on the invoice — free goods do not appear in the
     * money at all, so "buy 1 get 10" ships as a giveaway that reconciles
     * perfectly.
     */
    if (freeQuantity > buyQuantity) {
      toast.error(t('schemes.moreFreeThanBought'));
      return false;
    }
    return true;
  }

  async function save() {
    if (!numbersAreSensible()) return;
    setSaving(true);
    try {
      if (scheme) {
        const confirmed = await ask.confirm({
          title: t('schemes.changeTitle'),
          description: t('schemes.changeBody'),
          confirmLabel: t('schemes.changeConfirm'),
        });
        if (!confirmed) return;
        setScheme(
          await updateScheme(scheme._id, {
            version: scheme.version,
            buyQuantity: Number(buy),
            freeQuantity: Number(free),
          }),
        );
        toast.success(t('schemes.saved'));
      } else {
        if (!medicine || name.trim().length < 2) {
          toast.error(t('schemes.needNameAndMedicine'));
          return;
        }
        const created = await createScheme({
          name: name.trim(),
          medicineId: medicine.id,
          buyQuantity: Number(buy),
          freeQuantity: Number(free),
        });
        toast.success(t('schemes.created', { name: created.name }));
        router.replace(`/(protected)/scheme-detail?id=${created._id}` as never);
      }
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('schemes.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  if (id && !scheme && !error) {
    return (
      <Screen>
        <LoadingState label={t('schemes.loadingOne')} />
      </Screen>
    );
  }

  const mayEdit = MAY_EDIT.includes(String(role));

  return (
    <Screen>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {scheme ? (
        <>
          <Text style={{ color: colour.text, fontWeight: '700', fontSize: layout.fontSize.lg }}>
            {scheme.name}
          </Text>
          <Text style={{ color: colour.textMuted }}>{scheme.medicineBrandName ?? ''}</Text>
          {scheme.isActive ? null : <Badge tone="neutral">{t('schemes.notInUse')}</Badge>}
          <ListRow
            label={t('schemes.appliesTo')}
            value={
              scheme.shopIds.length === 0
                ? t('schemes.everyCustomer')
                : t('schemes.namedCustomers', { count: scheme.shopIds.length })
            }
          />
          {scheme.validTo ? (
            <ListRow label={t('schemes.until')} value={formatFinanceDate(scheme.validTo)} />
          ) : null}
        </>
      ) : (
        <>
          <SectionTitle>{t('schemes.newTitle')}</SectionTitle>
          <Field label={t('schemes.name')}>
            <Input label={t('schemes.name')} value={name} onChangeText={setName} />
          </Field>
          <Field label={t('schemes.medicine')} hint={t('purchasing.chooseMedicineHint')}>
            <Input
              label={t('schemes.medicine')}
              value={medicine?.label ?? term}
              onChangeText={(value) => {
                setMedicine(undefined);
                void search(value);
              }}
            />
          </Field>
          {found.map((entry) => (
            <Button
              key={String(entry._id)}
              variant="secondary"
              label={`${entry.brandName} ${entry.strength ?? ''}`.trim()}
              onPress={() => {
                setMedicine({ id: String(entry._id), label: entry.brandName });
                setFound([]);
                setTerm('');
              }}
            />
          ))}
        </>
      )}

      {mayEdit ? (
        <Card>
          <Field label={t('schemes.buyQuantity')} hint={t('schemes.buyHint')}>
            <Input
              label={t('schemes.buyQuantity')}
              keyboardType="number-pad"
              value={buy}
              onChangeText={(value) => setBuy(value.replace(/[^0-9]/g, ''))}
            />
          </Field>
          <Field label={t('schemes.freeQuantity')} hint={t('schemes.freeHint')}>
            <Input
              label={t('schemes.freeQuantity')}
              keyboardType="number-pad"
              value={free}
              onChangeText={(value) => setFree(value.replace(/[^0-9]/g, ''))}
            />
          </Field>
          {/*
            Said before the button rather than after the save. An offer changed
            today does not restate what an order was given last week — the
            server snapshots it — and that is the question somebody has in mind
            while their thumb is over the button.
          */}
          <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
            {t('schemes.pastOrdersKeepTerms')}
          </Text>
          <Button busy={saving} label={t('schemes.save')} onPress={() => void save()} />
        </Card>
      ) : null}
    </Screen>
  );
}
