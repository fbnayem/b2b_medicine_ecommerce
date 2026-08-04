import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, errorMessage } from '../api/client';
import {
  Button,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  Resource,
  requireReason,
  toast,
  useAsk,
  type Column,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { createActionKey, formatFinanceDateTime, formatMinor } from '../lib/finance';
import { populatedName, type FinancePayment } from './financeTypes';

export function CollectionReview() {
  const ask = useAsk();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [workingId, setWorkingId] = useState('');

  const collections = useApiCollection<FinancePayment>(
    ['pending-collections'],
    '/payments?status=PENDING&source=DELIVERY_COLLECTION&limit=100',
  );

  // One key per payment per action, held until it succeeds: a retry after a
  // timeout must not post the same cash twice.
  const actionKeys = useRef<Record<string, string>>({});

  async function act(payment: FinancePayment, action: 'post' | 'fail', reason?: string) {
    const name = `${payment._id}:${action}`;
    actionKeys.current[name] ??= createActionKey(`${action}-collection`);
    setWorkingId(payment._id);
    try {
      await apiClient.post(`/payments/${payment._id}/${action}`, {
        ...(reason ? { reason } : {}),
        idempotencyKey: actionKeys.current[name],
      });
      delete actionKeys.current[name];
      await queryClient.invalidateQueries({ queryKey: ['pending-collections'] });
      toast.success(action === 'post' ? t('finance.postedOk') : t('finance.rejected'));
    } catch (caught) {
      toast.error(
        errorMessage(
          caught,
          language,
          action === 'post' ? t('finance.postFailed') : t('finance.rejectFailed'),
        ),
      );
    } finally {
      setWorkingId('');
    }
  }

  async function openProof(payment: FinancePayment) {
    try {
      const response = await apiClient.get(`/payments/${payment._id}/attachment`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast.error(t('finance.attachmentFailed'));
    }
  }

  const columns: ReadonlyArray<Column<FinancePayment>> = [
    {
      key: 'reference',
      header: t('finance.paymentReference'),
      cell: (payment) => (
        <div>
          <Link className="font-medium text-brand underline" to={`/payments/${payment._id}`}>
            {payment.reference}
          </Link>
          {payment.transactionReference && (
            <p className="text-sm text-text-muted">{payment.transactionReference}</p>
          )}
        </div>
      ),
    },
    {
      key: 'shop',
      header: t('fields.shop'),
      cell: (payment) => {
        const shop = typeof payment.shopId === 'string' ? undefined : payment.shopId;
        return (
          <div>
            <p className="text-text">{shop?.name ?? '—'}</p>
            <p className="text-sm text-text-muted">{shop?.reference}</p>
          </div>
        );
      },
    },
    {
      key: 'against',
      header: t('finance.invoice'),
      cell: (payment) => {
        const invoice = typeof payment.invoiceId === 'string' ? undefined : payment.invoiceId;
        const delivery = typeof payment.deliveryId === 'string' ? undefined : payment.deliveryId;
        return (
          <div>
            <p className="text-text">{invoice?.reference ?? '—'}</p>
            {delivery?.reference && <p className="text-sm text-text-muted">{delivery.reference}</p>}
          </div>
        );
      },
    },
    {
      key: 'collector',
      header: t('finance.collectedBy'),
      cell: (payment) => populatedName(payment.collectedBy),
    },
    {
      key: 'method',
      header: t('finance.method'),
      cell: (payment) => t(`paymentMethod.${payment.method}`),
    },
    {
      key: 'amount',
      header: t('fields.amount'),
      numeric: true,
      cell: (payment) => <strong>{formatMinor(payment.amountMinor)}</strong>,
    },
    {
      key: 'time',
      header: t('finance.collectedAt'),
      cell: (payment) => formatFinanceDateTime(payment.collectionTime ?? payment.collectedAt),
    },
    {
      key: 'actions',
      header: t('finance.controls'),
      cell: (payment) => {
        const working = workingId === payment._id;
        return (
          <div className="flex flex-wrap gap-2">
            {(payment.attachment || payment.attachmentId) && (
              <Button size="sm" disabled={working} onClick={() => void openProof(payment)}>
                {t('finance.paymentProof')}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              busy={working}
              onClick={() => {
                void (async () => {
                  const agreed = await ask.confirm({
                    title: t('finance.postTitle'),
                    description: t('finance.postBody'),
                    confirmLabel: t('finance.postConfirm'),
                  });
                  if (agreed) await act(payment, 'post');
                })();
              }}
            >
              {t('finance.postPayment')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              busy={working}
              onClick={() => {
                void (async () => {
                  const reason = await ask.prompt({
                    title: t('finance.rejectTitle'),
                    description: t('finance.rejectBody'),
                    label: t('actions.reason'),
                    multiline: true,
                    confirmLabel: t('finance.rejectConfirm'),
                    danger: true,
                    validate: requireReason(t),
                  });
                  if (reason?.trim()) await act(payment, 'fail', reason.trim());
                })();
              }}
            >
              {t('finance.rejectCollection')}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <main>
      <PageHeader
        routeId="collections"
        title={t('finance.collectionsTitle')}
        description={t('finance.collectionsSubtitle')}
        actions={<LinkButton to="/payments">{t('finance.allPayments')}</LinkButton>}
      />
      <Resource
        query={collections}
        loadingLabel={t('finance.loadingCollections')}
        errorMessageFallback={t('finance.couldNotLoadCollections')}
        empty={
          <EmptyState
            title={t('finance.noCollections')}
            description={t('finance.noCollectionsBody')}
          />
        }
      >
        {(page) => (
          <DataTable
            caption={t('finance.collectionsTitle')}
            columns={columns}
            rows={page.items}
            rowKey={(payment) => payment._id}
            rowTest={(payment) => payment.reference}
          />
        )}
      </Resource>
    </main>
  );
}
