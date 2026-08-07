import { useCallback, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ShopStatus, type Shop } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import {
  getShop,
  getShopCredit,
  mayReadLedger,
  setShopStatus,
  type CreditSummary,
} from '../../src/customers/api';
import { formatMoneyMinor } from '../../src/finance/money';
import { formatFinanceDate } from '../../src/finance/date';
import { useAuthStore } from '../../src/store/useAuth';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Metric,
  Screen,
  SectionTitle,
  StatusPill,
  requireReason,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * One customer, from the counter.
 *
 * The screen a representative opens standing in front of the shop, and the
 * three figures on it are the ones that decide whether to take the order:
 * **owed, overdue, credit left**. Those were management-only until this phase,
 * so the answer to "can I take this order" was a telephone call to the office.
 *
 * A rep sees the summary and not the ledger. That is the deliberate line: the
 * ledger and the statement are the documents a conversation about money is had
 * from, and that conversation is a manager's. `mayReadLedger` keeps the screens
 * and the server agreeing about where the line is.
 */
export default function ShopDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const role = useAuthStore((state) => state.user?.role);
  const [shop, setShop] = useState<Shop>();
  const [credit, setCredit] = useState<CreditSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      /*
       * Both together, and a failed summary does not hide the customer. A rep
       * outside their territory gets a 403 on the money and the record still
       * tells them who they are looking at.
       */
      const [record, money] = await Promise.allSettled([getShop(id), getShopCredit(id)]);
      if (record.status === 'fulfilled') setShop(record.value);
      else throw record.reason;
      if (money.status === 'fulfilled') setCredit(money.value);
    } catch (caught) {
      setError(errorMessage(caught, language, t('shops.couldNotLoadOne')));
    }
  }, [id, language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function suspend() {
    if (!shop) return;
    const suspending = shop.status !== ShopStatus.SUSPENDED;
    const reason = await ask.prompt({
      title: suspending ? t('shops.suspendTitle') : t('shops.reinstateTitle'),
      description: suspending ? t('shops.suspendBody') : t('shops.reinstateBody'),
      label: t('actions.reason'),
      confirmLabel: suspending ? t('shops.suspendConfirm') : t('shops.reinstateConfirm'),
      multiline: true,
      danger: suspending,
      validate: requireReason(t),
    });
    if (reason === null) return;

    setBusy(true);
    try {
      setShop(
        await setShopStatus(
          shop._id,
          suspending ? ShopStatus.SUSPENDED : ShopStatus.ACTIVE,
          reason,
        ),
      );
      toast.success(suspending ? t('shops.suspended') : t('shops.reinstated'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('shops.statusFailed')));
    } finally {
      setBusy(false);
    }
  }

  if (!shop) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <LoadingState label={t('shops.loadingOne')} />
        )}
      </Screen>
    );
  }

  const ledger = mayReadLedger(role);

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: layout.space[2],
        }}
      >
        <Text
          style={{
            color: colour.text,
            fontWeight: '700',
            fontSize: layout.fontSize.xl,
            flexShrink: 1,
          }}
        >
          {shop.name}
        </Text>
        <StatusPill kind="shop" status={shop.status} />
      </View>
      <Text style={{ color: colour.textMuted }}>{shop.reference}</Text>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {/*
        The reason a rep opens this screen. Three figures, and the block, which
        is the one thing that stops an order being taken at all.
      */}
      {credit ? (
        <Card style={credit.creditBlocked ? { borderColor: colour.danger } : undefined}>
          {credit.creditBlocked ? <Badge tone="danger">{t('shops.creditBlocked')}</Badge> : null}
          <Metric
            label={t('shops.owed')}
            value={formatMoneyMinor(credit.outstandingBalanceMinor)}
          />
          <Metric label={t('shops.overdue')} value={formatMoneyMinor(credit.overdueBalanceMinor)} />
          <Metric
            label={t('shops.creditLeft')}
            value={formatMoneyMinor(credit.availableCreditMinor)}
          />
          {credit.oldestDueDate ? (
            <ListRow label={t('shops.oldestDue')} value={formatFinanceDate(credit.oldestDueDate)} />
          ) : null}
        </Card>
      ) : null}

      <Card>
        <ListRow label={t('fields.phone')} value={shop.primaryPhone} />
        <Button
          variant="secondary"
          label={t('purchasing.ringShop', { name: shop.name })}
          onPress={() => void Linking.openURL(`tel:${shop.primaryPhone}`)}
        />
        {shop.drugLicenceNumber ? (
          <ListRow label={t('shops.drugLicenceNumber')} value={shop.drugLicenceNumber} />
        ) : null}
        {shop.territory ? <ListRow label={t('shops.territory')} value={shop.territory} /> : null}
        <ListRow
          label={t('shops.paymentTerms')}
          value={t('purchasing.days', { count: shop.paymentTermsDays })}
          numeric
        />
      </Card>

      <SectionTitle>{t('addresses.title')}</SectionTitle>
      {(shop.deliveryAddresses ?? []).length === 0 ? (
        <Text style={{ color: colour.warning }}>{t('shops.noAddresses')}</Text>
      ) : (
        (shop.deliveryAddresses as unknown as Array<Record<string, string | boolean>>).map(
          (address) => (
            <Card key={String(address._id)}>
              <Text style={{ color: colour.text, fontWeight: '600' }}>{String(address.label)}</Text>
              <Text style={{ color: colour.textMuted }}>
                {String(address.line1)}, {String(address.city)}
              </Text>
              {address.isDefault ? <Badge tone="brand">{t('addresses.default')}</Badge> : null}
            </Card>
          ),
        )
      )}

      {ledger ? (
        <>
          <Button
            variant="secondary"
            label={t('shops.openLedger')}
            onPress={() => router.push(`/(protected)/shop-ledger?id=${shop._id}` as never)}
          />
          <Button
            variant="secondary"
            label={t('shops.openStatement')}
            onPress={() => router.push(`/(protected)/shop-statement?id=${shop._id}` as never)}
          />
          <Button
            variant="secondary"
            busy={busy}
            label={shop.status === ShopStatus.SUSPENDED ? t('shops.reinstate') : t('shops.suspend')}
            onPress={() => void suspend()}
          />
        </>
      ) : null}
    </Screen>
  );
}
