import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { Medicine, PriceListRecord } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import {
  getPriceList,
  priceProblem,
  savePriceList,
  toMinor,
  toTaka,
  withLine,
} from '../../src/pricing/api';
import { formatMoneyMinor } from '../../src/finance/money';
import { useAuthStore } from '../../src/store/useAuth';
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
  SectionTitle,
  toast,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

const MAY_EDIT = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

/**
 * One price list: find a line, change one price, save.
 *
 * **Deliberately not the desktop grid made small.** The web screen shows every
 * line at once and that is right on a monitor; two hundred rows on a six-inch
 * screen is a list nobody can audit before pressing save, on the one document
 * that decides what forty customers are charged.
 *
 * So: a search box, one line at a time, and the whole list never on screen
 * together. The saved payload is still the whole set of lines, because that is
 * what `PATCH` takes — and `withLine` is what guarantees the other 199 go back
 * unchanged rather than being replaced by the one that was edited.
 *
 * The `version` goes back untouched. Two people editing the same list from two
 * phones means the second save is **refused**, which is the only outcome that
 * does not silently discard somebody's work.
 */
export default function PriceListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const role = useAuthStore((state) => state.user?.role);
  const [list, setList] = useState<PriceListRecord>();
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Medicine[]>([]);
  const [editing, setEditing] = useState<{ medicineId: string; brandName: string } | null>(null);
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setList(await getPriceList(id));
    } catch (caught) {
      setError(errorMessage(caught, language, t('priceLists.couldNotLoadOne')));
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

  function begin(medicineId: string, brandName: string) {
    const line = list?.lines.find((entry) => entry.medicineId === medicineId);
    setEditing({ medicineId, brandName });
    // Seeded from the list's own price, not from the catalogue: this is what
    // this list charges, and it is the figure being changed.
    setTyped(line ? toTaka(line.unitPriceMinor) : '');
    setTerm('');
    setFound([]);
  }

  async function save() {
    if (!list || !editing) return;
    const problem = priceProblem(typed);
    if (problem) {
      toast.error(t(problem));
      return;
    }

    setSaving(true);
    try {
      const saved = await savePriceList(
        list._id,
        list.version,
        // Everything that was read, plus the change. Sending only the edited
        // line would replace the list with one line and drop every customer on
        // it back to default pricing.
        withLine(list.lines, editing.medicineId, { unitPriceMinor: toMinor(typed) }),
      );
      setList(saved);
      setEditing(null);
      setTyped('');
      toast.success(t('priceLists.saved'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('priceLists.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  if (!list) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <LoadingState label={t('priceLists.loadingOne')} />
        )}
      </Screen>
    );
  }

  const mayEdit = MAY_EDIT.includes(String(role));

  return (
    <Screen>
      <Text style={{ color: colour.text, fontWeight: '700', fontSize: layout.fontSize.lg }}>
        {list.name}
      </Text>
      <View style={{ flexDirection: 'row', gap: layout.space[2], flexWrap: 'wrap' }}>
        {list.isDefault ? <Badge tone="brand">{t('priceLists.default')}</Badge> : null}
        {list.isActive ? null : <Badge tone="neutral">{t('priceLists.notInUse')}</Badge>}
      </View>
      <ListRow label={t('priceLists.shopsPriced')} value={list.shopCount ?? 0} numeric />
      <ListRow label={t('priceLists.lines')} value={list.lines.length} numeric />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Field label={t('priceLists.findLine')} hint={t('priceLists.findLineHint')}>
        <Input
          label={t('priceLists.findLine')}
          value={term}
          onChangeText={(value) => void search(value)}
        />
      </Field>

      {/*
        The list's own lines are searched first, so "what do we charge for
        Napa" is answered without a round trip and without loading two hundred
        rows onto a phone.
      */}
      {term.trim().length >= 2
        ? list.lines
            .filter((line) =>
              (line.medicineBrandName ?? '').toLowerCase().includes(term.trim().toLowerCase()),
            )
            .slice(0, 10)
            .map((line) => (
              <Card key={line.medicineId}>
                <Text style={{ color: colour.text, fontWeight: '600' }}>
                  {line.medicineBrandName ?? line.medicineId}
                </Text>
                <ListRow
                  label={t('priceLists.unitPrice')}
                  value={formatMoneyMinor(line.unitPriceMinor)}
                  numeric
                />
                {mayEdit ? (
                  <Button
                    variant="secondary"
                    label={t('priceLists.changePrice')}
                    accessibilityLabel={t('priceLists.changePriceFor', {
                      brand: line.medicineBrandName ?? '',
                    })}
                    onPress={() => begin(line.medicineId, line.medicineBrandName ?? '')}
                  />
                ) : null}
              </Card>
            ))
        : null}

      {/* Medicines the list does not price yet, so one can be added to it. */}
      {mayEdit && found.length > 0 ? (
        <>
          <SectionTitle>{t('priceLists.addLine')}</SectionTitle>
          {found
            .filter(
              (medicine) => !list.lines.some((line) => line.medicineId === String(medicine._id)),
            )
            .map((medicine) => (
              <Button
                key={String(medicine._id)}
                variant="secondary"
                label={`${medicine.brandName} ${medicine.strength ?? ''}`.trim()}
                onPress={() => begin(String(medicine._id), medicine.brandName)}
              />
            ))}
        </>
      ) : null}

      {editing ? (
        <Card>
          <SectionTitle>{editing.brandName}</SectionTitle>
          <Field label={t('priceLists.priceTaka')} hint={t('priceLists.priceHint')}>
            <Input
              label={t('priceLists.priceTaka')}
              keyboardType="decimal-pad"
              value={typed}
              onChangeText={(value) => setTyped(value.replace(/[^0-9.]/g, ''))}
            />
          </Field>
          <Button busy={saving} label={t('priceLists.savePrice')} onPress={() => void save()} />
          <Button
            variant="secondary"
            label={t('common.cancel')}
            onPress={() => {
              setEditing(null);
              setTyped('');
            }}
          />
        </Card>
      ) : null}

      {list.lines.length === 0 ? (
        <EmptyState title={t('priceLists.noLines')} description={t('priceLists.noLinesBody')} />
      ) : null}
    </Screen>
  );
}
