import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { UserRole } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../api/client';
import { getFinanceReportSummary, getOverdueShops } from '../finance/api';
import type { FinanceReportSummary, OverdueShop } from '../finance/types';
import { formatMoneyMinor } from '../finance/money';
import { useLanguage } from '../i18n/useLanguage';
import { blockedByDiscrepancy, blocksFor, type Block, type StaffCounts } from './waiting';
import { CardLink, EmptyState, ErrorState, LoadingState, SectionTitle } from '../components';
import { colour, layout } from '../theme';

/**
 * The first screen a member of staff sees, and it now says something.
 *
 * It was a list of buttons — the same signpost `CustomerHome` replaced for a
 * pharmacy, built from raw `Pressable` and `StyleSheet` rather than the
 * primitives, greeting the reader by name and announcing their own role back to
 * them. A signpost is the right screen when every destination is equally
 * likely. It is the wrong one when three of them have somebody standing at the
 * other end: a storekeeper stopped by a discrepancy, a customer who has asked
 * twice to cancel, an order that has been waiting for approval since yesterday.
 *
 * So: **what is waiting on you**, then everything else underneath. Which counts
 * a role sees, and in what order, is decided in `waiting.ts` where it can be
 * tested and argued with rather than inferred from markup.
 *
 * Money is one line, not a card. A manager who needs the detail taps through;
 * a manager who does not needs to know whether the figure moved.
 */
export function StaffHome({ role, menu }: { role: UserRole; menu: React.ReactNode }) {
  const { t, language } = useLanguage();
  const [counts, setCounts] = useState<StaffCounts>();
  const [overdueMinor, setOverdueMinor] = useState(0);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      /*
       * Everything at once, and a failure of any of it is one message.
       *
       * `allSettled` rather than `all`: a manager whose finance summary times
       * out should still be told there are four orders to approve. A home
       * screen that shows nothing because one of four requests was slow is a
       * home screen people stop opening.
       */
      const asked = requestsFor(role);
      const answers = await Promise.allSettled(asked.map((request) => request.run()));
      const next: StaffCounts = {};
      let failures = 0;
      answers.forEach((answer, index) => {
        if (answer.status === 'rejected') {
          failures += 1;
          return;
        }
        asked[index]!.apply(answer.value, next, setOverdueMinor);
      });
      setCounts(next);
      if (failures === answers.length) {
        setError(t('staffHome.couldNotLoad'));
      }
    } catch (caught) {
      setError(errorMessage(caught, language, t('staffHome.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, role, t]);

  // On focus rather than on mount: approving an order and coming back should
  // show three where it showed four, not the figure from before the decision.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!counts && !error) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colour.canvas }}>
        <View style={{ padding: layout.space[4] }}>
          <LoadingState label={t('staffHome.loading')} />
        </View>
      </ScrollView>
    );
  }

  const blocks = blocksFor(role, counts ?? {});

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colour.canvas }}
      contentContainerStyle={{ padding: layout.space[4], gap: layout.space[3] }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <SectionTitle>{t('staffHome.waitingOnYou')}</SectionTitle>

      {blocks.length === 0 ? (
        /*
         * Said in a sentence rather than as a column of noughts. Four zeroes is
         * a screen somebody learns to skip, and the next number they skip is a
         * real one.
         */
        <EmptyState
          title={t('staffHome.nothingWaiting')}
          description={t('staffHome.nothingWaitingBody')}
        />
      ) : (
        blocks.map((block) => <Waiting key={block.kind} block={block} money={overdueMinor} />)
      )}

      <SectionTitle>{t('staffHome.everythingElse')}</SectionTitle>
      {menu}
    </ScrollView>
  );
}

/**
 * One thing that is waiting, as a row somebody can tap.
 *
 * The count is announced **before** the label to a screen reader — "4 orders
 * waiting for approval" rather than "orders waiting for approval, 4" — because
 * the number is the reason to stop on this row.
 */
function Waiting({ block, money }: { block: Block; money: number }) {
  const { t } = useLanguage();
  const label = t(`staffHome.block.${block.kind}`, { count: block.count });
  const detail =
    block.kind === 'overdue' && money > 0
      ? t('staffHome.overdueAmount', { amount: formatMoneyMinor(money) })
      : undefined;

  return (
    <CardLink
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      onPress={() => router.push(block.route as never)}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: layout.space[3],
        }}
      >
        <Text
          style={{
            fontSize: layout.fontSize['2xl'],
            fontWeight: '700',
            color: block.blocking ? colour.brand : colour.text,
            fontVariant: ['tabular-nums'],
            minWidth: layout.space[8],
          }}
        >
          {block.count}
        </Text>
        <View style={{ flexShrink: 1, gap: layout.space[1] }}>
          <Text style={{ color: colour.text, fontWeight: '600' }}>{label}</Text>
          {detail ? (
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>{detail}</Text>
          ) : null}
        </View>
      </View>
    </CardLink>
  );
}

interface HomeRequest {
  run: () => Promise<unknown>;
  apply: (value: unknown, into: StaffCounts, setMoney: (minor: number) => void) => void;
}

/**
 * What each role's home screen asks for.
 *
 * Written as a list rather than as branches inside `load` so that a role asking
 * for something it may not read is visible at a glance — a rep here reads
 * `/shops` and `/orders`, both of which the server already narrows to their own
 * territory, and nothing else.
 */
function requestsFor(role: UserRole): HomeRequest[] {
  const management = (
    [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER] as UserRole[]
  ).includes(role);

  if (management) {
    return [
      {
        run: () => apiClient.get('/approvals/queue'),
        apply: (value, into) => {
          into.approvals = rows(value).length;
        },
      },
      {
        run: () => apiClient.get('/orders', { params: { status: 'CANCELLATION_REQUESTED' } }),
        apply: (value, into) => {
          into.cancellations = rows(value).length;
        },
      },
      {
        run: () => apiClient.get('/fulfilment/queue'),
        apply: (value, into) => {
          into.discrepancies = blockedByDiscrepancy(
            rows(value) as Array<{ discrepancies?: Array<{ status: string }> }>,
          );
        },
      },
      {
        run: () => getFinanceReportSummary(),
        apply: (value, into, setMoney) => {
          const summary = value as FinanceReportSummary;
          into.overdueShops = summary.overdueShopCount;
          setMoney(summary.totalOverdueMinor);
        },
      },
    ];
  }

  if (role === UserRole.STOREKEEPER) {
    return [
      {
        run: () => apiClient.get('/fulfilment/queue'),
        apply: (value, into) => {
          into.picking = rows(value).length;
        },
      },
      {
        run: () => apiClient.get('/stocktakes', { params: { status: 'COUNTING' } }),
        apply: (value, into) => {
          into.counting = rows(value).length;
        },
      },
      {
        run: () => apiClient.get('/purchasing/orders', { params: { status: 'CONFIRMED' } }),
        apply: (value, into) => {
          into.arriving = rows(value).length;
        },
      },
    ];
  }

  return [
    {
      run: () => apiClient.get('/orders'),
      apply: (value, into) => {
        // Open, meaning somebody is still waiting on it — a delivered order is
        // not something a representative has to do anything about.
        into.openOrders = rows(value).filter(
          (order) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(String(order.status)),
        ).length;
      },
    },
    {
      run: () => apiClient.get('/shops'),
      apply: (value, into) => {
        into.customers = rows(value).length;
      },
    },
    {
      run: () => getOverdueShops(),
      apply: (value, into, setMoney) => {
        /*
         * A representative reads the overdue list rather than the finance
         * summary: `/finance/reports/summary` is management-only, and the list
         * is already narrowed to the customers they may act for.
         */
        const page = value as { items: OverdueShop[] };
        into.overdueShops = page.items.length;
        setMoney(page.items.reduce((total, shop) => total + shop.overdueBalanceMinor, 0));
      },
    },
  ];
}

/** The rows out of an envelope, whatever shape the caller happened to get. */
function rows(value: unknown): Array<Record<string, unknown>> {
  const body = (value as { data?: { data?: unknown } })?.data?.data;
  return Array.isArray(body) ? (body as Array<Record<string, unknown>>) : [];
}
