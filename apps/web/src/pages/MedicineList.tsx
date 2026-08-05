import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { UserRole } from '@medsupply/shared-types';
import type { Medicine } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import { useCart } from '../store/useCart';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  ProductImage,
  Resource,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { formatMinor } from '../lib/finance';

/**
 * The line under the name, built from whichever parts exist.
 *
 * It used to be `{genericName} · {dosageForm}` written out literally, which was
 * right while the catalogue held nothing but drugs. A shampoo has neither, and
 * that expression renders as a lone separator floating under the name — so the
 * separator is now a consequence of there being two things to separate.
 */
const describe = (parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');

/**
 * The catalogue, browsed as cards rather than rows because what a shop owner is
 * doing here is choosing, not reconciling.
 *
 * One structural fix beyond the migration: the whole card used to be a `<Link>`
 * with an "Add to cart" `<button>` nested inside it. A button inside a link is
 * invalid, and a keyboard or screen-reader user met one control claiming to be
 * two things — the code even called `preventDefault()` to stop the navigation
 * it had created. The card is now a card, the name is the link, and adding is
 * its own button.
 */
export function MedicineList() {
  const { t } = useLanguage();
  const user = useAuthStore((state) => state.user);
  const addToCart = useCart((state) => state.add);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const medicines = useApiCollection<Medicine>(
    keys.medicines.list(query),
    `/inventory/medicines?limit=100&search=${encodeURIComponent(query)}`,
  );

  const canManage =
    user &&
    ([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER] as UserRole[]).includes(user.role);

  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery(search.trim());
  }

  return (
    <>
      <PageHeader
        routeId="medicines"
        title={t('catalogue.title')}
        description={t('catalogue.subtitle')}
        actions={
          <>
            {canManage && (
              <LinkButton variant="primary" to="/medicines/new">
                {t('catalogue.addMedicine')}
              </LinkButton>
            )}
            {user?.role !== UserRole.SHOP_OWNER && (
              <LinkButton to="/inventory">{t('catalogue.stock')}</LinkButton>
            )}
          </>
        }
      />

      <form className="mb-6 flex flex-wrap items-end gap-2" onSubmit={submit} role="search">
        <Field label={t('catalogue.searchLabel')} className="min-w-64 flex-1">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('catalogue.searchPlaceholder')}
          />
        </Field>
        <Button type="submit" variant="primary">
          {t('common.search')}
        </Button>
      </form>

      <Resource
        query={medicines}
        loadingLabel={t('catalogue.loading')}
        errorMessageFallback={t('catalogue.couldNotLoad')}
        empty={<EmptyState title={t('catalogue.none')} description={t('catalogue.noneBody')} />}
      >
        {(page) => (
          <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4 p-0">
            {page.items.map((medicine) => {
              const inStock = (medicine.totalAvailable ?? 0) > 0;
              return (
                <li key={medicine._id}>
                  <Card
                    data-test={`row-${medicine.reference}`}
                    className="flex h-full flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm text-text-muted">{medicine.reference}</span>
                      <Badge tone={medicine.isActive ? 'success' : 'neutral'}>
                        {medicine.isActive
                          ? t('catalogue.listedActive')
                          : t('catalogue.listedInactive')}
                      </Badge>
                    </div>
                    <ProductImage path={medicine.productImageUrl} />
                    <h2 className="text-lg font-semibold text-text">
                      <Link className="text-brand underline" to={`/medicines/${medicine._id}`}>
                        {[medicine.brandName, medicine.strength].filter(Boolean).join(' ')}
                      </Link>
                    </h2>
                    <p className="text-text-muted">
                      {describe([medicine.genericName, medicine.dosageForm])}
                    </p>
                    <p className="text-sm text-text-muted">
                      {describe([medicine.manufacturer, medicine.packSize])}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                      {/*
                        Labelled, because an unlabelled amount beside a product
                        reads as "the price" — and this is the standard trade
                        price, which a customer with a discount or a price list
                        will not be charged.
                      */}
                      <span className="flex flex-col">
                        <span className="text-xs uppercase tracking-wide text-text-muted">
                          {t('catalogue.listPrice')}
                        </span>
                        <strong className="tabular-nums text-text">
                          {formatMinor(medicine.defaultSellingPriceMinor)}
                        </strong>
                      </span>
                      <Badge tone={inStock ? 'success' : 'warning'}>
                        {inStock ? t('catalogue.available') : t('catalogue.outOfStock')}
                      </Badge>
                    </div>
                    {user?.role === UserRole.SHOP_OWNER && (
                      <Button
                        variant="primary"
                        disabled={!inStock}
                        label={`${t('catalogue.addToOrder')} — ${medicine.brandName}`}
                        onClick={() => addToCart(medicine)}
                      >
                        {t('catalogue.addToOrder')}
                      </Button>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Resource>
    </>
  );
}
