import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FinanceCard, FinanceState } from '../../src/finance/components';
import { apiErrorMessage, getMyStatement } from '../../src/finance/api';
import { defaultStatementRange, formatFinanceDate, isDateOnly } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import type { CustomerStatement } from '../../src/finance/types';

export default function StatementScreen() {
  const initial = defaultStatementRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [statement, setStatement] = useState<CustomerStatement>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    if (!isDateOnly(from) || !isDateOnly(to) || from > to) {
      setError('Enter a valid date range in YYYY-MM-DD format.');
      return;
    }
    setLoading(true);
    try {
      setStatement(await getMyStatement(from, to));
      setError('');
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Unable to load the account statement.'));
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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <FinanceCard>
        <Text style={styles.title}>Statement period</Text>
        <View style={styles.range}>
          <DateField label="From" value={from} onChangeText={setFrom} />
          <DateField label="To" value={to} onChangeText={setTo} />
        </View>
        <Pressable disabled={loading} style={styles.action} onPress={() => void load()}>
          <Text style={styles.actionText}>{loading ? 'Loading…' : 'Apply date range'}</Text>
        </Pressable>
      </FinanceCard>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {loading ? <FinanceState loading /> : null}
      {!loading && statement ? (
        <>
          <View style={styles.balanceRow}>
            <Balance label="Opening balance" value={statement.openingBalanceMinor} />
            <Balance label="Closing balance" value={statement.closingBalanceMinor} />
          </View>
          <Text style={styles.period}>
            {statement.from} to {statement.to}
          </Text>
          {!statement.entries.length ? (
            <FinanceState empty="No ledger entries in this period." />
          ) : null}
          {statement.entries.map((entry) => (
            <FinanceCard key={entry._id}>
              <View style={styles.entryHeading}>
                <Text style={styles.reference}>{entry.reference}</Text>
                <Text>{formatFinanceDate(entry.date)}</Text>
              </View>
              <Text style={styles.entryType}>{entry.type.replaceAll('_', ' ')}</Text>
              <Text>{entry.description}</Text>
              <View style={styles.entryAmounts}>
                <Text>Debit {formatMoneyMinor(entry.debitMinor)}</Text>
                <Text>Credit {formatMoneyMinor(entry.creditMinor)}</Text>
              </View>
              <Text style={styles.entryBalance}>
                Balance {formatMoneyMinor(entry.balanceMinor)}
              </Text>
            </FinanceCard>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function DateField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.dateField}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={`${label} date in YYYY-MM-DD format`}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
        maxLength={10}
      />
    </View>
  );
}

function Balance({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.balance}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.balanceValue}>{formatMoneyMinor(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 14, gap: 10 },
  title: { fontWeight: '900', fontSize: 17 },
  range: { flexDirection: 'row', gap: 10 },
  dateField: { flex: 1, gap: 5 },
  label: { color: '#66756d', fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#bdcbc2',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fff',
  },
  action: { backgroundColor: '#126b45', padding: 13, borderRadius: 8 },
  actionText: { color: '#fff', textAlign: 'center', fontWeight: '900' },
  error: { color: '#8b2525', backgroundColor: '#fff0ee', padding: 10, borderRadius: 8 },
  balanceRow: { flexDirection: 'row', gap: 10 },
  balance: { flex: 1, backgroundColor: '#fff', borderRadius: 11, padding: 13 },
  balanceValue: { color: '#173f2e', fontWeight: '900', fontSize: 18, marginTop: 4 },
  period: { color: '#66756d', textAlign: 'center' },
  entryHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  reference: { color: '#126b45', fontWeight: '900' },
  entryType: { fontWeight: '800' },
  entryAmounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: '#e7ede9',
  },
  entryBalance: { textAlign: 'right', color: '#173f2e', fontWeight: '900' },
});
