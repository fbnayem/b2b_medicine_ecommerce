import { useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  StockMovementType,
  type Medicine,
  type MedicineBatch,
  type PriceListRecord,
  type SchemeRecord,
} from '@medsupply/shared-types';
import { parseMoney, toMoneyInputValue } from '@medsupply/utilities';
import { apiClient, errorMessage } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import {
  canAdjustStock,
  canEditCatalogue,
  canOperateStock,
  canSeeCommercial,
  canSeeCost,
  canSeeStock,
} from '../lib/permissions';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  ProductImage,
  Resource,
  Stat,
  StatGrid,
  Textarea,
  requireReason,
  toast,
  useAsk,
  type Column,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import {
  createActionKey,
  formatFinanceDate,
  formatFinanceDateTime,
  formatMinor,
} from '../lib/finance';

/**
 * Everything about one catalogue line, and everything you can do to it.
 *
 * This page was read-only, and so was the rest of the product: **four of the
 * endpoints it now calls had never had a caller anywhere.** A stock code could
 * not be corrected, a price could not be changed, a miscount could not be put
 * right, a batch could not be taken out of circulation, and a medicine's own
 * stock history could not be read — every one of those was a database job.
 *
 * **Sections, not tabs.** Tabs would hide three-quarters of this page from the
 * accessibility scan, break Ctrl-F and printing, need a keyboard model that
 * exists nowhere else in forty-three pages, and force a rule for what happens
 * when a manager pastes `?tab=offers` to a storekeeper who has no such tab. A
 * one-tab tablist for a shop owner is furniture. Sections give deep links for
 * nothing: each card carries an `id` and an `<h2>`.
 *
 * What each viewer sees is decided by `lib/permissions`, which mirrors the
 * server's own role sets. A shop owner gets identity and availability; a
 * storekeeper gets stock but no money; a rep gets money but no stock; a manager
 * gets all of it. Every one of those is a set the API enforces independently.
 */

/**
 * Joins whichever parts of a description exist.
 *
 * The header used to interpolate `${genericName} · ${dosageForm} · ${packSize}`
 * directly, which was correct while every row was a drug. Those two fields are
 * now optional — a box of nappies has neither — and a template literal renders
 * a missing one as the word "undefined" on the page.
 */
const describe = (parts: (string | undefined)[], separator = ' · ') =>
  parts.filter(Boolean).join(separator);

/** A label and its value, so the detail lists on this page line up the same way. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

/** A card with a heading you can link to. */
function Section({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

interface Movement {
  _id: string;
  type: StockMovementType;
  quantity: number;
  reason: string;
  createdAt: string;
  batchId?: { batchNumber: string };
  actorId?: { firstName: string; lastName: string };
}

/** The changes a storekeeper may record by hand, in the order they occur. */
const MANUAL_MOVEMENTS: StockMovementType[] = [
  StockMovementType.DAMAGE,
  StockMovementType.EXPIRY,
  StockMovementType.QUARANTINE,
  StockMovementType.QUARANTINE_RELEASE,
];

const EMPTY_RECEIPT = {
  batchNumber: '',
  manufacturingDate: '',
  expiryDate: '',
  costPrice: '',
  sellingPrice: '',
  quantity: '',
  warehouseLocation: '',
  notes: '',
};

/**
 * Profit as a percentage of what the pack sells for.
 *
 * Measured against the **MRP**, because that is the ceiling a pharmacy may
 * charge and therefore the number the shop's own margin comes out of. Integer
 * arithmetic throughout: these are poisha, and a percentage of them is the one
 * place a float would be tempting and wrong.
 *
 * A markup over *cost* is a different figure and one keystroke away, so this is
 * never shown to anybody who cannot also see the cost it would be confused
 * with — the label says which it is.
 */
function marginPercent(tradeMinor: number, mrpMinor?: number): number | undefined {
  if (!mrpMinor || mrpMinor <= 0 || tradeMinor > mrpMinor) return undefined;
  return Math.round(((mrpMinor - tradeMinor) * 1000) / mrpMinor) / 10;
}

export function MedicineDetail() {
  const { id } = useParams();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);

  /*
   * The server's own sets, not "anybody who is not a shop owner". The old
   * predicate answered `true` for a sales rep, who has been allowed onto this
   * page and whom `GET /inventory/batches` refuses — so the fix to the
   * navigation manifest and the fix here were one change, not two.
   */
  const showStock = canSeeStock(role);
  const showCommercial = canSeeCommercial(role);
  const showCost = canSeeCost(role);
  const mayEdit = canEditCatalogue(role);
  const mayOperate = canOperateStock(role);
  const mayAdjust = canAdjustStock(role);

  const [receipt, setReceipt] = useState(EMPTY_RECEIPT);
  const [receiving, setReceiving] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

  const medicine = useApiResource<Medicine>(keys.medicines.one(id!), `/inventory/medicines/${id}`);
  const batches = useApiCollection<MedicineBatch>(
    keys.medicines.batches(id!),
    `/inventory/batches?medicineId=${id}`,
    { enabled: showStock },
  );
  const movements = useApiCollection<Movement>(
    keys.stock.movements({ medicineId: id }),
    `/inventory/movements?medicineId=${id}&limit=25`,
    { enabled: showStock },
  );
  /*
   * Which price lists carry this medicine.
   *
   * No endpoint needed: `listPriceLists` already returns every list's `lines`
   * inline, so the filtering is a client-side pass over data that has arrived
   * anyway. The bound is written down rather than left silent — a tenant with
   * more than fifty price lists would see only the first fifty here, and that
   * is a different problem from this one.
   */
  const priceLists = useApiCollection<PriceListRecord>(
    keys.priceLists.list({ forMedicine: true }),
    '/pricing/price-lists?limit=50',
    { enabled: showCommercial },
  );
  /*
   * The offers running on this line.
   *
   * A scheme has always been scoped to exactly one medicine — `medicineId` is
   * required and singular — and the only thing missing was a way to ask for
   * them by it. Without the filter this page would have to read every offer in
   * the tenant and sift them in the browser: slower as the business grows, and
   * simply wrong once the first page of offers fills up.
   */
  const schemes = useApiCollection<SchemeRecord>(
    keys.schemes.list({ medicineId: id }),
    `/pricing/schemes?medicineId=${id}&limit=25`,
    { enabled: showCommercial },
  );

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.medicines.all }),
      queryClient.invalidateQueries({ queryKey: keys.stock.all }),
    ]);
  }

  /**
   * One field, because that is the change people actually make.
   *
   * `UpdateMedicineSchema` accepts a patch of a single field, while the only UI
   * that could produce one demanded nineteen controls, three of them
   * conditionally required and one pair carrying a cross-field rule. A manager
   * reacting to a supplier's new trade price should not have to re-satisfy all
   * of it to change one number.
   */
  async function saveTradePrice(event: FormEvent, item: Medicine) {
    event.preventDefault();
    const parsed = parseMoney(price);
    if (!parsed.ok) {
      toast.error(t('medicineForm.badAmount'));
      return;
    }
    // Against the **stored** MRP, mirroring the merge the server performs
    // before it re-runs the same rule. Comparing against a field on screen
    // would be comparing against a number nobody has saved.
    if (item.mrpMinor && parsed.minor > item.mrpMinor) {
      toast.error(t('medicinePage.aboveMrp'));
      return;
    }
    setSavingPrice(true);
    try {
      await apiClient.patch(`/inventory/medicines/${id}`, {
        defaultSellingPriceMinor: parsed.minor,
      });
      await refresh();
      setPrice('');
      toast.success(t('medicinePage.priceChanged', { amount: formatMinor(parsed.minor) }));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('medicineForm.saveFailed')));
    } finally {
      setSavingPrice(false);
    }
  }

  /**
   * Delisting, which is what "delete" means here.
   *
   * There is no delete endpoint and there should not be: a medicine is named by
   * every order that ever contained it, and removing the row would leave those
   * orders pointing at nothing. `isActive: false` takes it off what can be
   * ordered and leaves the history readable, and the confirmation says so
   * rather than letting somebody assume otherwise.
   */
  async function setListed(item: Medicine, listed: boolean) {
    const agreed = await ask.confirm({
      title: listed ? t('medicinePage.listTitle') : t('medicinePage.delistTitle'),
      description: listed
        ? t('medicinePage.listBody', { brand: item.brandName })
        : t('medicinePage.delistBody', { brand: item.brandName }),
      confirmLabel: listed ? t('medicinePage.list') : t('medicinePage.delist'),
      danger: !listed,
    });
    if (!agreed) return;
    try {
      await apiClient.patch(`/inventory/medicines/${id}`, { isActive: listed });
      await refresh();
      toast.success(listed ? t('medicinePage.listed') : t('medicinePage.delisted'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('medicineForm.saveFailed')));
    }
  }

  async function receive(event: FormEvent) {
    event.preventDefault();
    const cost = parseMoney(receipt.costPrice);
    const selling = receipt.sellingPrice ? parseMoney(receipt.sellingPrice) : undefined;
    // Integer minor units from the shared parser, never `Number(input) * 100`.
    if (!cost.ok || (selling && !selling.ok)) {
      toast.error(t('inventory.badAmount'));
      return;
    }
    setReceiving(true);
    try {
      await apiClient.post('/inventory/batches/receive', {
        ...receipt,
        // Locked: this dialog opens from one medicine's own page, so choosing
        // one would only be an opportunity to choose the wrong one.
        medicineId: id,
        costPriceMinor: cost.minor,
        sellingPriceOverrideMinor: selling?.ok ? selling.minor : undefined,
        quantity: Number(receipt.quantity),
      });
      setReceipt(EMPTY_RECEIPT);
      setReceiptOpen(false);
      await refresh();
      toast.success(t('inventory.received'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('inventory.receiveFailed')));
    } finally {
      setReceiving(false);
    }
  }

  /**
   * Two questions, both required: how many, and why.
   *
   * The reason is not ceremony. A stock movement is an append-only record an
   * inspector may read years later, and "someone reduced this batch by six"
   * with no explanation is exactly the entry nobody can account for.
   */
  async function recordChange(batch: MedicineBatch, type: StockMovementType) {
    const action = t(`movementType.${type}`);
    const raw = await ask.prompt({
      title: t('inventory.recordTitle', { action }),
      description: t('inventory.recordBody', { batch: batch.batchNumber }),
      label: t('inventory.howMany'),
      type: 'number',
      confirmLabel: t('inventory.recordTitle', { action }),
      danger: true,
      validate: (value) =>
        Number.isInteger(Number(value)) && Number(value) > 0 ? null : t('inventory.badQuantity'),
    });
    if (!raw) return;

    const reason = await ask.prompt({
      title: t('inventory.whyTitle'),
      description: t('inventory.whyBody'),
      label: t('actions.reason'),
      multiline: true,
      confirmLabel: t('inventory.recordIt'),
      danger: true,
      validate: requireReason(t),
    });
    if (!reason) return;

    try {
      await apiClient.post(`/inventory/batches/${batch._id}/operations`, {
        type,
        quantity: Number(raw),
        reason,
        idempotencyKey: createActionKey('stock-operation'),
      });
      await refresh();
      toast.success(t('inventory.recorded', { action }));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('inventory.actionFailed')));
    }
  }

  /**
   * Correcting a count, which is a different act from recording a movement.
   *
   * A movement says what happened to the stock; this says the record was wrong.
   * It overwrites the counted quantity outright, which is why the server keeps
   * it to management and why the reason is mandatory — and why it carries an
   * idempotency key, so a double-tap on a warehouse handset cannot post the
   * correction twice.
   */
  async function correctCount(batch: MedicineBatch) {
    const counted = await ask.prompt({
      title: t('medicinePage.correctTitle'),
      description: t('medicinePage.correctBody', {
        batch: batch.batchNumber,
        recorded: String(batch.quantities.onHand),
      }),
      label: t('medicinePage.countedLabel'),
      type: 'number',
      initialValue: String(batch.quantities.onHand),
      confirmLabel: t('medicinePage.correctIt'),
      danger: true,
      validate: (value) =>
        Number.isInteger(Number(value)) && Number(value) >= 0 ? null : t('medicinePage.badCount'),
    });
    if (counted === null) return;

    const reason = await ask.prompt({
      title: t('inventory.whyTitle'),
      description: t('medicinePage.correctWhy'),
      label: t('actions.reason'),
      multiline: true,
      confirmLabel: t('medicinePage.correctIt'),
      danger: true,
      validate: requireReason(t),
    });
    if (!reason) return;

    try {
      await apiClient.post(`/inventory/batches/${batch._id}/adjust`, {
        newOnHand: Number(counted),
        reason,
        idempotencyKey: createActionKey('stock-adjust'),
      });
      await refresh();
      toast.success(t('medicinePage.corrected', { batch: batch.batchNumber }));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('inventory.actionFailed')));
    }
  }

  /** Taking a batch out of circulation, or putting it back. */
  async function setBlocked(batch: MedicineBatch, blocked: boolean) {
    const reason = await ask.prompt({
      title: blocked ? t('medicinePage.blockTitle') : t('medicinePage.unblockTitle'),
      description: blocked
        ? t('medicinePage.blockBody', { batch: batch.batchNumber })
        : t('medicinePage.unblockBody', { batch: batch.batchNumber }),
      label: t('actions.reason'),
      multiline: true,
      confirmLabel: blocked ? t('medicinePage.block') : t('medicinePage.unblock'),
      danger: blocked,
      validate: requireReason(t),
    });
    if (!reason) return;

    try {
      await apiClient.patch(`/inventory/batches/${batch._id}/block`, { blocked, reason });
      await refresh();
      toast.success(blocked ? t('medicinePage.blocked') : t('medicinePage.unblocked'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('inventory.actionFailed')));
    }
  }

  const rows = batches.data?.items ?? [];
  const onHand = rows.reduce((sum, batch) => sum + batch.quantities.onHand, 0);

  const batchColumns: ReadonlyArray<Column<MedicineBatch>> = [
    // The batch *number* printed on the carton, never the database id: that is
    // what a storekeeper can read off the box in front of them.
    {
      key: 'batch',
      header: t('fields.batch'),
      cell: (batch) => (
        <div>
          <p className="font-medium text-text">{batch.batchNumber}</p>
          <p className="text-sm text-text-muted">{batch.warehouseLocation}</p>
        </div>
      ),
    },
    {
      key: 'expiry',
      header: t('fields.expiry'),
      cell: (batch) => formatFinanceDate(batch.expiryDate),
    },
    {
      key: 'on-hand',
      header: t('inventory.onHand'),
      numeric: true,
      cell: (batch) => batch.quantities.onHand,
    },
    {
      key: 'available',
      header: t('catalogue.available'),
      numeric: true,
      cell: (batch) => batch.quantities.available,
    },
    {
      key: 'reserved',
      header: t('catalogue.reserved'),
      numeric: true,
      cell: (batch) => batch.quantities.reserved,
    },
    {
      key: 'state',
      header: t('inventory.columnWarnings'),
      cell: (batch) => (
        <span className="flex flex-wrap gap-1">
          {batch.isBlocked && <Badge tone="danger">{t('inventory.blocked')}</Badge>}
          {batch.isQuarantined && <Badge tone="warning">{t('inventory.quarantined')}</Badge>}
        </span>
      ),
    },
  ];

  /*
   * The actions column exists only for somebody who has one. A storekeeper may
   * record a movement; correcting a count and blocking a batch are management.
   * A column of empty cells would say the opposite.
   */
  const actionColumn: Column<MedicineBatch> = {
    key: 'actions',
    header: t('inventory.columnActions'),
    cell: (batch) => (
      <div className="flex flex-wrap items-center gap-2">
        {mayOperate && (
          <select
            aria-label={t('inventory.actionFor', { batch: batch.batchNumber })}
            value=""
            onChange={(event) => {
              const value = event.target.value as StockMovementType;
              if (value) void recordChange(batch, value);
              event.target.value = '';
            }}
            className="min-h-11 rounded-md border border-border bg-surface px-3 text-text"
          >
            <option value="">{t('inventory.chooseAction')}</option>
            {MANUAL_MOVEMENTS.map((type) => (
              <option key={type} value={type}>
                {t(`movementType.${type}`)}
              </option>
            ))}
          </select>
        )}
        {mayAdjust && (
          <>
            <Button size="sm" onClick={() => void correctCount(batch)}>
              {t('medicinePage.correctCount')}
            </Button>
            <Button size="sm" onClick={() => void setBlocked(batch, !batch.isBlocked)}>
              {batch.isBlocked ? t('medicinePage.unblock') : t('medicinePage.block')}
            </Button>
          </>
        )}
      </div>
    ),
  };

  const columns = mayOperate || mayAdjust ? [...batchColumns, actionColumn] : batchColumns;

  return (
    <Resource
      query={medicine}
      loadingLabel={t('catalogue.loadingOne')}
      errorMessageFallback={t('catalogue.couldNotLoadOne')}
    >
      {(item) => {
        const margin = marginPercent(item.defaultSellingPriceMinor, item.mrpMinor);
        const carriers = (priceLists.data?.items ?? []).filter((list) =>
          list.lines.some((line) => line.medicineId === id),
        );

        return (
          <>
            {/*
              No "Back to the catalogue" button.

              The breadcrumb `PageHeader` already renders says the same thing in
              the place people look for it, and two back links a centimetre
              apart is not a choice anybody wanted to make.
            */}
            <PageHeader
              routeId="medicine-detail"
              title={describe([item.brandName, item.strength], ' ')}
              description={describe([item.genericName, item.dosageForm, item.packSize])}
              actions={
                mayEdit && (
                  <>
                    <LinkButton to={`/medicines/${item._id}/edit`}>
                      {t('medicinePage.edit')}
                    </LinkButton>
                    <Button onClick={() => void setListed(item, !item.isActive)}>
                      {item.isActive ? t('medicinePage.delist') : t('medicinePage.list')}
                    </Button>
                  </>
                )
              }
            />

            <StatGrid className="mb-4">
              <Stat
                label={t('catalogue.availability')}
                value={item.totalAvailable ?? 0}
                note={`${t('catalogue.orderLimits')}: ${item.minimumOrderQuantity}–${
                  item.maximumOrderQuantity ?? t('catalogue.noMaximum')
                }`}
                tone={(item.totalAvailable ?? 0) > 0 ? 'neutral' : 'warning'}
              />
              {showStock && <Stat label={t('inventory.onHand')} value={onHand} />}
              {showCommercial && (
                <Stat
                  label={t('catalogue.listPrice')}
                  value={formatMinor(item.defaultSellingPriceMinor)}
                  note={t('medicinePage.perUnit', { unit: item.unit })}
                />
              )}
              {showCommercial && (
                <Stat
                  label={t('medicinePage.margin')}
                  value={margin === undefined ? '—' : `${margin}%`}
                  note={
                    margin === undefined ? t('medicinePage.noMrp') : t('medicinePage.marginNote')
                  }
                />
              )}
            </StatGrid>

            <div className="flex flex-col gap-4">
              <Section id="about" title={t('catalogue.about')}>
                <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
                  <ProductImage path={item.productImageUrl} className="h-48" />
                  <dl className="m-0">
                    <Detail label={t('common.reference')}>
                      {item.reference} · {item.sku}
                    </Detail>
                    {item.barcode && (
                      <Detail label={t('medicineForm.barcode')}>{item.barcode}</Detail>
                    )}
                    {item.productType && (
                      <Detail label={t('catalogue.productType')}>
                        {t(`productType.${item.productType}`)}
                      </Detail>
                    )}
                    <Detail label={t('catalogue.manufacturer')}>{item.manufacturer}</Detail>
                    <Detail label={t('catalogue.category')}>{item.category}</Detail>
                    <Detail label={t('catalogue.classification')}>
                      {t(`classification.${item.classification}`)}
                    </Detail>
                    <Detail label={t('catalogue.packSize')}>{item.packSize}</Detail>
                    <Detail label={t('medicineForm.unit')}>{item.unit}</Detail>
                    <Detail label={t('catalogue.coldChain')}>
                      {item.coldChain ? t('catalogue.yes') : t('catalogue.no')}
                    </Detail>
                    <Detail label={t('fields.status')}>
                      {item.isActive ? (
                        <Badge tone="success">{t('catalogue.listedActive')}</Badge>
                      ) : (
                        <Badge tone="warning">{t('catalogue.listedInactive')}</Badge>
                      )}
                    </Detail>
                  </dl>
                </div>
                {item.description && <p className="mt-3 text-text-muted">{item.description}</p>}
              </Section>

              {showCommercial && (
                <Section id="pricing" title={t('medicinePage.pricing')}>
                  <dl className="m-0">
                    {showCost && (
                      <Detail label={t('medicineForm.costPrice')}>
                        {formatMinor(item.costPriceMinor)}
                      </Detail>
                    )}
                    <Detail label={t('catalogue.listPrice')}>
                      {formatMinor(item.defaultSellingPriceMinor)}
                    </Detail>
                    <Detail label={t('medicineForm.mrp')}>
                      {item.mrpMinor === undefined
                        ? t('medicinePage.noMrpSet')
                        : formatMinor(item.mrpMinor)}
                    </Detail>
                    <Detail label={t('medicinePage.margin')}>
                      {margin === undefined ? t('medicinePage.noMrp') : `${margin}%`}
                    </Detail>
                  </dl>

                  <p className="mt-3 text-sm text-text-muted">{t('medicinePage.priceOrder')}</p>

                  {mayEdit && (
                    <form
                      className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4"
                      onSubmit={(event) => void saveTradePrice(event, item)}
                    >
                      <Field
                        label={t('medicinePage.newPrice')}
                        hint={t('medicinePage.newPriceHint')}
                        className="min-w-48 flex-1"
                      >
                        <Input
                          inputMode="decimal"
                          placeholder={toMoneyInputValue(item.defaultSellingPriceMinor)}
                          value={price}
                          onChange={(event) => setPrice(event.target.value)}
                        />
                      </Field>
                      <Button type="submit" variant="primary" busy={savingPrice} className="mb-6">
                        {t('medicinePage.changePrice')}
                      </Button>
                    </form>
                  )}

                  <h3 className="mt-4 text-sm font-semibold text-text">
                    {t('medicinePage.onPriceLists')}
                  </h3>
                  {carriers.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('medicinePage.noPriceLists')}</p>
                  ) : (
                    <ul className="m-0 list-none p-0">
                      {carriers.map((list) => {
                        const line = list.lines.find((entry) => entry.medicineId === id)!;
                        return (
                          <li
                            key={list._id}
                            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0"
                          >
                            <LinkButton size="sm" to={`/pricing/price-lists/${list._id}`}>
                              {list.name}
                            </LinkButton>
                            <span className="tabular-nums text-text">
                              {formatMinor(line.unitPriceMinor)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Section>
              )}

              {showCommercial && (
                <Section
                  id="offers"
                  title={t('medicinePage.offers')}
                  actions={
                    mayEdit && (
                      <LinkButton size="sm" to="/pricing/schemes/new">
                        {t('schemes.add')}
                      </LinkButton>
                    )
                  }
                >
                  <Resource
                    query={schemes}
                    loadingLabel={t('medicinePage.offers')}
                    errorMessageFallback={t('lists.couldNotLoad')}
                    empty={<EmptyState title={t('medicinePage.noOffers')} />}
                  >
                    {(page) => (
                      <ul className="m-0 list-none p-0">
                        {page.items.map((scheme) => (
                          <li
                            key={scheme._id}
                            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0"
                          >
                            <div>
                              <p className="font-medium text-text">{scheme.name}</p>
                              <p className="text-sm text-text-muted">
                                {t('schemes.buyGet', {
                                  buy: scheme.buyQuantity,
                                  free: scheme.freeQuantity,
                                })}
                                {' · '}
                                {scheme.shopIds.length === 0
                                  ? t('schemes.everyCustomer')
                                  : t('schemes.namedCustomers', { count: scheme.shopIds.length })}
                              </p>
                            </div>
                            <Badge tone={scheme.isActive ? 'success' : 'neutral'}>
                              {scheme.isActive ? t('common.active') : t('common.inactive')}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Resource>
                </Section>
              )}

              {showStock && (
                <Section
                  id="stock"
                  title={t('catalogue.batches')}
                  actions={
                    mayOperate && (
                      <Button size="sm" variant="primary" onClick={() => setReceiptOpen(true)}>
                        {t('inventory.receiveStock')}
                      </Button>
                    )
                  }
                >
                  <Resource
                    query={batches}
                    loadingLabel={t('catalogue.batches')}
                    errorMessageFallback={t('lists.couldNotLoad')}
                    empty={<EmptyState title={t('catalogue.noBatches')} />}
                  >
                    {(page) => (
                      <DataTable
                        caption={t('catalogue.batches')}
                        columns={columns}
                        rows={page.items}
                        rowKey={(batch) => batch._id}
                        rowTest={(batch) => batch.batchNumber}
                      />
                    )}
                  </Resource>
                </Section>
              )}

              {showStock && (
                <Section id="history" title={t('medicinePage.history')}>
                  <Resource
                    query={movements}
                    loadingLabel={t('inventory.movements')}
                    errorMessageFallback={t('lists.couldNotLoad')}
                    empty={<EmptyState title={t('inventory.noMovements')} />}
                  >
                    {(page) => (
                      <ul className="m-0 list-none p-0">
                        {page.items.map((movement) => (
                          <li
                            key={movement._id}
                            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0"
                          >
                            <div>
                              <p className="font-medium text-text">
                                {t(`movementType.${movement.type}`)}
                              </p>
                              <p className="text-sm text-text-muted">
                                {describe([
                                  movement.batchId?.batchNumber,
                                  movement.actorId &&
                                    `${movement.actorId.firstName} ${movement.actorId.lastName}`,
                                ])}
                              </p>
                              {movement.reason && (
                                <p className="text-sm text-text-muted">{movement.reason}</p>
                              )}
                            </div>
                            <div className="text-end">
                              <strong className="tabular-nums text-text">
                                {movement.quantity}
                              </strong>
                              <p className="text-sm text-text-muted">
                                {formatFinanceDateTime(movement.createdAt)}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Resource>
                </Section>
              )}
            </div>

            <Dialog
              open={receiptOpen}
              onOpenChange={setReceiptOpen}
              title={t('inventory.receiveStock')}
              description={t('medicinePage.receiveInto', { brand: item.brandName })}
              footer={
                <>
                  <Button onClick={() => setReceiptOpen(false)}>{t('common.cancel')}</Button>
                  <Button type="submit" form="receive-stock" variant="primary" busy={receiving}>
                    {t('inventory.receiveStock')}
                  </Button>
                </>
              }
            >
              <form
                id="receive-stock"
                className="flex flex-col gap-3"
                onSubmit={(event) => void receive(event)}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ['batchNumber', 'batchNumber', 'text', true],
                      ['manufacturingDate', 'manufacturingDate', 'date', true],
                      ['expiryDate', 'expiryDate', 'date', true],
                      ['quantity', 'quantity', 'number', true],
                      ['costPrice', 'costPrice', 'text', true],
                      ['sellingPrice', 'sellingOverride', 'text', false],
                      ['warehouseLocation', 'warehouseLocation', 'text', true],
                    ] as const
                  ).map(([name, key, type, required]) => (
                    <Field
                      key={name}
                      label={t(`inventory.${key}`)}
                      required={required}
                      hint={
                        name === 'sellingPrice' ? t('inventory.sellingOverrideHint') : undefined
                      }
                    >
                      <Input
                        required={required}
                        type={type}
                        min={type === 'number' ? 0 : undefined}
                        inputMode={
                          name === 'costPrice' || name === 'sellingPrice' ? 'decimal' : undefined
                        }
                        value={receipt[name]}
                        onChange={(event) =>
                          setReceipt((current) => ({ ...current, [name]: event.target.value }))
                        }
                      />
                    </Field>
                  ))}
                </div>
                <Field label={t('fields.notes')}>
                  <Textarea
                    value={receipt.notes}
                    onChange={(event) =>
                      setReceipt((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </Field>
              </form>
            </Dialog>
          </>
        );
      }}
    </Resource>
  );
}
