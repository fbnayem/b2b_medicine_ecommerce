import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorMessage } from '@medsupply/api-client';
import { getMyStatement } from '../../src/finance/api';
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

export default function StatementScreen() {
  const { t, language } = useLanguage();
  const initial = defaultStatementRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [statement, setStatement] = useState<CustomerStatement>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    if (!isDateOnly(from) || !isDateOnly(to) || from > to) {
      setError(t('statement.invalidRange'));
      return;
    }
    setLoading(true);
    try {
      setStatement(await getMyStatement(from, to));
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('statement.couldNotLoad')));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // The initial range is intentionally loaded once; users apply later edits explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen>
      <Card>
        <SectionTitle>{t('statement.period')}</SectionTitle>
        <View style={{ flexDirection: 'row', gap: layout.space[3] }}>
          <Field label={t('statement.from')} hint={t('statement.dateHint')} style={{ flex: 1 }}>
            <Input
              label={t('statement.from')}
              value={from}
              onChangeText={setFrom}
              placeholder={t('statement.dateHint')}
              autoCapitalize="none"
              maxLength={10}
            />
          </Field>
          <Field label={t('statement.to')} hint={t('statement.dateHint')} style={{ flex: 1 }}>
            <Input
              label={t('statement.to')}
              value={to}
              onChangeText={setTo}
              placeholder={t('statement.dateHint')}
              autoCapitalize="none"
              maxLength={10}
            />
          </Field>
        </View>
        <Button busy={loading} label={t('statement.generate')} onPress={() => void load()} />
      </Card>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {loading ? <LoadingState label={t('statement.loading')} /> : null}

      {!loading && statement ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
            <Metric
              label={t('statement.openingBalance')}
              value={formatMoneyMinor(statement.openingBalanceMinor)}
            />
            <Metric
              label={t('statement.closingBalance')}
              value={formatMoneyMinor(statement.closingBalanceMinor)}
            />
          </View>
          <Text style={{ color: colour.textMuted, textAlign: 'center' }}>
            {formatFinanceDate(statement.from)} – {formatFinanceDate(statement.to)}
          </Text>

          {!statement.entries.length ? (
            <EmptyState title={t('statement.noEntries')} />
          ) : (
            statement.entries.map((entry) => (
              <Card key={entry._id}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    gap: layout.space[2],
                  }}
                >
                  <Text style={{ color: colour.brand, fontWeight: '600' }}>{entry.reference}</Text>
                  <Text style={{ color: colour.textMuted }}>{formatFinanceDate(entry.date)}</Text>
                </View>
                <Text style={{ fontWeight: '600', color: colour.text }}>
                  {t(`movementType.${entry.type}`) === `movementType.${entry.type}`
                    ? entry.type.replaceAll('_', ' ').toLowerCase()
                    : t(`movementType.${entry.type}`)}
                </Text>
                <Text style={{ color: colour.text }}>{entry.description}</Text>
                <ListRow
                  label={t('statement.debit')}
                  value={formatMoneyMinor(entry.debitMinor)}
                  numeric
                />
                <ListRow
                  label={t('statement.credit')}
                  value={formatMoneyMinor(entry.creditMinor)}
                  numeric
                />
                <ListRow
                  label={t('statement.balance')}
                  value={formatMoneyMinor(entry.balanceMinor)}
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
