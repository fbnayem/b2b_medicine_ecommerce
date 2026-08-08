import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  FilterTabs,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  ProductImage,
  Resource,
} from '../components/ui';
import { CategoryTree, type CategoryNode } from '../components/CategoryTree';
import { useApiCollection, usePagedCollection } from '../lib/query';
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
 * The two orderings the list offers. Anything else in the address — a mistyped
 * or stale link — reads as the default rather than being echoed to the API.
 */
type CatalogueSort = 'name' | 'popular';

/**
 * The catalogue, browsed as cards rather than rows because what a shop owner is
 * doing here is choosing, not reconciling.
 *
 * The filter state lives in the address on purpose. The detail page's category
 * breadcrumbs link to `/medicines?branch=…`, so this page has to read its own
 * URL or every breadcrumb lands on the unfiltered first page — which is exactly
 * what happened until it did. `branch` and `sort` are therefore `?` parameters
 * that survive a copy-paste; the search term stays local state, as it always
 * was, because nothing links into a search.
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
  const [searchParams, setSearchParams] = useSearchParams();

  const branch = searchParams.get('branch') ?? '';
  const sort: CatalogueSort = searchParams.get('sort') === 'popular' ? 'popular' : 'name';

  /*
   * Built as URLSearchParams so an empty filter is absent rather than
   * `&branch=`, and so a category named "Baby & Mom Care" survives the trip.
   */
  const filters = new URLSearchParams({ limit: '24' });
  if (query) filters.set('search', query);
  if (branch) filters.set('branch', branch);
  if (sort === 'popular') filters.set('sort', 'popular');

  /*
   * Paged, at last. This used to be one `limit=100` request with no page
   * control at all, which put 100 of the 55,998 products within reach —
   * alphabetically, forever — for anybody who did not type a search term.
   * Twenty-four to a page because the cards lay out one, two, three, four or
   * six across depending on the viewport, and 24 fills every one of those
   * widths without a ragged last row.
   */
  const medicines = usePagedCollection<Medicine>(
    keys.medicines.list({ search: query, branch, sort }),
    `/inventory/medicines?${filters.toString()}`,
  );

  const categories = useApiCollection<CategoryNode>(
    keys.medicines.categories(),
    '/inventory/categories',
  );

  const canManage =
    user &&
    ([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER] as UserRole[]).includes(user.role);

  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery(search.trim());
  }

  function setSort(next: CatalogueSort) {
    const params = new URLSearchParams(searchParams);
    // The default lives in no address, so a link somebody shares stays
    // canonical: `/medicines` and `/medicines?sort=name` must not be two URLs
    // for one page.
    if (next === 'popular') params.set('sort', next);
    else params.delete('sort');
    setSearchParams(params);
  }

  /** The current address without its branch — where "Show everything" goes. */
  const everything = (() => {
    const params = new URLSearchParams(searchParams);
    params.delete('branch');
    const rest = params.toString();
    return { search: rest ? `?${rest}` : '' };
  })();

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
        <Field
          label={t('catalogue.searchLabel')}
          className="min-w-64 flex-1"
          hint={t('hints.searchMedicines')}
        >
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

      {/*
        `minmax(0,1fr)` rather than `1fr` for the list column: the card grid
        inside is `auto-fill` over a hard 16rem minimum, and a plain `1fr`
        track refuses to shrink below its content, which pushes the whole
        layout sideways on screens just past the breakpoint.
      */}
      <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <CategoryTree query={categories} className="mb-4 lg:mb-0" />

        <div>
          {/*
            Says why the list is short. A person who arrived from a detail
            page's breadcrumb sees 1,595 products where 55,998 were promised,
            and without this line the difference reads as missing stock rather
            than as a filter they chose one click ago.
          */}
          {branch && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-surface-sunken px-4 py-3">
              <p className="m-0 text-text">{t('catalogue.branchShowing', { branch })}</p>
              <LinkButton size="sm" to={everything}>
                {t('catalogue.showEverything')}
              </LinkButton>
            </div>
          )}

          <div className="mb-4">
            <FilterTabs<CatalogueSort>
              label={t('catalogue.sortLabel')}
              options={[
                { value: 'name', label: t('catalogue.sortName') },
                { value: 'popular', label: t('catalogue.sortPopular') },
              ]}
              value={sort}
              onChange={setSort}
            />
          </div>

          <Resource
            query={medicines}
            loadingLabel={t('catalogue.loading')}
            errorMessageFallback={t('catalogue.couldNotLoad')}
            empty={<EmptyState title={t('catalogue.none')} description={t('catalogue.noneBody')} />}
          >
            {(page) => (
              <>
                {/*
                  These products are here for a different reason than usual, so
                  the list says so. No brand, ingredient or manufacturer is
                  called "typhoid" — what matched is the product information,
                  and a reader who is not told that reads the results as name
                  matches and concludes the search is broken.
                */}
                {page.matchedIn === 'productInformation' && (
                  <p
                    className="mb-4 rounded-panel border border-border bg-surface-sunken px-4 py-3 text-text"
                    data-test="matched-in-content"
                  >
                    {t('catalogue.matchedInContent', { term: query })}
                  </p>
                )}
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
                            {/*
                              Shown only when it is delisted, which is the whole point
                              of a badge. "Available to order" sat on every card in the
                              catalogue, so it distinguished nothing and was read as
                              decoration — and it sat two centimetres from "In stock",
                              which is a different fact people then had to work out the
                              difference between. The exception is the news; the rule
                              is not.
                            */}
                            {!medicine.isActive && (
                              <Badge tone="neutral">{t('catalogue.listedInactive')}</Badge>
                            )}
                          </div>
                          <ProductImage path={medicine.productImageUrl} />
                          <h2 className="text-lg font-semibold text-text">
                            {/*
                              `underline-offset-2` because at this weight and size the
                              default offset cuts through the descenders of a name like
                              "Amoxin 500mg".
                            */}
                            <Link
                              className="text-brand underline underline-offset-2"
                              to={`/medicines/${medicine._id}`}
                            >
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
                <Pagination
                  page={page.page}
                  limit={page.limit}
                  total={page.total}
                  onPage={medicines.setPage}
                />
              </>
            )}
          </Resource>
        </div>
      </div>
    </>
  );
}
