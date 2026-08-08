import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ShopStatus, UserRole } from '@medsupply/shared-types';
import type { Shop, User } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import {
  Badge,
  Button,
  Card,
  Field,
  LinkButton,
  PageHeader,
  Resource,
  Select,
  StatusPill,
  requireReason,
  toast,
  useAsk,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { useAuthStore } from '../store/useAuth';
import { formatFinanceDate, formatMinor } from '../lib/finance';

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

const ADMINISTRATORS: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

interface DeliveryAddress {
  /** Sent by the server on every address; the delete needs it, not the index. */
  _id?: string;
  label: string;
  line1: string;
  city: string;
  district: string;
  isDefault?: boolean;
}

/** `getShop` populates both, so the ids arrive as people rather than as ids. */
interface Person {
  _id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

const fullName = (person: Person) =>
  [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email || person._id;

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
  const role = useAuthStore((state) => state.user?.role);
  const isAdministrator = !!role && ADMINISTRATORS.includes(role);

  const query = useApiResource<Shop>(keys.shops.one(id!), `/shops/${id}`);

  /*
   * Only fetched for the people who may act on it. `GET /users` returns every
   * account and is refused to a rep, so asking for it unconditionally would put
   * a 403 in the console of every sales representative who opens a customer.
   */
  const staff = useApiCollection<User>(keys.users.list({}), '/users', {
    enabled: isAdministrator,
  });
  const [owner, setOwner] = useState('');
  const [manager, setManager] = useState('');

  const candidates = (wanted: UserRole) =>
    (staff.data?.items ?? []).filter((person) => person.role === wanted);

  /*
   * The two paths are written out rather than built from `kind`.
   *
   * `/shops/${id}/assign-${kind}` is one fewer line and unverifiable: the
   * specification check reads the source for the addresses this application
   * asks for, and an endpoint name assembled at run time is not an address it
   * can find. A path that no longer exists should fail a test, not a customer.
   */
  async function assign(kind: 'owner' | 'manager', userId: string) {
    if (!userId) return;
    try {
      if (kind === 'owner') await apiClient.post(`/shops/${id}/assign-owner`, { userId });
      else await apiClient.post(`/shops/${id}/assign-manager`, { userId });
      await queryClient.invalidateQueries({ queryKey: keys.shops.all });
      toast.success(t(`shops.${kind}Assigned`));
      if (kind === 'owner') setOwner('');
      else setManager('');
    } catch (caught) {
      toast.error(errorMessage(caught, language, t(`shops.${kind}AssignFailed`)));
    }
  }

  /*
   * The other half of a pair that was half-built: staff could add an address
   * and never remove one, so a mistyped delivery point stayed on the customer
   * for good and the list only ever grew.
   */
  async function removeAddress(address: DeliveryAddress) {
    if (!address._id) return;
    const agreed = await ask.confirm({
      title: t('shops.removeAddressTitle'),
      description: t('shops.removeAddressBody', { label: address.label }),
      confirmLabel: t('shops.removeAddress'),
      danger: true,
    });
    if (!agreed) return;
    try {
      await apiClient.delete(`/shops/${id}/addresses/${address._id}`);
      await queryClient.invalidateQueries({ queryKey: keys.shops.all });
      toast.success(t('shops.addressRemoved'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('shops.addressRemoveFailed')));
    }
  }

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
      await queryClient.invalidateQueries({ queryKey: keys.shops.all });
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
          const owners = (shop.ownerIds ?? []) as unknown as Person[];
          const shopManager = shop.managerId as unknown as Person | undefined;
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
                          key={address._id ?? `${address.label}-${index}`}
                          className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-b-0"
                        >
                          <p className="m-0 text-text">
                            <strong>{address.label}</strong>: {address.line1}, {address.city},{' '}
                            {address.district}
                            {address.isDefault && (
                              <Badge className="ms-2" tone="brand">
                                {t('shops.defaultAddress')}
                              </Badge>
                            )}
                          </p>
                          {address._id && (
                            <Button
                              size="sm"
                              variant="danger"
                              data-test={`remove-address-${address._id}`}
                              onClick={() => void removeAddress(address)}
                            >
                              {t('shops.removeAddress')}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                {/*
                  Who this customer belongs to.

                  `assign-owner` and `assign-manager` have existed since the
                  shops phase and were reachable from nothing, so the only way
                  to give a pharmacy an account that could sign in and order was
                  a database write. The current holders are shown above the
                  controls because assigning is an edit to a state somebody
                  needs to be able to see first — owners add, a manager
                  replaces, and that difference is stated rather than implied.
                */}
                {isAdministrator && (
                  <Card>
                    <h2 className="mb-2 text-lg font-semibold text-text">{t('shops.people')}</h2>
                    <dl className="m-0 mb-3">
                      <Detail label={t('shops.owners')}>
                        {owners.length ? owners.map(fullName).join(', ') : t('shops.noOwners')}
                      </Detail>
                      <Detail label={t('shops.manager')}>
                        {shopManager ? fullName(shopManager) : t('shops.noManager')}
                      </Detail>
                    </dl>

                    <div className="flex flex-wrap items-end gap-2">
                      <Field
                        label={t('shops.addOwner')}
                        className="min-w-56 flex-1"
                        hint={t('hints.addOwner')}
                      >
                        <Select
                          value={owner}
                          data-test="assign-owner"
                          onChange={(event) => setOwner(event.target.value)}
                        >
                          <option value="">{t('shops.choosePerson')}</option>
                          {candidates(UserRole.SHOP_OWNER).map((person) => (
                            <option key={person._id} value={person._id}>
                              {fullName(person as unknown as Person)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Button
                        variant="primary"
                        disabled={!owner}
                        onClick={() => void assign('owner', owner)}
                      >
                        {t('shops.assign')}
                      </Button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Field
                        label={t('shops.setManager')}
                        className="min-w-56 flex-1"
                        hint={t('hints.setManager')}
                      >
                        <Select
                          value={manager}
                          data-test="assign-manager"
                          onChange={(event) => setManager(event.target.value)}
                        >
                          <option value="">{t('shops.choosePerson')}</option>
                          {candidates(UserRole.MANAGER).map((person) => (
                            <option key={person._id} value={person._id}>
                              {fullName(person as unknown as Person)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Button
                        variant="primary"
                        disabled={!manager}
                        onClick={() => void assign('manager', manager)}
                      >
                        {t('shops.assign')}
                      </Button>
                    </div>
                  </Card>
                )}

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
