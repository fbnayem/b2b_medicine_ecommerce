import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ShopStatus } from '@medsupply/shared-types';
import type { Shop } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import {
  Badge,
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
import { formatFinanceDate, formatMinor } from '../lib/finance';

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

interface DeliveryAddress {
  label: string;
  line1: string;
  city: string;
  district: string;
  isDefault?: boolean;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

export function ShopDetail() {
  const { id } = useParams();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const queryClient = useQueryClient();

  const query = useApiResource<Shop>(['shop', id], `/shops/${id}`);

  /**
   * Every status change is confirmed, and the two that stop a customer trading
   * ask for a reason.
   *
   * Suspension and a credit block used to fire on a single click with a
   * hard-coded reason — "Suspended by admin" — so the audit record said who
   * but never why, on exactly the two actions where why is the whole question.
   */
  async function changeStatus(status: ShopStatus) {
    const needsReason = status === ShopStatus.SUSPENDED || status === ShopStatus.CREDIT_BLOCKED;
    const key = {
      [ShopStatus.ACTIVE]: 'activate',
      [ShopStatus.SUSPENDED]: 'suspend',
      [ShopStatus.CREDIT_BLOCKED]: 'blockCredit',
      [ShopStatus.INACTIVE]: 'deactivate',
    }[status as string] as string;

    let reason: string | undefined;
    if (needsReason) {
      const answer = await ask.prompt({
        title: t(`shops.${key}Title`),
        description: t(`shops.${key}Body`),
        label: t('actions.reason'),
        multiline: true,
        confirmLabel: t(`shops.${key}`),
        danger: true,
        validate: requireReason(t),
      });
      if (!answer) return;
      reason = answer;
    } else {
      const agreed = await ask.confirm({
        title: t(`shops.${key}Title`),
        description: t(`shops.${key}Body`),
        confirmLabel: t(`shops.${key}`),
      });
      if (!agreed) return;
    }

    try {
      await apiClient.patch(`/shops/${id}/status`, { status, reason });
      await queryClient.invalidateQueries({ queryKey: ['shop', id] });
      toast.success(t('shops.statusChanged', { status: t(`shopStatus.${status}`) }));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('shops.statusFailed')));
    }
  }

  return (
    <>
      <Resource
        query={query}
        loadingLabel={t('shops.loadingOne')}
        errorMessageFallback={t('shops.couldNotLoadOne')}
      >
        {(shop) => {
          const addresses = (shop.deliveryAddresses ?? []) as unknown as DeliveryAddress[];
          const licenceSoon =
            shop.drugLicenceExpiryDate &&
            new Date(shop.drugLicenceExpiryDate).getTime() - Date.now() < NINETY_DAYS;

          return (
            <>
              <PageHeader
                routeId="shop-detail"
                title={shop.name}
                description={
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill kind="shop" status={shop.status} />
                    {shop.reference}
                  </span>
                }
                actions={
                  <>
                    <LinkButton to="/shops">{t('shops.back')}</LinkButton>
                    <LinkButton to={`/shops/${id}/ledger`}>{t('shops.ledger')}</LinkButton>
                    <LinkButton to={`/shops/${id}/statement`}>{t('shops.statement')}</LinkButton>
                    <LinkButton variant="primary" to={`/payments/new?shopId=${id}`}>
                      {t('finance.recordPayment')}
                    </LinkButton>
                  </>
                }
              />

              {licenceSoon && (
                <p className="mb-4 rounded-lg border border-warning bg-warning-subtle px-4 py-3 text-text">
                  {t('shops.licenceWarning', {
                    date: formatFinanceDate(shop.drugLicenceExpiryDate),
                  })}
                </p>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">{t('shops.contact')}</h2>
                  <dl className="m-0">
                    <Detail label={t('shops.primaryPhone')}>
                      <a className="text-brand underline" href={`tel:${shop.primaryPhone}`}>
                        {shop.primaryPhone}
                      </a>
                    </Detail>
                    <Detail label={t('fields.email')}>{shop.email || '—'}</Detail>
                    <Detail label={t('shops.territory')}>{shop.territory || '—'}</Detail>
                    <Detail label={t('shops.licence')}>
                      {shop.drugLicenceNumber || t('shops.noLicence')}
                    </Detail>
                  </dl>
                </Card>

                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">{t('shops.trading')}</h2>
                  <dl className="m-0">
                    <Detail label={t('shops.creditLimit')}>{formatMinor(shop.creditLimit)}</Detail>
                    <Detail label={t('shops.outstanding')}>
                      {formatMinor(shop.outstandingBalance)}
                    </Detail>
                    <Detail label={t('shops.paymentTerms')}>
                      {t('approvals.days', { days: shop.paymentTermsDays })}
                    </Detail>
                  </dl>
                </Card>

                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">{t('shops.addresses')}</h2>
                  {addresses.length === 0 ? (
                    <p className="text-text-muted">{t('shops.noAddresses')}</p>
                  ) : (
                    <ul className="m-0 list-none p-0">
                      {addresses.map((address, index) => (
                        <li
                          key={`${address.label}-${index}`}
                          className="border-b border-border py-2 last:border-b-0"
                        >
                          <p className="text-text">
                            <strong>{address.label}</strong>: {address.line1}, {address.city},{' '}
                            {address.district}
                            {address.isDefault && (
                              <Badge className="ms-2" tone="brand">
                                {t('shops.defaultAddress')}
                              </Badge>
                            )}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card>
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {t('shops.statusControls')}
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" onClick={() => void changeStatus(ShopStatus.ACTIVE)}>
                      {t('shops.activate')}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => void changeStatus(ShopStatus.SUSPENDED)}
                    >
                      {t('shops.suspend')}
                    </Button>
                    <Button onClick={() => void changeStatus(ShopStatus.CREDIT_BLOCKED)}>
                      {t('shops.blockCredit')}
                    </Button>
                    <Button onClick={() => void changeStatus(ShopStatus.INACTIVE)}>
                      {t('shops.deactivate')}
                    </Button>
                  </div>
                  {shop.notes && (
                    <>
                      <h3 className="mt-4 text-sm font-semibold text-text">
                        {t('shops.internalNotes')}
                      </h3>
                      <p className="text-text-muted">{shop.notes}</p>
                    </>
                  )}
                </Card>
              </div>
            </>
          );
        }}
      </Resource>
    </>
  );
}
