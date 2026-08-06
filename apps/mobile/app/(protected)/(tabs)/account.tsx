import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { LANGUAGES, LANGUAGE_LABEL, type Language } from '@medsupply/i18n';
import { errorMessage } from '@medsupply/api-client';
import { getMyFinanceSummary } from '../../../src/finance/api';
import { formatMoneyMinor, formatPercentFromBasisPoints } from '../../../src/finance/money';
import type { ShopFinanceSummary } from '../../../src/finance/types';
import { leaveSession } from '../../../src/store/leave';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Button,
  Card,
  CardLink,
  EmptyState,
  ErrorState,
  FilterChips,
  LoadingState,
  Metric,
  Screen,
  SectionTitle,
  StatusPill,
  useAsk,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

/**
 * Everything about this account that is not an order.
 *
 * The screen used to end after three links — invoices, payments, statement —
 * and the rest of a pharmacy's own account was unreachable from anywhere on the
 * phone. **Signing out lived at the bottom of the home screen**, which is a
 * strange place for it and the reason it had to be there: there was no account
 * menu to put it in.
 *
 * What is new here is not decoration. Delivery addresses and the password
 * change are both screens that did not exist; returns, notification settings
 * and the session list existed and had no route in from a shop owner's five
 * tabs.
 *
 * The language switch is here because mobile had **none at all** — the
 * catalogue picked a language from the handset and the tenant and offered no
 * way to disagree with it, while the web client has had a switch since the
 * localisation phase.
 */

/** One row of the menu. */
function MenuRow({ label, description, to }: { label: string; description: string; to: string }) {
  return (
    <CardLink accessibilityLabel={label} onPress={() => router.push(to as never)}>
      <Text style={{ color: colour.text, fontWeight: '600' }}>{label}</Text>
      {/*
        A one-line explanation under every destination. A menu of nine nouns is
        a menu somebody taps through to find out what each one is, and this
        screen is where a shop goes when something has gone wrong.
      */}
      <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>{description}</Text>
    </CardLink>
  );
}

export default function AccountScreen() {
  const { t, language, setLanguage } = useLanguage();
  const ask = useAsk();
  const [summary, setSummary] = useState<ShopFinanceSummary>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSummary(await getMyFinanceSummary());
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('account.couldNotLoad')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const leave = useCallback(async () => {
    /*
     * Confirmed, because it is one tap from a menu and the way back is a
     * password somebody may not have with them. `useAsk` rather than
     * `Alert.alert`: the platform dialog renders outside React, so it could be
     * neither translated by the provider around this tree nor reached by a
     * test.
     */
    const confirmed = await ask.confirm({
      title: t('security.signOutThisTitle'),
      description: t('security.signOutThisBody'),
      confirmLabel: t('common.signOut'),
      danger: true,
    });
    if (!confirmed) return;
    // The whole sequence, including unregistering this device's push token
    // while the credential that authorises it is still valid.
    await leaveSession();
  }, [ask, t]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('account.loading')} />
      </Screen>
    );
  }

  if (!summary) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <EmptyState
            title={t('account.noShopLinked')}
            description={t('account.noShopLinkedBody')}
          />
        )}
      </Screen>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colour.canvas }}
      contentContainerStyle={{
        padding: layout.space[4],
        gap: layout.space[3],
        paddingBottom: layout.space[10],
      }}
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

      {summary.creditBlocked ? (
        <Card style={{ borderColor: colour.danger }}>
          <Text
            accessibilityRole="header"
            style={{ color: colour.danger, fontWeight: '700', fontSize: layout.fontSize.lg }}
          >
            {t('account.creditBlockedTitle')}
          </Text>
          <Text style={{ color: colour.text }}>
            {summary.blockReason ?? t('account.creditBlockedBody')}
          </Text>
          {/*
           * The banner used to be a dead end — a red box telling a shop owner
           * their account was blocked, with nothing to press. The statement is
           * where they can see which invoices caused it.
           */}
          <Button
            variant="secondary"
            label={t('account.seeWhatIsOwed')}
            onPress={() => router.push('/(protected)/statement')}
          />
        </Card>
      ) : null}

      <Card>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: layout.space[3],
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: layout.fontSize.xl, fontWeight: '700', color: colour.text }}>
              {summary.shop.name}
            </Text>
            <Text style={{ color: colour.textMuted }}>{summary.shop.reference}</Text>
          </View>
          <StatusPill kind="shop" status={summary.shop.status} />
        </View>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
        <Metric
          label={t('account.currentDue')}
          value={formatMoneyMinor(summary.outstandingBalanceMinor)}
          tone={summary.outstandingBalanceMinor > 0 ? 'warning' : 'normal'}
        />
        <Metric
          label={t('account.overdue')}
          value={formatMoneyMinor(summary.overdueBalanceMinor)}
          tone={summary.overdueBalanceMinor > 0 ? 'warning' : 'normal'}
        />
        <Metric
          label={t('account.availableCredit')}
          value={formatMoneyMinor(summary.availableCreditMinor)}
        />
        <Metric
          label={t('account.creditLimit')}
          value={formatMoneyMinor(summary.creditLimitMinor)}
        />
        <Metric
          label={t('account.creditUsed')}
          value={formatPercentFromBasisPoints(summary.creditUtilisationBps)}
        />
        <Metric
          label={t('account.paymentTerms')}
          value={t('account.days', { count: summary.paymentTermsDays })}
        />
      </View>

      <SectionTitle>{t('account.records')}</SectionTitle>
      <MenuRow
        label={t('account.invoices')}
        description={t('account.invoicesBody')}
        to="/(protected)/invoices"
      />
      <MenuRow
        label={t('account.paymentHistory')}
        description={t('account.paymentHistoryBody')}
        to="/(protected)/payments"
      />
      <MenuRow
        label={t('account.statement')}
        description={t('account.statementBody')}
        to="/(protected)/statement"
      />
      <MenuRow
        label={t('returns.titleOwner')}
        description={t('account.returnsBody')}
        to="/(protected)/(tabs)/returns"
      />

      <SectionTitle>{t('account.settingsHeading')}</SectionTitle>
      <MenuRow
        label={t('addresses.title')}
        description={t('addresses.subtitle')}
        to="/(protected)/addresses"
      />
      <MenuRow
        label={t('notifications.preferencesTitle')}
        description={t('account.notificationsBody')}
        to="/(protected)/notification-preferences"
      />
      <MenuRow
        label={t('security.whereSignedIn')}
        description={t('account.securityBody')}
        to="/(protected)/(tabs)/security"
      />
      <MenuRow
        label={t('auth.changeOwnTitle')}
        description={t('auth.changeOwnBody')}
        to="/(protected)/change-password"
      />

      <Card>
        <SectionTitle>{t('nav.language')}</SectionTitle>
        {/*
          `FilterChips` rather than a bespoke row of buttons: it announces
          which option is selected through `accessibilityState`, which a pair
          of coloured `Pressable`s does not.
        */}
        <FilterChips
          label={t('nav.language')}
          value={language}
          onChange={(next) => setLanguage(next as Language)}
          options={LANGUAGES.map((code) => ({
            value: code,
            // `LANGUAGE_LABEL`, not the catalogue: each language names itself
            // in its own script, and "Bengali" written in English is of no
            // help to somebody looking for বাংলা. It is also the one label
            // that must not change when the language does.
            label: LANGUAGE_LABEL[code],
          }))}
        />
      </Card>

      <Button variant="danger" label={t('common.signOut')} onPress={() => void leave()} />
    </ScrollView>
  );
}
