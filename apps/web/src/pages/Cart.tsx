import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, errorMessage, failureReference } from '../api/client';
import { useCart } from '../store/useCart';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  Resource,
  toast,
  type Column,
} from '../components/ui';
import { useLanguage } from '../lib/useLanguage';
import { keys } from '../lib/queryKeys';
import { formatMinor } from '../lib/finance';

interface QuoteLine {
  medicineId: string;
  medicineSnapshot: { brandName: string; strength: string };
  requestedQuantity: number;
  freeQuantity: number;
  estimatedUnitPriceMinor: number;
  estimatedLineTotalMinor: number;
}

interface Quote {
  items: QuoteLine[];
  estimatedSubtotalMinor: number;
  estimatedDiscountMinor: number;
  estimatedTotalMinor: number;
}

interface Line extends QuoteLine {
  minimum: number;
  maximum?: number;
}

/**
 * The basket, which is a table people edit rather than only read.
 *
 * **The prices come from the server, not from storage.** This used to persist
 * the whole `Medicine` object into `localStorage` and multiply the stored
 * `defaultSellingPriceMinor` by the quantity — with no expiry, so a basket left
 * open last week showed last week's prices indefinitely, across restarts. That
 * was not a caching inconvenience: `POST /orders/submit` reprices from
 * `resolvePriceFrom` on the way in, so the customer was shown one total and
 * charged another.
 *
 * `POST /orders/quote` has existed since the order-entry phase and answers
 * exactly the right question — what *this* shop would be charged, after their
 * own discount and their assigned price list. Quoting here also surfaces free
 * goods, which the basket never showed at all, so an offer a shop has already
 * earned is visible before they commit rather than as a surprise on the invoice.
 *
 * The stored snapshot stays, for the order limits and so the table has
 * something to draw before the quote lands. It is no longer allowed to be the
 * source of any figure with money in it.
 */
export function Cart() {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const { items, setQuantity, remove, draftId, setDraftId } = useCart();

  const quote = useQuery<Quote>({
    queryKey: keys.orders.quote(
      'mine',
      items.map((item) => `${item.medicine._id}:${item.quantity}`),
    ),
    enabled: items.length > 0,
    queryFn: async ({ signal }) => {
      const response = await apiClient.post(
        '/orders/quote',
        {
          items: items.map((item) => ({
            medicineId: item.medicine._id,
            requestedQuantity: item.quantity,
          })),
        },
        { signal },
      );
      return response.data.data as Quote;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        items: items.map((item) => ({
          medicineId: item.medicine._id,
          requestedQuantity: item.quantity,
          shopNotes: item.notes,
        })),
      };
      const response = draftId
        ? await apiClient.patch(`/orders/drafts/${draftId}`, body)
        : await apiClient.post('/orders/drafts', body);
      return response.data.data._id as string;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: keys.orders.all });
      setDraftId(id);
      toast.success(t('cart.draftSaved'));
    },
    onError: (caught) =>
      toast.error(errorMessage(caught, language, t('lists.couldNotLoad')), {
        reference: failureReference(caught),
      }),
  });

  /** The stored limits, which the quote does not carry and does not need to. */
  const limitsFor = (medicineId: string) => {
    const stored = items.find((item) => item.medicine._id === medicineId)?.medicine;
    return { minimum: stored?.minimumOrderQuantity ?? 1, maximum: stored?.maximumOrderQuantity };
  };

  const columns: ReadonlyArray<Column<Line>> = [
    {
      key: 'medicine',
      header: t('fields.medicine'),
      cell: (line) => (
        <div>
          <p className="font-medium text-text">
            {line.medicineSnapshot.brandName} {line.medicineSnapshot.strength}
          </p>
          <p className="text-sm text-text-muted">
            {line.maximum
              ? t('cart.minimumAndMaximum', { minimum: line.minimum, maximum: line.maximum })
              : t('cart.minimum', { minimum: line.minimum })}
          </p>
          {/*
            Free goods, said before they commit. The basket never showed these,
            so an offer a shop had already earned first appeared on the invoice.
          */}
          {line.freeQuantity > 0 && (
            <p className="text-sm font-medium text-success">
              {t('cart.freeGoods', { count: line.freeQuantity })}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'unit-price',
      header: t('cart.unitPrice'),
      numeric: true,
      cell: (line) => formatMinor(line.estimatedUnitPriceMinor),
    },
    {
      key: 'quantity',
      header: t('fields.quantity'),
      numeric: true,
      cell: (line) => (
        <input
          aria-label={t('cart.quantityFor', { brand: line.medicineSnapshot.brandName })}
          type="number"
          min={line.minimum}
          max={line.maximum}
          value={line.requestedQuantity}
          onChange={(event) => setQuantity(line.medicineId, Number(event.target.value))}
          className="min-h-11 w-24 rounded-md border border-border bg-surface px-3 text-end tabular-nums text-text"
        />
      ),
    },
    {
      key: 'line-total',
      header: t('cart.lineTotal'),
      numeric: true,
      cell: (line) => formatMinor(line.estimatedLineTotalMinor),
    },
    {
      key: 'remove',
      header: '',
      label: '',
      cell: (line) => (
        <Button
          variant="ghost"
          size="sm"
          label={`${t('actions.remove')} ${line.medicineSnapshot.brandName}`}
          onClick={() => remove(line.medicineId)}
        >
          {t('actions.remove')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        routeId="cart"
        title={t('cart.title')}
        description={t('cart.subtitle')}
        actions={<LinkButton to="/medicines">{t('cart.keepBrowsing')}</LinkButton>}
      />
      {items.length === 0 ? (
        <EmptyState
          title={t('cart.empty')}
          description={t('cart.emptyBody')}
          action={
            <LinkButton variant="primary" to="/medicines">
              {t('cart.browse')}
            </LinkButton>
          }
        />
      ) : (
        <Resource
          query={quote}
          loadingLabel={t('cart.pricing')}
          errorMessageFallback={t('cart.couldNotPrice')}
        >
          {(priced) => {
            const lines: Line[] = priced.items.map((line) => ({
              ...line,
              ...limitsFor(line.medicineId),
            }));
            return (
              <div className="flex flex-col gap-4">
                <DataTable
                  caption={t('cart.title')}
                  columns={columns}
                  rows={lines}
                  rowKey={(line) => line.medicineId}
                />
                <Card className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">{t('cart.subtotal')}</span>
                    <span className="tabular-nums text-text">
                      {formatMinor(priced.estimatedSubtotalMinor)}
                    </span>
                  </div>
                  {priced.estimatedDiscountMinor > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-text-muted">{t('cart.discount')}</span>
                      <span className="tabular-nums text-success">
                        −{formatMinor(priced.estimatedDiscountMinor)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="font-medium text-text">{t('cart.total')}</span>
                    <span className="text-lg font-semibold tabular-nums text-text">
                      {formatMinor(priced.estimatedTotalMinor)}
                    </span>
                  </div>
                </Card>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button busy={save.isPending} onClick={() => save.mutate()}>
                    {t('cart.saveDraft')}
                  </Button>
                  <LinkButton variant="primary" to="/checkout">
                    {t('cart.checkout')}
                  </LinkButton>
                </div>
              </div>
            );
          }}
        </Resource>
      )}
    </>
  );
}
