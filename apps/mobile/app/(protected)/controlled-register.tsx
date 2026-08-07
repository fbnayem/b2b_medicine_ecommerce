import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { ControlledRegister } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { toDateInputValue } from '@medsupply/utilities';
import { getControlledRegister, unbalanced } from '../../src/warehouse/recall';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
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
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * The prescription-medicine movement return, for a period.
 *
 * What an inspector asks for, and what somebody has to be able to produce
 * standing in a stockroom rather than back at a desk.
 *
 * **The variance column is the whole control.** A register that only adds up
 * its own movements can never disagree with itself; this one compares opening
 * plus in minus out against what the shelf actually says, and anything other
 * than zero is a question. So the rows that do not balance are lifted to the
 * top rather than left to be found in a list of forty.
 */
export default function ControlledRegisterScreen() {
  const { t, language } = useLanguage();
  const today = toDateInputValue(new Date());
  const monthAgo = toDateInputValue(new Date(Date.now() - 30 * 86_400_000));
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [register, setRegister] = useState<ControlledRegister>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (from > to) {
      setError(t('purchasing.badRange'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      setRegister(await getControlledRegister(from, to));
    } catch (caught) {
      setError(errorMessage(caught, language, t('purchasing.registerCouldNotLoad')));
    } finally {
      setBusy(false);
    }
  }, [from, language, t, to]);

  useEffect(() => {
    void load();
    // Only on mount: the dates are applied by the button, so a half-typed year
    // does not fire a request per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const problems = register ? unbalanced(register) : [];

  return (
    <Screen>
      <Card>
        <Field label={t('purchasing.from')} hint={t('purchasing.dateHint')}>
          <Input label={t('purchasing.from')} value={from} onChangeText={setFrom} />
        </Field>
        <Field label={t('purchasing.to')} hint={t('purchasing.dateHint')}>
          <Input label={t('purchasing.to')} value={to} onChangeText={setTo} />
        </Field>
        <Button busy={busy} label={t('purchasing.apply')} onPress={() => void load()} />
      </Card>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {busy && !register ? <LoadingState label={t('purchasing.registerLoading')} /> : null}

      {register && register.rows.length === 0 ? (
        <EmptyState
          title={t('purchasing.registerNone')}
          description={t('purchasing.registerNoneBody')}
        />
      ) : null}

      {problems.length > 0 ? (
        <>
          <SectionTitle>{t('purchasing.variance')}</SectionTitle>
          <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
            {t('purchasing.varianceHint')}
          </Text>
          {problems.map((row) => (
            <Card key={`variance-${row.medicineId}`} style={{ borderColor: colour.danger }}>
              <Text style={{ color: colour.text, fontWeight: '600' }}>
                {row.brandName} {row.strength}
              </Text>
              <ListRow label={t('purchasing.variance')} value={row.varianceQuantity} numeric />
            </Card>
          ))}
        </>
      ) : null}

      {register && register.rows.length > 0 ? (
        <>
          <SectionTitle>{t('purchasing.registerTitle')}</SectionTitle>
          {register.rows.map((row) => (
            <Card key={row.medicineId}>
              <Text style={{ color: colour.text, fontWeight: '600' }}>
                {row.brandName} {row.strength}
              </Text>
              <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                {row.genericName}
              </Text>
              <ListRow label={t('purchasing.opening')} value={row.openingQuantity} numeric />
              <ListRow label={t('purchasing.received')} value={row.receivedQuantity} numeric />
              <ListRow label={t('purchasing.despatched')} value={row.despatchedQuantity} numeric />
              <ListRow label={t('purchasing.returned')} value={row.returnedQuantity} numeric />
              <ListRow label={t('purchasing.writtenOff')} value={row.writtenOffQuantity} numeric />
              <ListRow label={t('purchasing.closing')} value={row.closingQuantity} numeric />
              {row.varianceQuantity !== 0 ? (
                <View style={{ paddingTop: layout.space[1] }}>
                  <Text style={{ color: colour.danger, fontWeight: '600' }}>
                    {t('purchasing.variance')}: {row.varianceQuantity}
                  </Text>
                </View>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
