import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LedgerTransactionType, UserRole } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import { Button, Card, Field, Input, Select, Textarea, toast, useAsk } from './ui';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { useAuthStore } from '../store/useAuth';
import { formatMinor } from '../lib/finance';

/**
 * The three finance repairs, and the first screen any of them has ever had.
 *
 * `POST /finance/adjustments`, `GET /finance/reconciliation/{shopId}` and
 * `POST /finance/reconciliation/{shopId}/repair` were written, guarded, tested
 * and documented — and reachable from no client at all, on either application.
 * A ledger that had drifted could only be checked with a database console, and
 * an opening balance could only be set the same way, which is the one place a
 * finance system must not require one.
 *
 * The check reads and the repair writes, so they are two buttons and not one:
 * `reconcileShopFinance(shopId, actor, repair)` takes the difference between
 * them as a flag, and a screen that hid it behind a single "reconcile" would
 * make an irreversible posting look like a refresh.
 */

/** What `reconcileShopFinance` answers with. */
interface Reconciliation {
  ledgerBalanceMinor: number;
  cachedBalanceMinor: number;
  projectionDifferenceMinor: number;
  missingInvoiceCharges: string[];
  postedPaymentsWithoutLedger: string[];
  deliveryCollectionsWithoutPayment: string[];
  repairedInvoiceCharges: number;
  repairedProjection: boolean;
}

/**
 * The four an administrator may post by hand. The rest of
 * `LedgerTransactionType` is written by the system from an invoice, a payment
 * or a return, and offering those here would invite a second, unbacked copy of
 * a transaction that already has a source document.
 */
const POSTABLE = [
  LedgerTransactionType.OPENING_BALANCE,
  LedgerTransactionType.CREDIT_ADJUSTMENT,
  LedgerTransactionType.DEBIT_ADJUSTMENT,
  LedgerTransactionType.RETURN_CREDIT,
] as const;

const READERS: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
const WRITERS: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

/**
 * A key the server can recognise a resend by.
 *
 * `LedgerAdjustmentSchema` requires between 8 and 120 characters and the
 * endpoint replays rather than double-posts when it sees one twice — so this is
 * minted once per attempt and reused if the request has to be retried, which is
 * exactly the case a duplicate credit would otherwise be created by.
 */
const mintKey = () => `adj-${crypto.randomUUID()}`;

export function LedgerCorrections({ shopId }: { shopId: string }) {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const [report, setReport] = useState<Reconciliation | null>(null);
  const [checking, setChecking] = useState(false);
  const [posting, setPosting] = useState(false);
  const [type, setType] = useState<string>(LedgerTransactionType.CREDIT_ADJUSTMENT);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [key, setKey] = useState(mintKey);

  if (!role || !READERS.includes(role)) return null;
  const mayWrite = WRITERS.includes(role);

  async function check() {
    setChecking(true);
    try {
      const response = await apiClient.get(`/finance/reconciliation/${shopId}`);
      setReport(response.data.data as Reconciliation);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('finance.reconcileFailed')));
    } finally {
      setChecking(false);
    }
  }

  async function repair() {
    const agreed = await ask.confirm({
      title: t('finance.repairTitle'),
      description: t('finance.repairBody'),
      confirmLabel: t('finance.repair'),
      danger: true,
    });
    if (!agreed) return;
    setChecking(true);
    try {
      const response = await apiClient.post(`/finance/reconciliation/${shopId}/repair`);
      const data = response.data.data as Reconciliation;
      setReport(data);
      /*
       * The ledger and the summary above this panel are what just changed —
       * charges posted, the customer's balance reset to the ledger figure. A
       * repair that left them showing the old numbers would look like it had
       * done nothing, and invite somebody to run it again.
       */
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.finance.all }),
        queryClient.invalidateQueries({ queryKey: keys.shops.all }),
      ]);
      toast.success(
        t('finance.repaired', {
          charges: data.repairedInvoiceCharges,
        }),
      );
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('finance.repairFailed')));
    } finally {
      setChecking(false);
    }
  }

  async function postAdjustment(event: FormEvent) {
    event.preventDefault();
    /*
     * Taka in, minor units out. Every other money field on this application
     * does the same conversion, and doing it here rather than asking for paisa
     * is the difference between typing 250 and typing 25000 for the same
     * correction.
     */
    const taka = Number(amount);
    if (!Number.isFinite(taka) || taka <= 0) {
      toast.error(t('finance.adjustmentAmountInvalid'));
      return;
    }
    const amountMinor = Math.round(taka * 100);

    const agreed = await ask.confirm({
      title: t('finance.adjustmentConfirmTitle'),
      description: t('finance.adjustmentConfirmBody', {
        amount: formatMinor(amountMinor),
        type: t(`ledgerTransactionType.${type}`),
      }),
      confirmLabel: t('finance.postAdjustment'),
      danger: true,
    });
    if (!agreed) return;

    setPosting(true);
    try {
      await apiClient.post('/finance/adjustments', {
        shopId,
        type,
        amountMinor,
        description: description.trim(),
        idempotencyKey: key,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.finance.all }),
        queryClient.invalidateQueries({ queryKey: keys.shops.all }),
      ]);
      toast.success(t('finance.adjustmentPosted'));
      setAmount('');
      setDescription('');
      // A new key only after a posting that succeeded: a failure that is
      // retried must carry the same key, or the retry becomes a second entry.
      setKey(mintKey());
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('finance.adjustmentFailed')));
    } finally {
      setPosting(false);
    }
  }

  const difference = report?.projectionDifferenceMinor ?? 0;
  const problems =
    report &&
    (difference !== 0 ||
      report.missingInvoiceCharges.length > 0 ||
      report.postedPaymentsWithoutLedger.length > 0 ||
      report.deliveryCollectionsWithoutPayment.length > 0);

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-1 text-lg font-semibold text-text">{t('finance.reconcileTitle')}</h2>
        <p className="mb-3 text-sm text-text-muted">{t('finance.reconcileBody')}</p>

        <div className="flex flex-wrap gap-2">
          <Button data-test="reconcile-check" disabled={checking} onClick={() => void check()}>
            {checking ? t('finance.reconcileChecking') : t('finance.reconcileCheck')}
          </Button>
          {mayWrite && report && problems && (
            <Button variant="danger" disabled={checking} onClick={() => void repair()}>
              {t('finance.repair')}
            </Button>
          )}
        </div>

        {report && (
          <dl className="m-0 mt-3" data-test="reconcile-report">
            <Line
              label={t('finance.ledgerBalance')}
              value={formatMinor(report.ledgerBalanceMinor)}
            />
            <Line
              label={t('finance.cachedBalance')}
              value={formatMinor(report.cachedBalanceMinor)}
            />
            <Line
              label={t('finance.difference')}
              value={formatMinor(difference)}
              tone={difference === 0 ? 'ok' : 'bad'}
            />
            <Line
              label={t('finance.missingCharges')}
              value={report.missingInvoiceCharges.join(', ') || t('finance.none')}
              tone={report.missingInvoiceCharges.length ? 'bad' : 'ok'}
            />
            <Line
              label={t('finance.paymentsNotPosted')}
              value={report.postedPaymentsWithoutLedger.join(', ') || t('finance.none')}
              tone={report.postedPaymentsWithoutLedger.length ? 'bad' : 'ok'}
            />
            <Line
              label={t('finance.collectionsNotRecorded')}
              value={report.deliveryCollectionsWithoutPayment.join(', ') || t('finance.none')}
              tone={report.deliveryCollectionsWithoutPayment.length ? 'bad' : 'ok'}
            />
            {!problems && (
              <p className="mt-2 text-text" data-test="reconcile-clean">
                {t('finance.reconcileClean')}
              </p>
            )}
          </dl>
        )}
      </Card>

      {mayWrite && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold text-text">{t('finance.adjustmentTitle')}</h2>
          <p className="mb-3 text-sm text-text-muted">{t('finance.adjustmentBody')}</p>

          <form className="flex flex-col gap-3" onSubmit={(event) => void postAdjustment(event)}>
            <Field label={t('finance.adjustmentType')} hint={t('hints.adjustmentType')}>
              <Select
                value={type}
                data-test="adjustment-type"
                onChange={(event) => setType(event.target.value)}
              >
                {POSTABLE.map((value) => (
                  <option key={value} value={value}>
                    {t(`ledgerTransactionType.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('finance.adjustmentAmount')} hint={t('hints.adjustmentAmount')}>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                data-test="adjustment-amount"
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>

            <Field label={t('finance.adjustmentReason')} hint={t('hints.adjustmentReason')}>
              <Textarea
                rows={3}
                value={description}
                data-test="adjustment-reason"
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>

            <div>
              <Button
                type="submit"
                variant="primary"
                disabled={posting || description.trim().length < 3 || !amount}
              >
                {posting ? t('finance.adjustmentPosting') : t('finance.postAdjustment')}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className={tone === 'bad' ? 'font-semibold text-danger' : 'text-text'}>{value}</dd>
    </div>
  );
}
