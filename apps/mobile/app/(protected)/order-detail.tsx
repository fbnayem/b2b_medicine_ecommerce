import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { Order } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { ActivityTimelineView } from '../../src/notifications/ActivityTimelineView';
import {
  actionsFor,
  CANCELLATION_REASON,
  cancellationReasonProblem,
} from '../../src/orders/actions';
import { useAuthStore } from '../../src/store/useAuth';
import { useCart, type CartLine } from '../../src/store/useCart';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { formatMoneyMinor } from '../../src/finance/money';
import { formatFinanceDateTime } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  StatusPill,
  requireReason,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * An order, and **the things a customer can do with it**.
 *
 * This screen was read-only. Three endpoints that have existed for phases had no
 * caller anywhere in this application — reordering, asking to cancel, and
 * following the delivery — so a shop owner who wanted any of them had to find a
 * computer. That is most of what a customer does *after* placing an order, which
 * made this the screen they reached most often and could do least on.
 *
 * `src/orders/actions.ts` decides which buttons appear and records why each
 * boundary is where it is. The server decides too; this only avoids offering
 * something that would be refused.
 */
export default function OrderDetailScreen() {
  const { id, submitted } = useLocalSearchParams<{ id: string; submitted?: string }>();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const replaceBasket = useCart((state) => state.replace);
  const [order, setOrder] = useState<Order>();
  const [error, setError] = useState('');
  const role = useAuthStore((state) => state.user?.role);
  const [busy, setBusy] = useState<'reorder' | 'cancel' | 'grant' | 'refuse' | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get(`/orders/${id}`);
      setOrder(response.data.data);
    } catch (caught) {
      setError(errorMessage(caught, language, t('orders.couldNotLoadOne')));
    }
  }, [id, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Order the same things again.
   *
   * `POST /orders/{id}/duplicate` makes a **draft** and returns it, so the
   * basket is filled from the server's answer rather than from this screen's
   * copy of the order — the draft has already been re-priced and re-checked
   * against today's catalogue, and a line whose medicine has since been
   * delisted simply is not in it.
   */
  async function reorder() {
    setBusy('reorder');
    try {
      const response = await apiClient.post(`/orders/${id}/duplicate`);
      const draft = response.data.data as Order;
      const lines: CartLine[] = draft.items.map((item) => ({
        medicineId: String(item.medicineId),
        quantity: item.requestedQuantity,
        snapshot: {
          brandName: item.medicineSnapshot.brandName,
          strength: item.medicineSnapshot.strength,
          // The draft does not carry the order limits, and the basket only
          // needs them to clamp typing. One is a safe floor; the quantity
          // itself already satisfied the server when the draft was made.
          minimum: 1,
        },
      }));
      replaceBasket(lines, String(draft._id));
      toast.success(t('orders.reorderReady'));
      router.push('/(protected)/(tabs)/cart');
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('orders.reorderFailed')));
    } finally {
      setBusy(null);
    }
  }

  /**
   * The manager's half of a cancellation: granting it, or refusing it.
   *
   * Granting releases the stock and the credit the order was holding, which is
   * why it takes a version and an idempotency key — a retry after a timeout
   * must not release them twice. Refusing writes a sentence the customer reads,
   * so it is required rather than optional.
   */
  async function decide(approve: boolean) {
    const reason = await ask.prompt({
      title: approve ? t('orders.grantTitle') : t('orders.refuseTitle'),
      description: approve ? t('orders.grantBody') : t('orders.refuseBody'),
      label: t('actions.reason'),
      confirmLabel: approve ? t('orders.grantCancellation') : t('orders.refuseCancellation'),
      multiline: true,
      danger: approve,
      validate: requireReason(t),
    });
    if (reason === null) return;

    setBusy(approve ? 'grant' : 'refuse');
    try {
      await apiClient.post(`/orders/${id}/cancellation-decision`, {
        approve,
        reason: reason.trim(),
        version: order?.version ?? 0,
        idempotencyKey: createFinancialIdempotencyKey('cancellation-decision', String(id)),
      });
      toast.success(approve ? t('orders.cancellationGranted') : t('orders.cancellationRefused'));
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('orders.decisionFailed')));
    } finally {
      setBusy(null);
    }
  }

  /** Asking to cancel, which is not cancelling — a manager decides. */
  async function askToCancel() {
    const reason = await ask.prompt({
      title: t('orders.cancelTitle'),
      description: t('orders.cancelBody'),
      label: t('orders.cancelLabel'),
      hint: t('orders.cancelReasonHint', { minimum: CANCELLATION_REASON.minimum }),
      confirmLabel: t('orders.cancelConfirm'),
      multiline: true,
      danger: true,
      // Checked here so a reason that is too short is refused while it is still
      // on screen and editable, rather than as a 400 after it has been sent.
      validate: (value) => {
        const problem = cancellationReasonProblem(value);
        if (problem === 'tooShort')
          return t('orders.cancelReasonHint', { minimum: CANCELLATION_REASON.minimum });
        if (problem === 'tooLong')
          return t('orders.cancelReasonTooLong', { maximum: CANCELLATION_REASON.maximum });
        return null;
      },
    });
    if (!reason) return;

    setBusy('cancel');
    try {
      await apiClient.post(`/orders/${id}/cancellation-request`, { reason: reason.trim() });
      toast.success(t('orders.cancelAsked'));
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('orders.cancelFailed')));
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  if (!order) {
    return (
      <Screen>
        <LoadingState label={t('orders.loadingOne')} />
      </Screen>
    );
  }

  const can = actionsFor(order);
  // The manager's half. A shop owner sees the request they made; the people
  // who answer it are the ones the endpoint admits.
  const canDecide = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(String(role));

  return (
    <Screen>
      {submitted ? (
        <View
          accessible
          accessibilityRole="alert"
          style={{
            backgroundColor: colour.brandSubtle,
            borderRadius: layout.radius.md,
            padding: layout.space[3],
          }}
        >
          <Text style={{ color: colour.text, fontWeight: '600' }}>{t('orders.submitted')}</Text>
        </View>
      ) : null}

      <Text style={{ color: colour.brand, fontSize: layout.fontSize.sm }}>{order.reference}</Text>
      <StatusPill kind="order" status={order.status} />

      {order.cancellationRequestedAt ? (
        // Said plainly, because asking and being granted are different things
        // and a shop that assumes otherwise stops expecting the delivery.
        <Card style={{ borderColor: colour.warning }}>
          <Text style={{ color: colour.text }}>{t('orders.cancellationRequested')}</Text>
          {order.cancellationReason ? (
            <Text style={{ color: colour.textMuted }}>{order.cancellationReason}</Text>
          ) : null}

          {/*
            And the answer, for whoever has to give it.

            `POST /orders/{id}/cancellation-decision` had no caller on this
            client, so a customer's request sat here as a warning nobody on a
            phone could act on. Granting it releases the stock and the credit;
            refusing it says why, and the customer reads that sentence.
          */}
          {canDecide ? (
            <>
              <Button
                busy={busy === 'grant'}
                label={t('orders.grantCancellation')}
                onPress={() => void decide(true)}
              />
              <Button
                variant="secondary"
                busy={busy === 'refuse'}
                label={t('orders.refuseCancellation')}
                onPress={() => void decide(false)}
              />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>{t('orders.whatYouOrdered')}</SectionTitle>
        {order.items.map((item) => (
          <ListRow
            key={String(item.medicineId)}
            label={`${item.medicineSnapshot.brandName} × ${item.requestedQuantity}`}
            value={formatMoneyMinor(item.estimatedLineTotalMinor)}
            numeric
          />
        ))}
        <ListRow
          label={t('orders.estimatedTotal')}
          value={formatMoneyMinor(order.estimatedTotalMinor)}
          numeric
        />
      </Card>

      <Card>
        <SectionTitle>{t('orders.whatYouCanDo')}</SectionTitle>
        {can.reorder ? (
          <Button
            label={t('orders.repeat')}
            busy={busy === 'reorder'}
            onPress={() => void reorder()}
          />
        ) : null}
        {can.track ? (
          <Button
            variant="secondary"
            label={t('orders.trackDelivery')}
            onPress={() =>
              router.push({
                pathname: '/(protected)/delivery-track',
                params: { orderId: String(order._id) },
              })
            }
          />
        ) : null}
        {/*
          Invoices and returns are reached from the invoice list under Account,
          not from here — `Order` carries no invoice id. `src/orders/actions.ts`
          records why that is followed rather than worked around.
        */}
        <Button
          variant="secondary"
          label={t('account.invoices')}
          onPress={() => router.push('/(protected)/invoices')}
        />
        {can.askToCancel ? (
          <Button
            variant="danger"
            label={t('orders.requestCancellation')}
            busy={busy === 'cancel'}
            disabled={Boolean(order.cancellationRequestedAt)}
            onPress={() => void askToCancel()}
          />
        ) : null}
      </Card>

      <Card>
        <SectionTitle>{t('orders.timeline')}</SectionTitle>
        {order.statusHistory.map((entry, index) => (
          <ListRow
            key={`${entry.to}-${index}`}
            label={formatFinanceDateTime(entry.at)}
            value={<StatusPill kind="order" status={entry.to} />}
          />
        ))}
      </Card>

      <ActivityTimelineView
        entityType="Order"
        entityId={String(order._id)}
        title={t('orders.activity')}
      />
    </Screen>
  );
}
