import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import {
  getShopInvoices,
  getShopLedger,
  type LedgerEntry,
  type ShopInvoiceRow,
} from '../../src/customers/api';
import { formatFinanceDate, formatFinanceDateTime } from '../../src/finance/date';
import { formatMoneyMinor } from '../../src/finance/money';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Card,
  EmptyState,
  ErrorState,
  FilterChips,
  ListRow,
  LoadingState,
  Screen,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * One customer's money, entry by entry.
 *
 * Two views of the same account and they answer different questions. **What is
 * still open** is what somebody chasing payment needs — the invoices with a
 * balance on them, and how old. **Every movement** is what somebody reconciling
 * needs, and it is the one that has to balance.
 *
 * Management only, deliberately: a representative sees the summary on the
 * customer screen and not this. A rep quoting a ledger entry is having a
 * conversation that belongs to a manager.
 */
export default function ShopLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const [view, setView] = useState<'open' | 'all'>('open');
  const [entries, setEntries] = useState<LedgerEntry[]>();
  const [invoices, setInvoices] = useState<ShopInvoiceRow[]>();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      if (view === 'all') setEntries((await getShopLedger(id)).items);
      else setInvoices(await getShopInvoices(id));
    } catch (caught) {
      setError(errorMessage(caught, language, t('shops.ledgerCouldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [id, language, t, view]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loading = view === 'all' ? !entries : !invoices;

  return (
    <Screen scroll={false}>
      <FilterChips
        label={t('shops.showing')}
        value={view}
        onChange={(next) => setView(next as 'open' | 'all')}
        options={[
          { value: 'open', label: t('shops.stillOpen') },
          { value: 'all', label: t('shops.everyMovement') },
        ]}
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {loading && !error ? <LoadingState label={t('shops.ledgerLoading')} /> : null}

      {view === 'open' ? (
        <FlatList
          data={invoices ?? []}
          keyExtractor={(invoice) => invoice._id}
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
          ListEmptyComponent={invoices ? <EmptyState title={t('shops.nothingOpen')} /> : null}
          renderItem={({ item }) => (
            <Card>
              <Text style={{ color: colour.brand, fontWeight: '600' }}>{item.reference}</Text>
              <ListRow
                label={t('account.invoiceDate')}
                value={formatFinanceDate(item.invoiceDate)}
              />
              <ListRow label={t('fields.dueDate')} value={formatFinanceDate(item.dueDate)} />
              <ListRow
                label={t('finance.grandTotal')}
                value={formatMoneyMinor(item.grandTotalMinor)}
                numeric
              />
              {/*
                The figure the whole view is for. A total tells you what the
                invoice was; what is left tells you what to ask for.
              */}
              <ListRow
                label={t('account.remaining')}
                value={formatMoneyMinor(item.amountDueMinor)}
                numeric
              />
            </Card>
          )}
        />
      ) : (
        <FlatList
          data={entries ?? []}
          keyExtractor={(entry) => entry._id}
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
          ListEmptyComponent={entries ? <EmptyState title={t('shops.noMovements')} /> : null}
          renderItem={({ item }) => (
            <Card>
              {/*
                The server's own description, not the enum behind it. The web
                ledger prints `type.replaceAll('_', ' ').toLowerCase()`, which
                is a database word shown to a person — the defect the status
                pills removed everywhere else.
              */}
              <Text style={{ color: colour.text, fontWeight: '600' }}>
                {item.description ?? item.reference ?? item.sourceReference ?? '—'}
              </Text>
              <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                {formatFinanceDateTime(
                  item.postingTime ?? item.postedAt ?? item.createdAt ?? new Date().toISOString(),
                )}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: layout.space[2],
                }}
              >
                {/*
                  Debit and credit kept apart rather than added into one signed
                  figure. Which side an entry falls on is the fact somebody is
                  reconciling against, and a minus sign loses it.
                */}
                <ListRow
                  label={t('shops.charged')}
                  value={item.debitMinor ? formatMoneyMinor(item.debitMinor) : '—'}
                  numeric
                />
                <ListRow
                  label={t('shops.paid')}
                  value={item.creditMinor ? formatMoneyMinor(item.creditMinor) : '—'}
                  numeric
                />
              </View>
              {item.balanceAfterMinor !== undefined ? (
                <ListRow
                  label={t('shops.balanceAfter')}
                  value={formatMoneyMinor(item.balanceAfterMinor)}
                  numeric
                />
              ) : null}
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
