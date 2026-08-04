import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import type { Order, Shop } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { toMoneyInputValue } from '@medsupply/utilities';
import { apiClient } from '../../src/api/client';
import { formatMoneyMinor, parseMoney } from '../../src/finance/money';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
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
import { layout } from '../../src/theme';

/** What the server will enforce, rather than what this screen can guess. */
interface Credit {
  creditLimitMinor: number;
  outstandingMinor: number;
  reservedExposureMinor: number;
  availableCreditMinor: number;
  projectedExposureMinor: number;
  orderBlocked: boolean;
  blockReasons: string[];
}

interface Review {
  order: Order;
  credit?: Credit;
  canOverrideCredit?: boolean;
}

/**
 * A line as the manager is editing it.
 *
 * The price is the **typed string**, converted through `parseMoney` on submit.
 * It was posted as a bare `Number`, so a manager typing 12.50 sent twelve —
 * and the quantity had the same defect one field along.
 */
interface Line {
  orderItemId: string;
  approvedQuantity: number;
  unitPrice: string;
  lineDiscount: string;
}

type Action = 'start' | 'approve' | 'hold' | 'reject';

const minor = (value: string) => {
  const parsed = parseMoney(value);
  return parsed.ok ? parsed.minor : 0;
};

/** Quantities are whole units. Anything else is a typo, not a quantity. */
const units = (value: string) => {
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

export default function ApprovalReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const ask = useAsk();

  const [review, setReview] = useState<Review>();
  const [lines, setLines] = useState<Line[]>([]);
  const [orderDiscount, setOrderDiscount] = useState('0');
  const [delivery, setDelivery] = useState('0');
  const [internal, setInternal] = useState('');
  const [ownerNote, setOwnerNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data: Review = (await apiClient.get(`/approvals/${id}`)).data.data;
      setReview(data);
      setLines(
        data.order.items.map((item) => ({
          orderItemId: String((item as { _id?: string })._id ?? item.medicineId),
          approvedQuantity: item.requestedQuantity,
          unitPrice: toMoneyInputValue(item.estimatedUnitPriceMinor),
          lineDiscount: '0',
        })),
      );
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('approvals.couldNotLoadOne')));
    } finally {
      setLoading(false);
    }
  }, [id, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const total =
    lines.reduce(
      (sum, line) => sum + line.approvedQuantity * minor(line.unitPrice) - minor(line.lineDiscount),
      0,
    ) -
    minor(orderDiscount) +
    minor(delivery);

  /**
   * The manager is told what happened, in words, and stays on the screen.
   *
   * Every action ended in `Alert.alert('Done', …)` — rendered outside React, so
   * it could not be translated by the provider around this tree and was
   * invisible to a test — and then `router.back()`, which took the manager away
   * before they could see whether the next action was still available.
   */
  async function act(name: Action) {
    if (!review || busy) return;
    const update = (patch: Record<string, unknown>) => ({
      version: review.order.version,
      ...patch,
    });
    let body: Record<string, unknown> = update({});

    if (name === 'approve') {
      const unparseable = [
        ...lines.map((line) => line.unitPrice),
        ...lines.map((line) => line.lineDiscount),
        orderDiscount,
        delivery,
      ].some((value) => !parseMoney(value).ok);
      if (unparseable) {
        toast.error(t('approvals.badAmount'));
        return;
      }

      let override = false;
      if (review.credit?.orderBlocked) {
        if (!review.canOverrideCredit) {
          toast.error(t('approvals.adminOnlyBody'));
          return;
        }
        /*
         * `creditOverride` was hard-coded `false` here, so a manager facing a
         * blocked order had no path forward at all on this client — the service
         * has supported an override since phase 4 that nothing could ask for.
         * The reason is required by the server, and it is what the audit record
         * will hold, so it is asked for rather than assumed.
         */
        const reason = await ask.prompt({
          title: t('approvals.blocked'),
          description: t('approvals.overrideBody'),
          label: t('approvals.internalNotes'),
          multiline: true,
          confirmLabel: t('approvals.overrideLabel'),
          danger: true,
          initialValue: internal,
          validate: requireReason(t),
        });
        if (!reason) return;
        setInternal(reason);
        body = update({ internalNotes: reason });
        override = true;
      }

      body = {
        ...body,
        lines: lines.map((line) => ({
          orderItemId: line.orderItemId,
          approvedQuantity: line.approvedQuantity,
          unitPriceMinor: minor(line.unitPrice),
          lineDiscountMinor: minor(line.lineDiscount),
        })),
        orderDiscountMinor: minor(orderDiscount),
        deliveryChargeMinor: minor(delivery),
        internalNotes: (body.internalNotes as string | undefined) ?? internal ?? undefined,
        shopOwnerNotes: ownerNote || undefined,
        creditOverride: override,
      };
    } else if (name !== 'start') {
      const reason = await ask.prompt({
        title: name === 'hold' ? t('approvals.holdTitle') : t('approvals.rejectTitle'),
        description: name === 'hold' ? t('approvals.holdBody') : t('approvals.rejectBody'),
        label: t('actions.reason'),
        multiline: true,
        confirmLabel: name === 'hold' ? t('approvals.holdConfirm') : t('approvals.rejectConfirm'),
        danger: name === 'reject',
        validate: requireReason(t),
      });
      if (!reason) return;
      body = update({
        reason,
        internalNotes: internal || undefined,
        shopOwnerNotes: ownerNote || reason,
      });
    }

    setBusy(true);
    try {
      await apiClient.post(`/approvals/${id}/${name}`, body);
      toast.success(
        {
          start: t('approvals.started'),
          hold: t('approvals.held'),
          reject: t('approvals.rejected'),
          approve: t('approvals.approved'),
        }[name],
      );
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('approvals.actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('approvals.loadingOne')} />
      </Screen>
    );
  }

  if (!review) {
    return (
      <Screen>
        <ErrorState message={error || t('approvals.couldNotLoadOne')} onRetry={() => void load()} />
        <Button
          variant="secondary"
          label={t('approvals.backToQueue')}
          onPress={() => router.back()}
        />
      </Screen>
    );
  }

  const { order, credit } = review;
  const shop = order.shopId as Shop;
  const patch = (index: number, next: Partial<Line>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...next } : line)));

  return (
    <Screen>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Card>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: layout.space[2],
          }}
        >
          <SectionTitle>{order.reference}</SectionTitle>
          <StatusPill kind="order" status={order.status} />
        </View>
        <ListRow label={t('finance.shop')} value={shop.name} />
        <ListRow label={t('fields.reference')} value={shop.reference} />
      </Card>

      {/*
       * The figures come from the server's credit summary.
       *
       * This screen showed one number, computed here as
       * `creditLimit - outstandingBalance`, which ignores credit already
       * reserved by orders in flight — so it could tell a manager an order fits
       * and then have the approval refused on the next tap.
       */}
      {credit ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[3] }}>
          <Metric
            label={t('approvals.creditLimit')}
            value={formatMoneyMinor(credit.creditLimitMinor)}
          />
          <Metric
            label={t('approvals.outstanding')}
            value={formatMoneyMinor(credit.outstandingMinor)}
            tone={credit.outstandingMinor > 0 ? 'warning' : 'normal'}
          />
          <Metric
            label={t('approvals.alreadyCommitted')}
            value={formatMoneyMinor(credit.reservedExposureMinor)}
          />
          <Metric
            label={t('approvals.availableCredit')}
            value={formatMoneyMinor(credit.availableCreditMinor)}
            tone={credit.availableCreditMinor <= 0 ? 'warning' : 'normal'}
          />
        </View>
      ) : null}

      {credit?.orderBlocked ? (
        <ErrorState
          title={t('approvals.blocked')}
          message={
            credit.blockReasons.join(' ') ||
            t('approvals.blockedBody', {
              shop: shop.name,
              projected: formatMoneyMinor(credit.projectedExposureMinor),
              limit: formatMoneyMinor(credit.creditLimitMinor),
            })
          }
        />
      ) : null}

      <SectionTitle>{t('approvals.requested')}</SectionTitle>
      {order.items.map((item, index) => (
        <Card key={String((item as { _id?: string })._id ?? item.medicineId)}>
          <ListRow label={t('fields.medicine')} value={item.medicineSnapshot.brandName} />
          <ListRow label={t('approvals.columnRequested')} value={item.requestedQuantity} numeric />
          <Field label={t('approvals.approvedFor', { brand: item.medicineSnapshot.brandName })}>
            <Input
              label={t('approvals.approvedFor', { brand: item.medicineSnapshot.brandName })}
              keyboardType="number-pad"
              value={String(lines[index]?.approvedQuantity ?? 0)}
              onChangeText={(value) => patch(index, { approvedQuantity: units(value) })}
            />
          </Field>
          <Field label={t('approvals.priceFor', { brand: item.medicineSnapshot.brandName })}>
            <Input
              label={t('approvals.priceFor', { brand: item.medicineSnapshot.brandName })}
              keyboardType="decimal-pad"
              value={lines[index]?.unitPrice ?? '0'}
              onChangeText={(value) => patch(index, { unitPrice: value })}
              invalid={!parseMoney(lines[index]?.unitPrice ?? '0').ok}
            />
          </Field>
          <Field label={t('approvals.discountFor', { brand: item.medicineSnapshot.brandName })}>
            <Input
              label={t('approvals.discountFor', { brand: item.medicineSnapshot.brandName })}
              keyboardType="decimal-pad"
              value={lines[index]?.lineDiscount ?? '0'}
              onChangeText={(value) => patch(index, { lineDiscount: value })}
              invalid={!parseMoney(lines[index]?.lineDiscount ?? '0').ok}
            />
          </Field>
        </Card>
      ))}

      <SectionTitle>{t('approvals.adjustments')}</SectionTitle>
      <Card>
        <Field label={t('approvals.orderDiscount')}>
          <Input
            label={t('approvals.orderDiscount')}
            keyboardType="decimal-pad"
            value={orderDiscount}
            onChangeText={setOrderDiscount}
            invalid={!parseMoney(orderDiscount).ok}
          />
        </Field>
        <Field label={t('approvals.deliveryCharge')}>
          <Input
            label={t('approvals.deliveryCharge')}
            keyboardType="decimal-pad"
            value={delivery}
            onChangeText={setDelivery}
            invalid={!parseMoney(delivery).ok}
          />
        </Field>
        <Field label={t('approvals.internalNotes')}>
          <Input
            label={t('approvals.internalNotes')}
            multiline
            value={internal}
            onChangeText={setInternal}
            style={{ minHeight: layout.space[10], paddingTop: layout.space[3] }}
          />
        </Field>
        <Field label={t('approvals.shopNotes')}>
          <Input
            label={t('approvals.shopNotes')}
            multiline
            value={ownerNote}
            onChangeText={setOwnerNote}
            style={{ minHeight: layout.space[10], paddingTop: layout.space[3] }}
          />
        </Field>
        <ListRow label={t('approvals.approvalTotal')} value={formatMoneyMinor(total)} numeric />
      </Card>

      <Button
        label={t('approvals.confirmApproval')}
        busy={busy}
        onPress={() => void act('approve')}
      />
      <Button
        variant="secondary"
        label={t('approvals.startReview')}
        disabled={busy}
        onPress={() => void act('start')}
      />
      <View style={{ flexDirection: 'row', gap: layout.space[2] }}>
        <Button
          variant="secondary"
          style={{ flex: 1 }}
          label={t('approvals.hold')}
          disabled={busy}
          onPress={() => void act('hold')}
        />
        <Button
          variant="danger"
          style={{ flex: 1 }}
          label={t('approvals.reject')}
          disabled={busy}
          onPress={() => void act('reject')}
        />
      </View>
    </Screen>
  );
}
