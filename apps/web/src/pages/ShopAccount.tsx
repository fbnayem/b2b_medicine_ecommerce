import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { FinanceSummaryCards } from '../components/FinanceSummaryCards';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  Resource,
  StatusPill,
  toast,
  type Column,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatFinanceDateTime, formatMinor } from '../lib/finance';
import {
  invoiceDue,
  type AccountSummary,
  type FinanceInvoiceSummary,
  type FinancePayment,
} from './financeTypes';

export function ShopAccount() {
  const { t } = useLanguage();

  const summary = useApiResource<AccountSummary>(['my-finance-summary'], '/finance/my/summary');
  const invoices = useApiCollection<FinanceInvoiceSummary>(['my-invoices'], '/finance/my/invoices');
  const payments = useApiCollection<FinancePayment>(
    ['my-payments', 1],
    '/payments?page=1&limit=10',
  );

  async function openInvoice(invoiceId: string) {
    try {
      const response = await apiClient.get(`/fulfilment/invoices/${invoiceId}/pdf`, {
        params: { layout: 'a4' },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast.error(t('account.pdfFailed'));
    }
  }

  const invoiceColumns: ReadonlyArray<Column<FinanceInvoiceSummary>> = [
    { key: 'reference', header: t('account.document'), cell: (invoice) => invoice.reference },
    {
      key: 'issued',
      header: t('account.invoiceDate'),
      cell: (invoice) => formatFinanceDate(invoice.invoiceDate),
    },
    {
      key: 'due',
      header: t('fields.dueDate'),
      cell: (invoice) => formatFinanceDate(invoice.dueDate),
    },
    {
      key: 'total',
      header: t('fields.total'),
      numeric: true,
      cell: (invoice) => formatMinor(invoice.grandTotalMinor),
    },
    {
      key: 'remaining',
      header: t('account.remaining'),
      numeric: true,
      cell: (invoice) => <strong>{formatMinor(invoiceDue(invoice))}</strong>,
    },
    {
      key: 'pdf',
      header: '',
      label: '',
      cell: (invoice) => (
        <Button
          size="sm"
          label={`${t('account.openPdf')} ${invoice.reference}`}
          onClick={() => void openInvoice(invoice._id)}
        >
          {t('account.openPdf')}
        </Button>
      ),
    },
  ];

  return (
    <main>
      <PageHeader
        routeId="shop-account"
        title={t('account.title')}
        description={t('account.subtitle')}
        actions={
          <>
            <LinkButton to="/account/payments">{t('account.paymentHistory')}</LinkButton>
            <LinkButton variant="primary" to="/account/statement">
              {t('account.statement')}
            </LinkButton>
          </>
        }
      />

      <Resource
        query={summary}
        loadingLabel={t('account.loading')}
        errorMessageFallback={t('account.couldNotLoad')}
      >
        {(data) => <FinanceSummaryCards summary={data} />}
      </Resource>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-text">{t('account.invoices')}</h2>
          <Resource
            query={invoices}
            loadingLabel={t('account.invoices')}
            errorMessageFallback={t('account.couldNotLoad')}
            empty={<EmptyState title={t('account.noInvoices')} />}
          >
            {(page) => (
              <DataTable
                caption={t('account.invoices')}
                columns={invoiceColumns}
                rows={page.items}
                rowKey={(invoice) => invoice._id}
                rowTest={(invoice) => invoice.reference}
              />
            )}
          </Resource>
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-text">{t('account.recentPayments')}</h2>
            <Link className="text-brand underline" to="/account/payments">
              {t('account.viewAll')}
            </Link>
          </div>
          <Resource
            query={payments}
            loadingLabel={t('account.recentPayments')}
            errorMessageFallback={t('account.couldNotLoad')}
            empty={<EmptyState title={t('account.noPayments')} />}
          >
            {(page) => (
              <ul className="m-0 list-none p-0">
                {page.items.map((payment) => (
                  <li
                    key={payment._id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0"
                  >
                    <div>
                      <Link
                        className="font-medium text-brand underline"
                        to={`/account/payments/${payment._id}`}
                      >
                        {payment.reference}
                      </Link>
                      <p className="text-sm text-text-muted">
                        {t(`paymentMethod.${payment.method}`)} ·{' '}
                        {formatFinanceDateTime(
                          payment.collectionTime ?? payment.collectedAt ?? payment.createdAt,
                        )}
                      </p>
                    </div>
                    <div className="text-end">
                      <strong className="tabular-nums text-text">
                        {formatMinor(payment.amountMinor)}
                      </strong>
                      <p className="mt-1">
                        <StatusPill kind="payment" status={payment.status} />
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Resource>
        </Card>
      </div>
    </main>
  );
}
