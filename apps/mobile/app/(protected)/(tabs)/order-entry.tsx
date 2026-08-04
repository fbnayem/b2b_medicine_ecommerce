import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { PaymentMethod, type Medicine, type Shop } from '@medsupply/shared-types';
import { apiFailure, errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../../src/api/client';
import { useLanguage } from '../../../src/i18n/useLanguage';
import { formatMoneyMinor } from '../../../src/finance/money';
import { createFinancialIdempotencyKey } from '../../../src/finance/idempotency';
import {
  addLine,
  keyIsSpent,
  linesAreQuoted,
  quoteBody,
  removeLine,
  resolveCustomer,
  setQuantity,
  submitBody,
  unitsFrom,
  whyNotReady,
  type DraftLine,
} from '../../../src/orders/entry';
import { loadRememberedCustomer, rememberCustomer } from '../../../src/orders/stickyCustomer';
import {
  Button,
  Card,
  CardLink,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  Input,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  toast,
  useAsk,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

/**
 * Taking an order on the phone a rep actually carries.
 *
 * Deliberately not a transcription of `apps/web/src/pages/OrderEntry.tsx`. That
 * screen is built for a telesales operator at a keyboard with a customer on the
 * line, so it never asks the caret to leave the keyboard: arrow, Enter, type,
 * Enter. None of that exists here. A rep using this is standing in a shop,
 * one-handed, on a cellular connection, with the shopkeeper watching.
 *
 * So the shape is different in four ways, each of which is a decision rather
 * than a port:
 *
 *   - **The customer comes first and then sticks.** Until one is chosen the
 *     whole screen is the picker; afterwards it is one line at the top with a
 *     way back. The choice survives an app restart, because a rep places
 *     several orders in a visit and re-picking the shop each time is the mobile
 *     version of the queue-filter problem phase 23 fixed on the web.
 *   - **Search takes the screen over rather than living in it.** Typing two
 *     letters replaces the basket with results; clearing the box brings the
 *     basket back. A phone shows one thing at a time and pretending otherwise
 *     produces two half-height lists neither of which can be read.
 *   - **The total is the server's and it does not blink.** `POST /orders/quote`
 *     runs the same `buildOrderSnapshot` the submission runs, so the figure
 *     read aloud to the shopkeeper is the figure on the invoice — price list
 *     and free-goods offer included. The last good one stays on screen while
 *     the next is fetched, and is marked stale rather than replaced by zero.
 *   - **Offline is refused out loud.** `delivery/offlineQueue.ts` exists and an
 *     order is not a delivery: it needs a live price and a live credit check,
 *     both of which are the server's answers. Queuing one would mean promising
 *     a shopkeeper a number this app is not entitled to invent.
 *
 * The rules live in `src/orders/entry.ts` and are tested there, per `AGENTS.md`.
 */

/**
 * The delivery address the API wants is the subdocument's own `_id`, which the
 * shared `Address` type does not carry. Cast in one place, exactly as
 * `Checkout` and the web order-entry screen already do.
 */
interface DeliveryAddress {
  _id: string;
  label: string;
  line1: string;
  city: string;
  isDefault?: boolean;
}

interface QuoteLine {
  medicineId: string;
  medicineSnapshot: { brandName: string; strength: string; sku: string };
  requestedQuantity: number;
  freeQuantity: number;
  estimatedUnitPriceMinor: number;
  estimatedLineTotalMinor: number;
  availableStockSnapshot: number;
}

interface Quote {
  shopName: string;
  items: QuoteLine[];
  estimatedSubtotalMinor: number;
  estimatedDiscountMinor: number;
  estimatedDeliveryChargeMinor: number;
  estimatedTotalMinor: number;
}

function addressesOf(shop: Shop | undefined): DeliveryAddress[] {
  return (shop?.deliveryAddresses ?? []) as unknown as DeliveryAddress[];
}

export default function OrderEntryScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();

  /*
   * Failures are kept as they were caught, and worded at render time.
   *
   * Not a style preference. `useLanguage()` builds a fresh `t` on every render
   * when no provider is above it, so an effect that depends on `t` re-runs on
   * every render — which is an endless fetch loop, and is exactly what the
   * first run of the render test produced. Wording a message where it is
   * displayed keeps `t` out of every dependency list here, and has the second
   * benefit that a failure already on screen follows a language switch instead
   * of staying frozen in whichever language it happened in.
   */
  const [shops, setShops] = useState<Shop[]>([]);
  const [loadingShops, setLoadingShops] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shopsFailure, setShopsFailure] = useState<unknown>(null);

  const [shopId, setShopId] = useState('');
  const [addressId, setAddressId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CREDIT);
  const [customerTerm, setCustomerTerm] = useState('');

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Medicine[]>([]);
  const [searching, setSearching] = useState(false);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [quote, setQuote] = useState<Quote>();
  const [quoting, setQuoting] = useState(false);
  const [quoteFailure, setQuoteFailure] = useState<unknown>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitFailure, setSubmitFailure] = useState<unknown>(null);

  /*
   * One key, held across retries, replaced only when the last attempt is known
   * to have been refused. See `keyIsSpent` — this is the difference between a
   * retry on a bad connection and charging a shop twice for one order.
   */
  const idempotencyKey = useRef(createFinancialIdempotencyKey('order-submit', 'new'));

  const loadShops = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoadingShops(true);
    setShopsFailure(null);
    try {
      const response = await apiClient.get('/shops', { params: { limit: 100 } });
      const mine: Shop[] = response.data.data ?? [];
      setShops(mine);
      // Restored only while the rep may still order for them; the list is
      // territory-scoped to exactly what the submission will accept.
      const remembered = await loadRememberedCustomer();
      setShopId((current) => current || resolveCustomer(remembered, mine));
    } catch (caught) {
      setShopsFailure(caught);
    } finally {
      setLoadingShops(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadShops();
  }, [loadShops]);

  const shop = useMemo(() => shops.find((entry) => entry._id === shopId), [shops, shopId]);
  const addresses = useMemo(() => addressesOf(shop), [shop]);

  /*
   * The default address, chosen rather than asked for.
   *
   * Almost every shop has exactly one, and making a rep pick it is a tap that
   * carries no information. The chips below appear only when there is a real
   * choice to make.
   */
  useEffect(() => {
    setAddressId(addresses.find((address) => address.isDefault)?._id ?? addresses[0]?._id ?? '');
  }, [addresses]);

  // Debounced, so somebody typing a brand name makes one request rather than one
  // per letter over a cellular connection.
  useEffect(() => {
    const wanted = term.trim();
    if (wanted.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      apiClient
        .get('/inventory/medicines', { params: { search: wanted, limit: 20 } })
        .then((response) => {
          if (!cancelled) setResults(response.data.data ?? []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  useEffect(() => {
    if (!shopId || lines.length === 0) {
      setQuote(undefined);
      setQuoteFailure(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      apiClient
        .post('/orders/quote', quoteBody(shopId, lines))
        .then((response) => {
          if (cancelled) return;
          // Replaced only on success: the previous total stays readable while
          // this one is in flight rather than flashing to zero.
          setQuote(response.data.data as Quote);
          setQuoteFailure(null);
        })
        .catch((caught) => {
          if (!cancelled) setQuoteFailure(caught);
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `lines` is replaced only when the basket genuinely changes — every writer
    // goes through `entry.ts`, which returns a new array per edit and not per
    // render — so its identity is the right thing to re-quote on.
  }, [shopId, lines]);

  function chooseCustomer(next: string) {
    setShopId(next);
    setLines([]);
    setQuote(undefined);
    setTerm('');
    setSubmitFailure(null);
    // A different customer is a different order, so the previous key is done.
    idempotencyKey.current = createFinancialIdempotencyKey('order-submit', next);
    void rememberCustomer(next);
  }

  function add(medicine: Medicine) {
    const result = addLine(lines, medicine);
    if (result.duplicate) {
      toast.error(t('orderEntry.alreadyOnOrder', { brand: medicine.brandName }));
      return;
    }
    setLines(result.lines);
    setTerm('');
    toast.success(t('cart.addedToOrder', { brand: medicine.brandName }));
  }

  function changeQuantity(line: DraftLine, quantity: number) {
    const result = setQuantity(lines, line.medicineId, quantity);
    setLines(result.lines);
    if (result.adjustedTo !== null) {
      toast.success(
        t('orderEntry.adjustedTo', { brand: line.brandName, quantity: result.adjustedTo }),
      );
    }
  }

  async function askQuantity(line: DraftLine) {
    const answer = await ask.prompt({
      title: t('orderEntry.quantityForPending', { brand: line.brandName }),
      label: t('orderEntry.quantityFor', { brand: line.brandName }),
      hint: line.maximum
        ? t('cart.minimumAndMaximum', { minimum: line.minimum, maximum: line.maximum })
        : t('cart.minimum', { minimum: line.minimum }),
      confirmLabel: t('common.save'),
      numeric: true,
      initialValue: String(line.quantity),
    });
    if (answer === null) return;
    changeQuantity(line, unitsFrom(answer, line.quantity));
  }

  /*
   * "The request never reached the server", as distinct from "the server said
   * no". `apiFailure` already draws that line for both clients — a timeout and
   * a dropped connection are the two cases where the order's fate is unknown,
   * and they are the two that must stop it being sent again blind.
   */
  const unreachable = (caught: unknown) => {
    const code = apiFailure(caught).code;
    return code === 'NETWORK' || code === 'TIMEOUT';
  };
  const offline = Boolean(
    (quoteFailure && unreachable(quoteFailure)) || (submitFailure && unreachable(submitFailure)),
  );

  const priced = Boolean(quote) && linesAreQuoted(lines, quote?.items ?? []);
  const blocker = whyNotReady({ shopId, lines, addressId, offline, priced });

  function blockerMessage(): string | undefined {
    switch (blocker) {
      case 'NO_CUSTOMER':
        return t('orderEntry.blockedNoCustomer');
      case 'NO_LINES':
        return t('orderEntry.blockedNoLines');
      case 'NO_ADDRESS':
        // Two different problems wearing the same name: nothing picked, versus
        // nothing to pick. Only one of them is the rep's to solve.
        return addresses.length === 0
          ? t('orderEntry.noAddressOnFile')
          : t('orderEntry.blockedNoAddress');
      case 'OFFLINE':
        return t('orderEntry.blockedOffline');
      case 'NO_PRICE':
        return t('orderEntry.blockedNoPrice');
      default:
        return undefined;
    }
  }

  async function submit() {
    setSubmitFailure(null);
    setSubmitting(true);
    try {
      const response = await apiClient.post(
        '/orders/submit',
        submitBody({
          shopId,
          deliveryAddressId: addressId,
          requestedPaymentMethod: paymentMethod,
          idempotencyKey: idempotencyKey.current,
          lines,
        }),
      );
      const placed = response.data.data;
      toast.success(t('orderEntry.placed', { reference: placed.reference }));
      setLines([]);
      setQuote(undefined);
      idempotencyKey.current = createFinancialIdempotencyKey('order-submit', shopId);
      router.push({ pathname: '/(protected)/order-detail', params: { id: placed._id } });
    } catch (caught) {
      const failed = apiFailure(caught);
      setSubmitFailure(caught);
      // Refused means read and rejected, so the next attempt is a new order.
      // Anything else leaves the answer unknown and the key has to survive it.
      if (keyIsSpent(failed.status)) {
        idempotencyKey.current = createFinancialIdempotencyKey('order-submit', shopId);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Choosing the customer, which is the whole screen until one is chosen ────
  if (!shopId) {
    const wanted = customerTerm.trim().toLowerCase();
    const matches = wanted
      ? shops.filter((entry) =>
          [entry.name, entry.reference, entry.primaryPhone]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(wanted)),
        )
      : shops;

    return (
      <Screen scroll={false}>
        <SectionTitle>{t('orderEntry.pickCustomer')}</SectionTitle>
        <Field label={t('orderEntry.customer')} hint={t('orderEntry.pickCustomerBody')}>
          <Input
            label={t('orderEntry.customer')}
            placeholder={t('orderEntry.searchCustomerPlaceholder')}
            value={customerTerm}
            onChangeText={setCustomerTerm}
          />
        </Field>

        {loadingShops ? (
          <LoadingState />
        ) : shopsFailure ? (
          <ErrorState
            message={errorMessage(shopsFailure, language, t('orderEntry.couldNotLoadCustomers'))}
            reference={apiFailure(shopsFailure).reference}
            onRetry={() => void loadShops()}
          />
        ) : (
          <FlatList
            data={matches}
            keyExtractor={(entry) => entry._id}
            contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void loadShops(true)} />
            }
            ListEmptyComponent={
              <EmptyState
                title={t('orderEntry.noCustomers')}
                description={t('orderEntry.noCustomersBody')}
              />
            }
            renderItem={({ item }) => (
              <CardLink accessibilityLabel={item.name} onPress={() => chooseCustomer(item._id)}>
                <Text
                  style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}
                >
                  {item.name}
                </Text>
                <Text style={{ color: colour.brand, fontSize: layout.fontSize.sm }}>
                  {item.reference}
                </Text>
                <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                  {item.territory}
                </Text>
              </CardLink>
            )}
          />
        )}
      </Screen>
    );
  }

  // ── Building the order ─────────────────────────────────────────────────────
  const searchMode = term.trim().length >= 2;

  const header = (
    <View style={{ gap: layout.space[3] }}>
      <Card>
        <ListRow label={t('orderEntry.orderingFor')} value={shop?.name ?? ''} />
        <ListRow label={t('fields.reference')} value={shop?.reference ?? ''} />
        <Button
          variant="secondary"
          label={t('orderEntry.change')}
          onPress={() => chooseCustomer('')}
        />
      </Card>

      {addresses.length > 1 ? (
        <Field label={t('orderEntry.deliverTo')}>
          <FilterChips
            label={t('orderEntry.deliverTo')}
            value={addressId}
            onChange={setAddressId}
            options={addresses.map((address) => ({
              value: address._id,
              label: `${address.label} — ${address.city}`,
            }))}
          />
        </Field>
      ) : null}

      <Field label={t('orderEntry.payment')}>
        <FilterChips
          label={t('orderEntry.payment')}
          value={paymentMethod}
          onChange={(next) => setPaymentMethod(next as PaymentMethod)}
          options={Object.values(PaymentMethod).map((method) => ({
            value: method,
            label: t(`paymentMethod.${method}`),
          }))}
        />
      </Field>

      <Field label={t('orderEntry.addLine')} hint={t('orderEntry.tapToAdd')}>
        <Input
          label={t('orderEntry.addLine')}
          placeholder={t('orderEntry.searchPlaceholder')}
          value={term}
          onChangeText={setTerm}
          autoCorrect={false}
        />
      </Field>

      {searchMode ? null : <SectionTitle>{t('orderEntry.onThisOrder')}</SectionTitle>}
    </View>
  );

  const footer = searchMode ? null : (
    <View style={{ gap: layout.space[3], paddingTop: layout.space[3] }}>
      {quoteFailure ? (
        <ErrorState message={errorMessage(quoteFailure, language, t('orderEntry.couldNotPrice'))} />
      ) : null}
      {submitFailure ? (
        <ErrorState
          /*
           * "Not saved anywhere" is the sentence that matters here.
           *
           * A rep who has just watched a submission fail on a bad connection
           * will otherwise assume it went into some queue and tell the
           * shopkeeper the order is placed. Nothing on this client queues an
           * order, and the message has to say so rather than leave it to be
           * inferred from a spinner that stopped.
           */
          message={
            unreachable(submitFailure)
              ? `${errorMessage(submitFailure, language)} ${t('orderEntry.notSaved')}`
              : errorMessage(submitFailure, language, t('orderEntry.couldNotPlace'))
          }
          reference={apiFailure(submitFailure).reference}
        />
      ) : null}

      {lines.length > 0 ? (
        <Card>
          {quoting ? (
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {t('orderEntry.refreshing')}…
            </Text>
          ) : null}
          <ListRow
            label={t('orderEntry.subtotal')}
            value={formatMoneyMinor(quote?.estimatedSubtotalMinor ?? 0)}
            numeric
          />
          <ListRow
            label={t('orderEntry.discount')}
            value={formatMoneyMinor(quote?.estimatedDiscountMinor ?? 0)}
            numeric
          />
          <ListRow
            label={t('orderEntry.delivery')}
            value={formatMoneyMinor(quote?.estimatedDeliveryChargeMinor ?? 0)}
            numeric
          />
          <ListRow
            label={t('orderEntry.total')}
            value={formatMoneyMinor(quote?.estimatedTotalMinor ?? 0)}
            numeric
          />
        </Card>
      ) : null}

      {/*
       * The reason, not just a greyed-out button.
       *
       * The web can afford to disable one beside three visible fields; here the
       * missing thing is usually scrolled off the screen, and a control that
       * refuses silently is a phone call to the office.
       */}
      {blocker ? (
        <Text accessibilityRole="alert" style={{ color: colour.textMuted }}>
          {blockerMessage()}
        </Text>
      ) : null}

      <Button
        label={t('orderEntry.place')}
        busy={submitting}
        disabled={blocker !== null}
        onPress={() => void submit()}
      />
    </View>
  );

  return (
    <Screen scroll={false}>
      {searchMode ? (
        <FlatList
          data={results}
          keyExtractor={(item) => item._id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
          ListEmptyComponent={
            searching ? (
              <LoadingState />
            ) : (
              <EmptyState
                title={t('orderEntry.noMatches')}
                description={t('orderEntry.noMatchesBody')}
              />
            )
          }
          renderItem={({ item }) => (
            <CardLink
              accessibilityLabel={`${item.brandName} ${item.strength}`}
              onPress={() => add(item)}
            >
              <Text style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}>
                {item.brandName} {item.strength}
              </Text>
              <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                {item.genericName} · {item.packSize}
              </Text>
              <ListRow
                label={t('orderEntry.unitPrice')}
                value={formatMoneyMinor(item.defaultSellingPriceMinor)}
                numeric
              />
            </CardLink>
          )}
        />
      ) : (
        <FlatList
          data={lines}
          keyExtractor={(line) => line.medicineId}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
          ListEmptyComponent={
            <EmptyState
              title={t('orderEntry.nothingYet')}
              description={t('orderEntry.nothingYetOnPhone')}
            />
          }
          renderItem={({ item }) => {
            const quoted = quote?.items.find((entry) => entry.medicineId === item.medicineId);
            return (
              <Card>
                <Text
                  style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}
                >
                  {item.brandName} {item.strength}
                </Text>

                <Stepper
                  line={item}
                  decreaseLabel={t('orderEntry.decrease', { brand: item.brandName })}
                  increaseLabel={t('orderEntry.increase', { brand: item.brandName })}
                  quantityLabel={t('orderEntry.quantityFor', { brand: item.brandName })}
                  onChange={(quantity) => changeQuantity(item, quantity)}
                  onType={() => void askQuantity(item)}
                />

                {quoted && quoted.freeQuantity > 0 ? (
                  <Text style={{ color: colour.success, fontSize: layout.fontSize.sm }}>
                    {t('orderEntry.plusFree', { free: quoted.freeQuantity })}
                  </Text>
                ) : null}

                <ListRow
                  label={t('orderEntry.unitPrice')}
                  value={formatMoneyMinor(quoted?.estimatedUnitPriceMinor ?? 0)}
                  numeric
                />
                <ListRow
                  label={t('orderEntry.lineTotal')}
                  value={formatMoneyMinor(quoted?.estimatedLineTotalMinor ?? 0)}
                  numeric
                />

                <Button
                  variant="secondary"
                  label={t('actions.remove')}
                  onPress={() => {
                    setLines(removeLine(lines, item.medicineId));
                    toast.success(t('orderEntry.removed', { brand: item.brandName }));
                  }}
                />
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}

/**
 * Minus, the number, plus — and the number is a button.
 *
 * One or two more is the common case and deserves a tap rather than a keyboard;
 * twelve is not, and typing it into a number pad beats twelve taps. Tapping the
 * figure itself opens `Ask.prompt({ numeric: true })`, so both are reachable
 * without a second control competing for the width.
 */
function Stepper({
  line,
  decreaseLabel,
  increaseLabel,
  quantityLabel,
  onChange,
  onType,
}: {
  line: DraftLine;
  decreaseLabel: string;
  increaseLabel: string;
  quantityLabel: string;
  onChange: (quantity: number) => void;
  onType: () => void;
}) {
  const atFloor = line.quantity <= line.minimum;
  const atCeiling = line.maximum !== undefined && line.quantity >= line.maximum;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: layout.space[2] }}>
      <Button
        variant="secondary"
        style={{ flex: 1 }}
        label="−"
        accessibilityLabel={decreaseLabel}
        disabled={atFloor}
        onPress={() => onChange(line.quantity - 1)}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${quantityLabel}: ${line.quantity}`}
        onPress={onType}
        style={{
          minHeight: layout.minTapTarget,
          minWidth: layout.minTapTarget * 1.5,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: layout.radius.md,
          borderWidth: 1,
          borderColor: colour.border,
          backgroundColor: colour.surface,
        }}
      >
        <Text
          style={{
            fontSize: layout.fontSize.lg,
            fontWeight: '600',
            color: colour.text,
            fontVariant: ['tabular-nums'],
          }}
        >
          {line.quantity}
        </Text>
      </Pressable>
      <Button
        variant="secondary"
        style={{ flex: 1 }}
        label="+"
        accessibilityLabel={increaseLabel}
        disabled={atCeiling}
        onPress={() => onChange(line.quantity + 1)}
      />
    </View>
  );
}
