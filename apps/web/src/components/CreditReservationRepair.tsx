import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserRole } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import { Button, Card, Field, Textarea, toast, useAsk } from './ui';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { useAuthStore } from '../store/useAuth';

/**
 * Give an old order the credit reservation it never got.
 *
 * `POST /finance/credit-reservations/backfill` exists because orders placed
 * before credit reservations were introduced hold credit that nothing records —
 * the customer's available credit is overstated by exactly those orders, and no
 * screen could correct it. It has been guarded, tested and documented since the
 * finance phase, and called by nothing.
 *
 * The control is deliberately blind: there is no endpoint that says whether a
 * reservation is missing, and inventing one for a screen would be a second
 * source of truth about credit. The server answers instead — it refuses with
 * `CREDIT_RESERVATION_CONFLICT` when a reservation already exists, and replays
 * rather than double-reserving when the same key arrives twice. So pressing
 * this on an order that does not need it is safe, and says so.
 */

const ADMINISTRATORS: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

export function CreditReservationRepair({ orderId }: { orderId: string }) {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [key, setKey] = useState(() => `backfill-${crypto.randomUUID()}`);

  if (!role || !ADMINISTRATORS.includes(role)) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const agreed = await ask.confirm({
      title: t('orders.backfillConfirmTitle'),
      description: t('orders.backfillConfirmBody'),
      confirmLabel: t('orders.backfill'),
    });
    if (!agreed) return;

    setWorking(true);
    try {
      const response = await apiClient.post('/finance/credit-reservations/backfill', {
        orderId,
        reason: reason.trim(),
        idempotencyKey: key,
      });
      // The endpoint replays rather than creating a second reservation, and
      // says which happened. Reporting a replay as a fresh one would tell an
      // administrator they had just changed something when they had not.
      const replayed = Boolean(response.data.meta?.idempotentReplay);
      // The customer's available credit is the figure that just moved, and it
      // is read on the shop page and every finance summary. Leaving those on
      // the old number is how somebody approves an order the credit no longer
      // covers.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.finance.all }),
        queryClient.invalidateQueries({ queryKey: keys.shops.all }),
      ]);
      toast.success(replayed ? t('orders.backfillAlreadyDone') : t('orders.backfilled'));
      setReason('');
      setKey(`backfill-${crypto.randomUUID()}`);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('orders.backfillFailed')));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card className="mt-4">
      <h2 className="mb-1 text-lg font-semibold text-text">{t('orders.backfillTitle')}</h2>
      <p className="mb-3 text-sm text-text-muted">{t('orders.backfillBody')}</p>

      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <Field label={t('orders.backfillReason')} hint={t('hints.backfillReason')}>
          <Textarea
            rows={2}
            value={reason}
            data-test="backfill-reason"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div>
          <Button type="submit" disabled={working || reason.trim().length < 5}>
            {working ? t('orders.backfilling') : t('orders.backfill')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
