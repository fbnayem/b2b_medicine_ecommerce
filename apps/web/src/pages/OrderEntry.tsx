import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PaymentMethod, type Medicine, type Shop } from '@medsupply/shared-types';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  toast,
  type Column,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { formatMinor } from '../lib/finance';
import { useAuthStore } from '../store/useAuth';

/**
 * Taking an order the way this trade actually takes orders.
 *
 * Most volume here arrives by phone, by WhatsApp, or through a rep with a paper
 * book. The `SALES` role and order-on-behalf exist on the server for exactly
 * that, and the only way to place an order on this client was the shop owner's
 * own browse-and-basket — a rep had no screen at all.
 *
 * The screen is built around what a telesales operator is actually doing: the
 * customer is on the phone reading out names, and every hand movement between
 * keyboard and mouse costs a pause in that conversation. So **the caret never
 * has to leave the keyboard**: type part of a name, arrow to the right one,
 * Enter to add it, type the quantity, Enter again, and the search box is
 * focused and empty for the next line.
 *
 * The prices are the server's, not this screen's. `POST /orders/quote` runs the
 * same `buildOrderSnapshot` the submission runs, so the running total shown
 * while the customer is still on the line is the figure they will be invoiced —
 * including whichever price list they are on and any free-goods offer. A screen
 * that worked the price out for itself would read the medicine's default and
 * quote one number while the invoice charged another.
 */

/**
 * The delivery address the API wants is the subdocument's own `_id`, which the
 * shared `Address` type does not carry. Cast in one place rather than at the
 * point of use, exactly as `Checkout` already does.
 */
interface DeliveryAddress {
  _id: string;
  label: string;
  line1: string;
  city: string;
  isDefault?: boolean;
}

function addressesOf(shop: Shop | undefined): DeliveryAddress[] {
  return (shop?.deliveryAddresses ?? []) as unknown as DeliveryAddress[];
}

interface Draft {
  medicineId: string;
  brandName: string;
  strength: string;
  quantity: number;
}

interface QuoteLine {
  medicineId: string;
  medicineSnapshot: { brandName: string; strength: string; sku: string };
  requestedQuantity: number;
  freeQuantity: number;
  schemeReference?: string;
  estimatedUnitPriceMinor: number;
  estimatedDiscountMinor: number;
  estimatedLineTotalMinor: number;
  availableStockSnapshot: number;
  priceSource: string;
  priceListReference?: string;
}

interface Quote {
  shopName: string;
  onBehalf: boolean;
  items: QuoteLine[];
  estimatedSubtotalMinor: number;
  estimatedDiscountMinor: number;
  estimatedDeliveryChargeMinor: number;
  estimatedTotalMinor: number;
}

/** Debounce, so a fast typist makes one request rather than one per keystroke. */
function useDebounced<T>(value: T, delay = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export function OrderEntry() {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const [shopId, setShopId] = useState('');
  const [addressId, setAddressId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CREDIT);
  const [term, setTerm] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [lines, setLines] = useState<Draft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  const searchBox = useRef<HTMLInputElement>(null);
  const quantityBox = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Medicine>();
  const [pendingQuantity, setPendingQuantity] = useState('');

  /*
   * One key, held across retries.
   *
   * Regenerating it per attempt is what turns a timed-out submission into two
   * orders: the customer is charged twice for goods they asked for once. It is
   * replaced only after the order is placed or refused outright.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const shops = useApiCollection<Shop>(keys.shops.picker('entry'), '/shops?limit=100');
  const debounced = useDebounced(term);

  const results = useQuery<Medicine[]>({
    queryKey: keys.medicines.search(debounced),
    enabled: debounced.trim().length >= 2,
    queryFn: async ({ signal }) => {
      const response = await apiClient.get(
        `/inventory/medicines?limit=8&search=${encodeURIComponent(debounced.trim())}`,
        { signal },
      );
      const payload = response.data as { data?: Medicine[] | { items?: Medicine[] } };
      const body = payload.data;
      if (Array.isArray(body)) return body;
      return body?.items ?? [];
    },
  });

  const candidates = useMemo(() => results.data ?? [], [results.data]);
  useEffect(() => setHighlighted(0), [debounced]);

  const shop = shops.data?.items.find((entry) => entry._id === shopId);

  /*
   * The quote is the screen's arithmetic, done by the server.
   *
   * Keyed on the lines so it re-runs as the basket changes, and skipped
   * entirely until there is a shop and something in it — quoting an empty
   * basket is an error the operator did not make.
   */
  const quote = useQuery<Quote>({
    queryKey: keys.orders.quote(
      shopId,
      lines.map((line) => `${line.medicineId}:${line.quantity}`),
    ),
    enabled: lines.length > 0 && Boolean(shopId || user?.role === 'SHOP_OWNER'),
    queryFn: async ({ signal }) => {
      const response = await apiClient.post(
        '/orders/quote',
        {
          shopId: shopId || undefined,
          items: lines.map((line) => ({
            medicineId: line.medicineId,
            requestedQuantity: line.quantity,
          })),
        },
        { signal },
      );
      return response.data.data as Quote;
    },
  });

  function choose(medicine: Medicine) {
    if (lines.some((line) => line.medicineId === medicine._id)) {
      // The server refuses a repeated medicine outright, so say so here rather
      // than letting the whole basket fail on submit.
      toast.error(t('orderEntry.alreadyOnOrder', { brand: medicine.brandName }));
      return;
    }
    setPending(medicine);
    setPendingQuantity(String(medicine.minimumOrderQuantity || 1));
    setTerm('');
    // The next thing they will type is the quantity.
    setTimeout(() => quantityBox.current?.select(), 0);
  }

  function commit() {
    if (!pending) return;
    const quantity = Number(pendingQuantity.replace(/[^0-9]/g, ''));
    if (!quantity) return;
    setLines((current) => [
      ...current,
      {
        medicineId: pending._id,
        brandName: pending.brandName,
        // A shelf line has no strength; the row renders brand and strength together.
        strength: pending.strength ?? '',
        quantity,
      },
    ]);
    setPending(undefined);
    setPendingQuantity('');
    // Straight back to the search box, empty, for the next line.
    setTimeout(() => searchBox.current?.focus(), 0);
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, candidates.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && candidates[highlighted]) {
      event.preventDefault();
      choose(candidates[highlighted]);
    }
  }

  async function submit() {
    setFailure(undefined);
    setSubmitting(true);
    try {
      const response = await apiClient.post('/orders/submit', {
        shopId: shopId || undefined,
        deliveryAddressId: addressId,
        requestedPaymentMethod: paymentMethod,
        idempotencyKey,
        items: lines.map((line) => ({
          medicineId: line.medicineId,
          requestedQuantity: line.quantity,
        })),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.orders.all }),
        queryClient.invalidateQueries({ queryKey: keys.approvals.all }),
      ]);
      toast.success(t('orderEntry.placed', { reference: response.data.data.reference }));
      navigate(`/orders/${response.data.data._id}`);
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('orderEntry.couldNotPlace')),
        reference: failureReference(caught),
      });
      // A refusal is final for this basket, so the key is spent. A timeout is
      // not, and keeping the key is what makes retrying it safe.
      const status = (caught as { response?: { status?: number } }).response?.status;
      if (status && status >= 400 && status < 500) setIdempotencyKey(crypto.randomUUID());
    } finally {
      setSubmitting(false);
    }
  }

  const columns: ReadonlyArray<Column<QuoteLine>> = [
    {
      key: 'medicine',
      header: t('fields.medicine'),
      cell: (line) => (
        <div>
          <p className="font-medium text-text">
            {line.medicineSnapshot.brandName} {line.medicineSnapshot.strength}
          </p>
          {line.freeQuantity > 0 && (
            <p className="text-sm text-success">
              {t('orderEntry.plusFree', { free: line.freeQuantity })}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: t('fields.quantity'),
      numeric: true,
      cell: (line) => (
        <input
          aria-label={t('orderEntry.quantityFor', { brand: line.medicineSnapshot.brandName })}
          inputMode="numeric"
          value={
            lines.find((entry) => entry.medicineId === line.medicineId)?.quantity ??
            line.requestedQuantity
          }
          onChange={(event) => {
            const quantity = Number(event.target.value.replace(/[^0-9]/g, ''));
            setLines((current) =>
              current.map((entry) =>
                entry.medicineId === line.medicineId
                  ? { ...entry, quantity: quantity || 1 }
                  : entry,
              ),
            );
          }}
          className="min-h-11 w-20 rounded-md border border-border bg-surface px-3 text-end tabular-nums text-text"
        />
      ),
    },
    {
      key: 'unit',
      header: t('orderEntry.unitPrice'),
      numeric: true,
      cell: (line) => formatMinor(line.estimatedUnitPriceMinor),
    },
    {
      key: 'available',
      header: t('orderEntry.available'),
      numeric: true,
      cell: (line) => (
        <span className={line.availableStockSnapshot === 0 ? 'text-danger' : undefined}>
          {line.availableStockSnapshot}
        </span>
      ),
    },
    {
      key: 'total',
      header: t('orderEntry.lineTotal'),
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
          onClick={() =>
            setLines((current) => current.filter((entry) => entry.medicineId !== line.medicineId))
          }
        >
          {t('actions.remove')}
        </Button>
      ),
    },
  ];

  const ready = lines.length > 0 && Boolean(addressId) && !quote.isError;

  return (
    <>
      <PageHeader
        routeId="order-entry"
        title={t('orderEntry.title')}
        description={t('orderEntry.subtitle')}
      />

      <div className="flex flex-col gap-4">
        {failure && <ErrorState message={failure.message} reference={failure.reference} />}

        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('orderEntry.customer')} required>
              <Select
                value={shopId}
                onChange={(event) => {
                  setShopId(event.target.value);
                  setAddressId('');
                }}
              >
                <option value="">{t('orderEntry.chooseCustomer')}</option>
                {(shops.data?.items ?? []).map((entry) => (
                  <option key={entry._id} value={entry._id}>
                    {entry.name} · {entry.reference}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('orderEntry.deliverTo')} required>
              <Select value={addressId} onChange={(event) => setAddressId(event.target.value)}>
                <option value="">{t('orderEntry.chooseAddress')}</option>
                {addressesOf(shop).map((address) => (
                  <option key={address._id} value={address._id}>
                    {address.label} — {address.line1}, {address.city}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('orderEntry.payment')}>
              <Select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
              >
                {Object.values(PaymentMethod).map((method) => (
                  <option key={method} value={method}>
                    {t(`paymentMethod.${method}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-3">
            <Field label={t('orderEntry.addLine')} hint={t('orderEntry.addLineHint')}>
              <Input
                ref={searchBox}
                autoFocus
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={onSearchKey}
                placeholder={t('orderEntry.searchPlaceholder')}
                role="combobox"
                aria-expanded={candidates.length > 0}
                aria-controls="order-entry-results"
                aria-autocomplete="list"
              />
            </Field>

            {candidates.length > 0 && (
              <ul
                id="order-entry-results"
                className="flex flex-col rounded-md border border-border"
                role="listbox"
              >
                {candidates.map((medicine, index) => (
                  <li key={medicine._id} role="option" aria-selected={index === highlighted}>
                    <button
                      type="button"
                      onClick={() => choose(medicine)}
                      onMouseEnter={() => setHighlighted(index)}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 px-3 text-start ${
                        index === highlighted ? 'bg-surface-raised' : ''
                      }`}
                    >
                      <span className="text-text">
                        {medicine.brandName} {medicine.strength}
                        <span className="text-text-muted"> · {medicine.genericName}</span>
                      </span>
                      <span className="text-sm tabular-nums text-text-muted">{medicine.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {pending && (
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t('orderEntry.quantityForPending', { brand: pending.brandName })}>
                  <Input
                    ref={quantityBox}
                    inputMode="numeric"
                    value={pendingQuantity}
                    onChange={(event) => setPendingQuantity(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commit();
                      } else if (event.key === 'Escape') {
                        setPending(undefined);
                        searchBox.current?.focus();
                      }
                    }}
                  />
                </Field>
                <Button variant="primary" onClick={commit}>
                  {t('orderEntry.addToOrder')}
                </Button>
              </div>
            )}
          </div>
        </Card>

        {lines.length === 0 ? (
          <EmptyState
            title={t('orderEntry.nothingYet')}
            description={t('orderEntry.nothingYetBody')}
          />
        ) : (
          <>
            <DataTable
              caption={t('orderEntry.title')}
              columns={columns}
              rows={
                quote.data?.items ??
                lines.map((line) => ({
                  medicineId: line.medicineId,
                  medicineSnapshot: { brandName: line.brandName, strength: line.strength, sku: '' },
                  requestedQuantity: line.quantity,
                  freeQuantity: 0,
                  estimatedUnitPriceMinor: 0,
                  estimatedDiscountMinor: 0,
                  estimatedLineTotalMinor: 0,
                  availableStockSnapshot: 0,
                  priceSource: '',
                }))
              }
              rowKey={(line) => line.medicineId}
            />

            {quote.isError && (
              <ErrorState
                message={errorMessage(quote.error, language, t('orderEntry.couldNotPrice'))}
                onRetry={() => void quote.refetch()}
              />
            )}

            <Card className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">{t('orderEntry.subtotal')}</span>
                <span className="tabular-nums text-text">
                  {formatMinor(quote.data?.estimatedSubtotalMinor ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">{t('orderEntry.discount')}</span>
                <span className="tabular-nums text-text">
                  {formatMinor(quote.data?.estimatedDiscountMinor ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">{t('orderEntry.delivery')}</span>
                <span className="tabular-nums text-text">
                  {formatMinor(quote.data?.estimatedDeliveryChargeMinor ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="font-medium text-text">{t('orderEntry.total')}</span>
                <span className="text-lg font-semibold tabular-nums text-text">
                  {formatMinor(quote.data?.estimatedTotalMinor ?? 0)}
                </span>
              </div>
            </Card>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="primary"
                busy={submitting}
                disabled={!ready}
                onClick={() => void submit()}
              >
                {t('orderEntry.place')}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
