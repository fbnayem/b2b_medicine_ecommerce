import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PaymentMethod, PaymentStatus } from '@medsupply/shared-types';
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  FilterTabs,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Resource,
  Select,
  StatusPill,
  type Column,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDateTime, formatMinor } from '../lib/finance';
import type { FinancePayment } from './financeTypes';

interface PaymentListProps {
  ownerMode?: boolean;
}

export function PaymentList({ ownerMode = false }: PaymentListProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ q: '', method: '', from: '', to: '' });
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), limit: '30' });
  if (status) params.set('status', status);
  if (applied.method) params.set('method', applied.method);
  if (applied.q) params.set('q', applied.q);
  if (applied.from) params.set('from', applied.from);
  if (applied.to) params.set('to', applied.to);

  const payments = useApiCollection<FinancePayment>(
    keys.payments.list({ status, ...applied, page }),
    `/payments?${params.toString()}`,
  );

  const columns: ReadonlyArray<Column<FinancePayment>> = [
    {
      key: 'reference',
      header: t('finance.paymentReference'),
      cell: (payment) => (
        <Link
          className="font-medium text-brand underline"
          to={ownerMode ? `/account/payments/${payment._id}` : `/payments/${payment._id}`}
        >
          {payment.reference}
        </Link>
      ),
    },
    ...(ownerMode
      ? []
      : [
          {
            key: 'shop',
            header: t('fields.shop'),
            cell: (payment: FinancePayment) => {
              const shop = typeof payment.shopId === 'string' ? undefined : payment.shopId;
              return (
                <div>
                  <p className="text-text">{shop?.name ?? '—'}</p>
                  <p className="text-sm text-text-muted">{shop?.reference}</p>
                </div>
              );
            },
          },
        ]),
    {
      key: 'against',
      header: t('finance.invoice'),
      cell: (payment) => {
        const invoice = typeof payment.invoiceId === 'string' ? undefined : payment.invoiceId;
        const delivery = typeof payment.deliveryId === 'string' ? undefined : payment.deliveryId;
        return (
          <div>
            <p className="text-text">{invoice?.reference ?? t('finance.noInvoice')}</p>
            {delivery?.reference && <p className="text-sm text-text-muted">{delivery.reference}</p>}
          </div>
        );
      },
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
      key: 'status',
      header: t('fields.status'),
      cell: (payment) => <StatusPill kind="payment" status={payment.status} />,
    },
    {
      key: 'collected',
      header: t('finance.collectedAt'),
      cell: (payment) =>
        formatFinanceDateTime(payment.collectionTime ?? payment.collectedAt ?? payment.createdAt),
    },
  ];

  const filtered = Boolean(status || applied.method || applied.q || applied.from || applied.to);

  return (
    <>
      <PageHeader
        routeId={ownerMode ? 'my-payments' : 'payments'}
        title={ownerMode ? t('finance.ownPaymentsTitle') : t('finance.paymentsTitle')}
        description={ownerMode ? t('finance.ownPaymentsSubtitle') : t('finance.paymentsSubtitle')}
        actions={
          ownerMode ? (
            <LinkButton to="/account">{t('account.title')}</LinkButton>
          ) : (
            <>
              <LinkButton to="/payments/collections">{t('finance.collectionsTitle')}</LinkButton>
              <LinkButton variant="primary" to="/payments/new">
                {t('finance.recordPayment')}
              </LinkButton>
            </>
          )
        }
      />

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setApplied({ q: search.trim(), method, from, to });
        }}
      >
        <Field label={t('fields.reference')} className="min-w-56">
          <Input
            value={search}
            placeholder="PAY-2026-000001"
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field label={t('finance.method')} className="min-w-48">
          <Select value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="">{t('finance.anyMethod')}</option>
            {Object.values(PaymentMethod).map((value) => (
              <option key={value} value={value}>
                {t(`paymentMethod.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('finance.from')} className="min-w-40">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label={t('finance.to')} className="min-w-40">
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
        <Button type="submit">{t('actions.apply')}</Button>
      </form>

      <div className="mb-4">
        <FilterTabs
          label={t('fields.status')}
          options={[
            { value: '', label: t('finance.anyStatus') },
            ...Object.values(PaymentStatus).map((value) => ({
              value,
              label: t(`paymentStatus.${value}`),
            })),
          ]}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>

      <Resource
        query={payments}
        loadingLabel={t('finance.loadingPayments')}
        errorMessageFallback={t('finance.couldNotLoadPayments')}
        empty={
          <EmptyState
            title={filtered ? t('finance.noPaymentsFiltered') : t('finance.noPayments')}
            description={filtered ? t('lists.noResultsBody') : t('finance.noPaymentsBody')}
          />
        }
      >
        {(result) => (
          <>
            <DataTable
              caption={t('finance.paymentsTitle')}
              columns={columns}
              rows={result.items}
              rowKey={(payment) => payment._id}
              rowTest={(payment) => payment.reference}
            />
            <Pagination
              page={result.page}
              limit={result.limit}
              total={result.total}
              onPage={setPage}
            />
          </>
        )}
      </Resource>
    </>
  );
}
