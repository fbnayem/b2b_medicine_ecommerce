import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { ReturnStatus, UserRole } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { formatFinanceDate } from '../../../src/finance/date';
import { formatMoneyMinor } from '../../../src/finance/money';
import { getReturns, type ReturnSummary } from '../../../src/returns/api';
import { useAuthStore } from '../../../src/store/useAuth';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Button,
  CardLink,
  EmptyState,
  ErrorState,
  FilterChips,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

const named = (value: ReturnSummary['shopId']) =>
  typeof value === 'object' && value ? value : undefined;

/** Each role opens on the queue it actually works, not the full list. */
function defaultStatus(role?: UserRole) {
  if (role === UserRole.STOREKEEPER) return ReturnStatus.COLLECTED;
  if (role === UserRole.DELIVERY_PERSON) return ReturnStatus.APPROVED;
  return '';
}

/** Order only. The words come from the catalogue, like every other status. */
const FILTER_ORDER = [
  '',
  ReturnStatus.REQUESTED,
  ReturnStatus.APPROVED,
  ReturnStatus.COLLECTED,
  ReturnStatus.RECEIVED,
  ReturnStatus.COMPLETED,
] as const;

export default function ReturnsScreen() {
  const { t, language } = useLanguage();
  const role = useAuthStore((state) => state.user?.role);
  const [items, setItems] = useState<ReturnSummary[]>([]);
  const [status, setStatus] = useState<string>(() => defaultStatus(role));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await getReturns({ limit: 50, ...(status ? { status } : {}) });
      setItems(result.items);
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('returns.couldNotLoad')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [status, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen scroll={false}>
      <FilterChips
        label={t('returns.allStatuses')}
        value={status}
        onChange={(next) => {
          setLoading(true);
          setStatus(next);
        }}
        options={FILTER_ORDER.map((value) => ({
          value,
          label: value ? t(`returnStatus.${value}`) : t('returns.allStatuses'),
        }))}
      />

      {/*
        The way in. `POST /returns` admits a shop owner and had no caller on
        this client at all, so a pharmacy could read the returns they had
        raised on a desktop and could not raise one from the phone they were
        holding over the carton.
      */}
      {role === UserRole.SHOP_OWNER ? (
        <Button
          label={t('returns.raiseOne')}
          onPress={() => router.push('/(protected)/return-new')}
        />
      ) : null}

      {loading ? (
        <LoadingState label={t('returns.loading')} />
      ) : (
        <>
          {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
          <FlatList
            data={items}
            keyExtractor={(item) => item._id}
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
                title={status ? t('returns.noneFiltered') : t('returns.none')}
                description={status ? undefined : t('returns.noneBody')}
              />
            }
            renderItem={({ item }) => (
              <CardLink
                accessibilityLabel={item.reference}
                onPress={() =>
                  router.push({ pathname: '/(protected)/return-detail', params: { id: item._id } })
                }
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: layout.space[2],
                  }}
                >
                  <Text style={{ color: colour.brand, fontWeight: '600' }}>{item.reference}</Text>
                  {/* Was `returnStatusLabel()` in src/returns/api.ts — a third
                      set of status words, English in both languages. */}
                  <StatusPill kind="return" status={item.status} />
                </View>
                <Text
                  style={{
                    fontSize: layout.fontSize.xl,
                    fontWeight: '700',
                    color: colour.text,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatMoneyMinor(
                    item.approvedTotalMinor > 0
                      ? item.approvedTotalMinor
                      : item.requestedTotalMinor,
                  )}
                </Text>
                {role === UserRole.SHOP_OWNER ? null : (
                  <ListRow label={t('finance.shop')} value={named(item.shopId)?.name ?? '—'} />
                )}
                <ListRow
                  label={t('returns.invoice')}
                  value={named(item.invoiceId)?.reference ?? '—'}
                />
                <ListRow
                  label={t('returns.columnReason')}
                  value={t(`returnReason.${item.primaryReason}`)}
                />
                <ListRow
                  label={t('returns.columnRequested')}
                  value={formatFinanceDate(item.requestedAt)}
                />
                {item.creditNoteReference ? (
                  <ListRow label={t('returnDetail.creditNote')} value={item.creditNoteReference} />
                ) : null}
              </CardLink>
            )}
          />
        </>
      )}
    </Screen>
  );
}
