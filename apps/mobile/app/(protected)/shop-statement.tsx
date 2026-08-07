import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { getShopStatement } from '../../src/customers/api';
import { defaultStatementRange, formatFinanceDate, isDateOnly } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import type { CustomerStatement } from '../../src/finance/types';
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
  Metric,
  Screen,
  SectionTitle,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * One customer's statement for a period.
 *
 * The same document `statement.tsx` shows a shop about itself, read by staff
 * about a customer. Deliberately a second screen rather than a parameter on the
 * first: the customer's own screen must never be able to name somebody else's
 * shop, and the safest way to guarantee that is for it not to take an id.
 */
export default function ShopStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const initial = defaultStatementRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [statement, setStatement] = useState<CustomerStatement>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!isDateOnly(from) || !isDateOnly(to) || from > to) {
      setError(t('statement.invalidRange'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      setStatement((await getShopStatement(id, from, to)) as unknown as CustomerStatement);
    } catch (caught) {
      setError(errorMessage(caught, language, t('statement.couldNotLoad')));
    } finally {
      setBusy(false);
    }
  }, [from, id, language, t, to]);

  useEffect(() => {
    void load();
    // On mount only: the dates are applied by the button, so a half-typed year
    // does not fire a request per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen>
      <Card>
        <Field label={t('statement.from')} hint={t('purchasing.dateHint')}>
          <Input label={t('statement.from')} value={from} onChangeText={setFrom} />
        </Field>
        <Field label={t('statement.to')} hint={t('purchasing.dateHint')}>
          <Input label={t('statement.to')} value={to} onChangeText={setTo} />
        </Field>
        <Button busy={busy} label={t('statement.generate')} onPress={() => void load()} />
      </Card>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {busy && !statement ? <LoadingState label={t('statement.loading')} /> : null}

      {statement ? (
        <>
          <Card>
            {/*
              Opening and closing first. A statement is read to answer "did it
              go up or down", and the movements are the working.
            */}
            <Metric
              label={t('statement.openingBalance')}
              value={formatMoneyMinor(statement.openingBalanceMinor)}
            />
            <Metric
              label={t('statement.closingBalance')}
              value={formatMoneyMinor(statement.closingBalanceMinor)}
            />
          </Card>

          <SectionTitle>{t('statement.period')}</SectionTitle>
          {statement.entries.length === 0 ? (
            <EmptyState title={t('statement.noEntries')} />
          ) : (
            statement.entries.map((line, index) => (
              <Card key={`${line.reference ?? 'line'}-${index}`}>
                <Text style={{ color: colour.text, fontWeight: '600' }}>
                  {line.description ?? line.reference ?? '—'}
                </Text>
                <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                  {formatFinanceDate(line.date)}
                </Text>
                <ListRow
                  label={t('statement.balance')}
                  value={formatMoneyMinor(line.balanceMinor)}
                  numeric
                />
              </Card>
            ))
          )}
        </>
      ) : null}
    </Screen>
  );
}
