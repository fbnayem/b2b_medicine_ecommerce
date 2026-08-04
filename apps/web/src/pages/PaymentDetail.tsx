import { useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PaymentStatus, UserRole } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import {
  Button,
  Card,
  LinkButton,
  PageHeader,
  Resource,
  StatusPill,
  requireReason,
  toast,
  useAsk,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { createActionKey, formatFinanceDateTime, formatMinor } from '../lib/finance';
import { populatedName, type FinancePayment } from './financeTypes';

interface PaymentDetailProps {
  ownerMode?: boolean;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

export function PaymentDetail({ ownerMode = false }: PaymentDetailProps) {
  const ask = useAsk();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const [working, setWorking] = useState(false);
  const canReverse = !ownerMode && (role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN);

  const query = useApiResource<FinancePayment>(['payment', id], `/payments/${id}`);

  /*
   * One idempotency key per action, held until it succeeds. A double-click, or
   * a retry after a timeout, must not post the same money twice.
   */
  const actionKeys = useRef<Record<string, string>>({});
  function keyFor(action: string) {
    actionKeys.current[action] ??= createActionKey(`${action}-payment`);
    return actionKeys.current[action];
  }

  const recorded = searchParams.get('recorded');

  async function run(action: 'post' | 'fail' | 'reverse', done: string, reason?: string) {
    setWorking(true);
    try {
      await apiClient.post(`/payments/${id}/${action}`, {
        ...(reason ? { reason } : {}),
        idempotencyKey: keyFor(action),
      });
      delete actionKeys.current[action];
      await queryClient.invalidateQueries({ queryKey: ['payment', id] });
      toast.success(done);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('finance.recordFailed')));
    } finally {
      setWorking(false);
    }
  }

  async function openFile(path: string, failed: string) {
    try {
      const response = await apiClient.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast.error(failed);
    }
  }

  return (
    <main>
      <Resource
        query={query}
        loadingLabel={t('finance.loadingPayment')}
        errorMessageFallback={t('finance.couldNotLoadPayment')}
      >
        {(payment) => {
          const shop = typeof payment.shopId === 'string' ? undefined : payment.shopId;
          const invoice = typeof payment.invoiceId === 'string' ? undefined : payment.invoiceId;
          const delivery = typeof payment.deliveryId === 'string' ? undefined : payment.deliveryId;
          const reversal =
            typeof payment.reversalPaymentId === 'string' ? undefined : payment.reversalPaymentId;
          const original =
            typeof payment.reversesPaymentId === 'string' ? undefined : payment.reversesPaymentId;

          return (
            <>
              <PageHeader
                routeId={ownerMode ? 'my-payment-detail' : 'payment-detail'}
                title={payment.reference}
                description={<StatusPill kind="payment" status={payment.status} />}
                actions={
                  <>
                    <LinkButton to={ownerMode ? '/account/payments' : '/payments'}>
                      {t('finance.allPayments')}
                    </LinkButton>
                    <Button
                      onClick={() =>
                        void openFile(
                          `/payments/${payment._id}/receipt?format=pdf`,
                          t('finance.receiptFailed'),
                        )
                      }
                    >
                      {t('finance.receiptPdf')}
                    </Button>
                    {(payment.attachment || payment.attachmentId) && (
                      <Button
                        onClick={() =>
                          void openFile(
                            `/payments/${payment._id}/attachment`,
                            t('finance.attachmentFailed'),
                          )
                        }
                      >
                        {t('finance.paymentProof')}
                      </Button>
                    )}
                  </>
                }
              />

              {recorded && (
                <p
                  role="status"
                  className="mb-4 rounded-lg border border-success bg-success-subtle px-4 py-3 text-text"
                >
                  {t('finance.recorded')}
                </p>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="receipt-print">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-text">{t('finance.receipt')}</h2>
                    <StatusPill kind="payment" status={payment.status} />
                  </div>
                  <p className="mb-3 text-3xl font-semibold tabular-nums text-text">
                    {formatMinor(payment.amountMinor)}
                  </p>
                  <dl className="m-0">
                    <Detail label={t('fields.shop')}>
                      {shop?.name ?? '—'}{' '}
                      <span className="text-sm text-text-muted">{shop?.reference}</span>
                    </Detail>
                    <Detail label={t('finance.invoice')}>
                      {invoice?.reference ?? t('finance.unallocated')}
                    </Detail>
                    <Detail label={t('finance.delivery')}>{delivery?.reference ?? '—'}</Detail>
                    <Detail label={t('finance.method')}>
                      {t(`paymentMethod.${payment.method}`)}
                    </Detail>
                    <Detail label={t('finance.transactionReference')}>
                      {payment.transactionReference ?? '—'}
                    </Detail>
                    <Detail label={t('finance.collectedBy')}>
                      {populatedName(payment.collectedBy)}
                    </Detail>
                    <Detail label={t('finance.receivedBy')}>
                      {populatedName(payment.receivedBy)}
                    </Detail>
                    <Detail label={t('finance.collectedAt')}>
                      {formatFinanceDateTime(payment.collectionTime ?? payment.collectedAt)}
                    </Detail>
                    <Detail label={t('finance.postedAt')}>
                      {formatFinanceDateTime(payment.postingTime ?? payment.postedAt)}
                    </Detail>
                  </dl>
                  {payment.notes && (
                    <p className="mt-3 text-text-muted">
                      <strong className="text-text">{t('fields.notes')}:</strong> {payment.notes}
                    </p>
                  )}
                </Card>

                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">{t('finance.controls')}</h2>
                  <div className="flex flex-col items-start gap-2">
                    {payment.status === PaymentStatus.PENDING && !ownerMode && (
                      <>
                        <Button
                          variant="primary"
                          busy={working}
                          onClick={() => {
                            void (async () => {
                              const agreed = await ask.confirm({
                                title: t('finance.postTitle'),
                                description: t('finance.postToLedgerBody'),
                                confirmLabel: t('finance.postConfirm'),
                              });
                              if (agreed) await run('post', t('finance.postedOk'));
                            })();
                          }}
                        >
                          {t('finance.postToLedger')}
                        </Button>
                        <Button
                          variant="danger"
                          busy={working}
                          onClick={() => {
                            void (async () => {
                              const reason = await ask.prompt({
                                title: t('finance.markFailedTitle'),
                                description: t('finance.markFailedBody'),
                                label: t('actions.reason'),
                                multiline: true,
                                confirmLabel: t('finance.markFailedConfirm'),
                                danger: true,
                                validate: requireReason(t),
                              });
                              if (reason) await run('fail', t('finance.markedFailed'), reason);
                            })();
                          }}
                        >
                          {t('finance.markFailed')}
                        </Button>
                      </>
                    )}

                    {payment.status === PaymentStatus.POSTED && canReverse && (
                      <Button
                        variant="danger"
                        busy={working}
                        onClick={() => {
                          void (async () => {
                            /*
                             * Reversing posted money used to be a `window.confirm`
                             * followed by a `window.prompt`, and Playwright
                             * dismisses both — so a test could have claimed to
                             * cover this while cancelling it.
                             */
                            const reason = await ask.prompt({
                              title: t('finance.reverseTitle'),
                              description: t('finance.reverseBody'),
                              label: t('finance.reverseLabel'),
                              multiline: true,
                              confirmLabel: t('finance.reverseConfirm'),
                              danger: true,
                              validate: requireReason(t),
                            });
                            if (reason) await run('reverse', t('finance.reversed'), reason);
                          })();
                        }}
                      >
                        {t('finance.reverse')}
                      </Button>
                    )}

                    {ownerMode && <p className="text-text-muted">{t('finance.readOnly')}</p>}

                    {payment.reversalReference && (
                      <p className="text-text">
                        {t('finance.reversedBy', { reference: payment.reversalReference })}
                      </p>
                    )}
                    {reversal && (
                      <Link className="text-brand underline" to={`/payments/${reversal._id}`}>
                        {t('finance.openReversal', { reference: reversal.reference })}
                      </Link>
                    )}
                    {original && (
                      <Link className="text-brand underline" to={`/payments/${original._id}`}>
                        {t('finance.openOriginal', { reference: original.reference })}
                      </Link>
                    )}
                  </div>

                  <dl className="m-0 mt-3">
                    <Detail label={t('finance.source')}>
                      {payment.source?.replaceAll('_', ' ').toLowerCase() ?? t('finance.manual')}
                    </Detail>
                    <Detail label={t('finance.created')}>
                      {formatFinanceDateTime(payment.createdAt)}
                    </Detail>
                    <Detail label={t('finance.attachment')}>
                      {payment.attachment?.fileName ??
                        (payment.attachmentId ? t('finance.available') : t('finance.none'))}
                    </Detail>
                  </dl>
                </Card>
              </div>
            </>
          );
        }}
      </Resource>
    </main>
  );
}
