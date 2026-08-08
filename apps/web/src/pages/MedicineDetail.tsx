import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlternativeGroupKind,
  DeliveryRestriction,
  MedicineContentGroup,
  SafetyAdviceTag,
  StockMovementType,
  UserRole,
  type AlternativeGroup,
  type ContentLanguage,
  type Medicine,
  type MedicineBatch,
  type PriceListRecord,
  type SafetyAdviceType,
  type SchemeRecord,
} from '@medsupply/shared-types';
import { marginPercent, parseMoney, toMoneyInputValue } from '@medsupply/utilities';
import { apiClient, errorMessage } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { useCart } from '../store/useCart';
import {
  canAdjustStock,
  canEditCatalogue,
  canOperateStock,
  canReadCatalogue,
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
  type BadgeTone,
  type Column,
} from '../components/ui';
import { ProductCard } from '../components/ProductCard';
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

/**
 * The product's photographs, one large and the rest as a row to choose from.
 *
 * The catalogue held a single image per product until the shelf trail and
 * gallery landed, so a pharmacy deciding between two similar packs saw one
 * angle of each. Products carry up to sixteen shots.
 *
 * The thumbnails are only rendered when there is more than one — a lone
 * thumbnail under its own full-size copy is a control that does nothing.
 */
function Gallery({ item }: { item: Medicine }) {
  const shots = item.productImages?.length
    ? item.productImages
    : [item.productImageUrl].filter((path): path is string => Boolean(path));
  const [shown, setShown] = useState(0);
  const { t } = useLanguage();
  // A product can change under a stale index — a shorter gallery on the next
  // one would otherwise render nothing at all.
  const at = Math.min(shown, Math.max(0, shots.length - 1));

  return (
    <div className="flex flex-col gap-2">
      <ProductImage path={shots[at]} className="h-48" />
      {shots.length > 1 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {shots.map((path, index) => (
            <li key={path}>
              <button
                type="button"
                aria-label={t('catalogue.showPhoto', { number: index + 1 })}
                aria-current={index === at}
                onClick={() => setShown(index)}
                className={`block rounded border p-0.5 ${
                  index === at ? 'border-brand' : 'border-border'
                }`}
              >
                <ProductImage path={path} className="h-10 w-10" />
              </button>
            </li>
          ))}
        </ul>
      )}
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

/*
 * What `GET /medicines/{id}/content` answers: the stored sections already
 * bucketed by group, groups already in reading order. Local, like `Movement`
 * above — the shared `MedicineContent` type is the stored document, and this
 * is the served answer, which the service reshapes on the way out.
 */
interface MonographSection {
  title?: string;
  body: string;
  safety?: { type?: SafetyAdviceType; tag?: SafetyAdviceTag };
}

interface MonographGroup {
  group: MedicineContentGroup;
  sections: MonographSection[];
}

interface Monograph {
  /** The language actually returned — English when no Bangla sibling exists. */
  lang: ContentLanguage;
  /** The language asked for, so the fallback is stated rather than hidden. */
  requested: ContentLanguage;
  groups: MonographGroup[];
  source?: { name?: string; scrapedAt?: string };
}

/*
 * The verdict's colour ranks it at a glance, but the words carry it: the badge
 * always prints the tag itself, so a colour-blind pharmacist reads exactly what
 * a colour-sighted one does. Colour as the only channel is the defect the axe
 * scan is held at zero to keep out — and it is also why two verdicts may share
 * a tone: "consult your doctor" and "use with caution" both rank as warnings,
 * and the words tell them apart. A `Record` rather than a lookup with a
 * default, so a verdict added to the enum is a compile error here instead of a
 * badge silently rendered in whatever tone "unknown" happened to fall to.
 */
const SAFETY_TONES: Record<SafetyAdviceTag, BadgeTone> = {
  [SafetyAdviceTag.SAFE]: 'success',
  [SafetyAdviceTag.SAFE_IF_PRESCRIBED]: 'info',
  [SafetyAdviceTag.CONSULT_YOUR_DOCTOR]: 'warning',
  [SafetyAdviceTag.CAUTION]: 'warning',
  [SafetyAdviceTag.UNSAFE]: 'danger',
  [SafetyAdviceTag.NOT_RELEVANT]: 'neutral',
};

/**
 * A passage that folds when it is long.
 *
 * The longest body in the imported catalogue is 29,431 characters, and a page
 * that dumps that between a pharmacist and the stock table is a page nobody
 * scrolls to the end of. But a fold that hides only a line or two is a control
 * that costs a tap and saves nothing, so short passages render whole — the
 * fold only exists where it hides something worth hiding. The cut lands on a
 * word boundary because half of "hypersensitivity" reads as a rendering fault
 * rather than as a fold.
 */
const FOLD_OVER = 900;
const FOLDED_LENGTH = 600;

function Passage({ body }: { body: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const passageId = useId();

  if (body.length <= FOLD_OVER) {
    return <p className="m-0 whitespace-pre-line text-text-muted">{body}</p>;
  }

  const boundary = body.lastIndexOf(' ', FOLDED_LENGTH);
  const folded = body.slice(0, boundary > 0 ? boundary : FOLDED_LENGTH);

  return (
    <div>
      <p id={passageId} className="m-0 whitespace-pre-line text-text-muted">
        {open ? body : `${folded}…`}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={passageId}
        onClick={() => setOpen((current) => !current)}
        className="mt-1 min-h-11 text-sm font-medium text-brand underline underline-offset-2"
      >
        {open ? t('catalogueContent.showLess') : t('catalogueContent.showMore')}
      </button>
    </div>
  );
}

/**
 * One list of suggested products, shared by the alternatives groups and the
 * promoted section — the cards look identical on purpose; what differs is the
 * heading over them, and that difference is the whole point of the split.
 */
function AlternativeItems({
  items,
  showPrices,
  onAdd,
}: {
  items: AlternativeGroup['items'];
  showPrices: boolean;
  /** Absent for anybody who cannot place an order; the card then has no action. */
  onAdd?: (item: AlternativeGroup['items'][number]) => void;
}) {
  const { t } = useLanguage();
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3 p-0">
      {items.map((other) => (
        <li key={other._id}>
          <ProductCard
            item={other}
            showPrices={showPrices}
            action={
              onAdd && (
                <Button
                  size="sm"
                  variant="primary"
                  className="w-full"
                  data-test={`add-${other.reference}`}
                  onClick={() => onAdd(other)}
                >
                  {t('catalogue.addToOrder')}
                </Button>
              )
            }
          />
        </li>
      ))}
    </ul>
  );
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
  /*
   * Whether to show the *pricing tools* — a price list, an offer, the editable
   * trade price. Not whether to show the price itself.
   */
  const showCommercial = canSeeCommercial(role);
  const showCost = canSeeCost(role);
  /*
   * The price a pharmacy pays, and the price printed on the pack.
   *
   * These were behind `canSeeCommercial`, which excludes `SHOP_OWNER` — so the
   * buyer read the price on the catalogue card, clicked into the product, and
   * it vanished. The server has never hidden either figure from them
   * (`hideCosts` strips `costPriceMinor` and nothing else), and the list has
   * always rendered them, so this was a disclosure rule that existed only on
   * one screen and only against the person the screen is for.
   */
  const showPrices = canReadCatalogue(role);
  /*
   * Only the customer places an order, which is the same rule the catalogue
   * list applies. Staff order on a shop's behalf from order entry, where they
   * have first chosen which shop they are acting for — a bare "add to order"
   * here would have no basket to add to.
   */
  const mayOrder = role === UserRole.SHOP_OWNER;
  const addToCart = useCart((state) => state.add);

  /** Adds, and says so — the basket lives in the header and is easy to miss. */
  function addToOrder(product: Medicine) {
    addToCart(product);
    toast.success(t('cart.addedToOrder', { brand: product.brandName }));
  }
  const mayEdit = canEditCatalogue(role);
  const mayOperate = canOperateStock(role);
  const mayAdjust = canAdjustStock(role);

  const [receipt, setReceipt] = useState(EMPTY_RECEIPT);
  const [receiving, setReceiving] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

  const medicine = useApiResource<Medicine>(keys.medicines.one(id!), `/inventory/medicines/${id}`);
  /*
   * What else could be sent instead — a second request rather than a field on
   * the medicine, because it costs three aggregations and this page is opened
   * constantly during order entry. It resolves after the page has already
   * rendered, and the section is simply absent until it does.
   */
  const alternatives = useApiResource<AlternativeGroup[]>(
    keys.medicines.alternatives(id!),
    `/inventory/medicines/${id}/alternatives`,
  );
  /*
   * The manufacturer's copy, fetched apart from the medicine for the same
   * reason as the alternatives: kilobytes of prose the catalogue queries never
   * read, on a page opened constantly during order entry. Asked for in the
   * reader's language; the server answers `null` for a line with no copy at
   * all — every hand-entered medicine — and falls back to English when only
   * the Bangla sibling is missing, saying so in `requested`.
   */
  const content = useApiResource<Monograph | null>(
    keys.medicines.content(id!, language),
    `/inventory/medicines/${id}/content?lang=${language}`,
  );
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
        const monograph = content.data;
        /*
         * `PROMOTED` is pulled out of the alternatives and given a section of
         * its own. It is the supplier's bestseller carousel — advertising, not
         * a clinical relationship — and on a prescription line it returns
         * products with no connection to the medicine at all. Rendered under
         * "What else could be sent" it would claim exactly the equivalence it
         * does not have, so the split is the labelling, not a layout choice.
         */
        const suggestions = alternatives.data ?? [];
        const shelf = suggestions.filter((group) => group.kind !== AlternativeGroupKind.PROMOTED);
        const promoted = suggestions.filter(
          (group) => group.kind === AlternativeGroupKind.PROMOTED,
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

            {/*
              The product block, which is what somebody came to this page for.

              Photograph and price side by side, because the two decisions a
              pharmacy makes here — "is this the right pack" and "what does it
              cost me" — were previously separated by four stat tiles and a
              definition list. The stat row that used to sit here is still
              below; it carries the warehouse figures a storekeeper wants, and
              those are a different job from buying.
            */}
            <Card className="mb-4">
              <div className="grid gap-5 md:grid-cols-[16rem_minmax(0,1fr)]">
                <Gallery item={item} />

                <div className="flex flex-col gap-3">
                  {/*
                    No product name here on purpose. `PageHeader` a centimetre
                    above already carries it as the page's `h1`, with the
                    ingredient, form and pack beneath — repeating it would be
                    two headings for one product, and a screen reader would
                    announce the medicine twice before reaching the price.

                    The manufacturer is the exception: it is what a pharmacist
                    checks when two brands share a molecule, and the record
                    below is a scroll away.
                  */}
                  <p className="m-0 text-text-muted">{item.manufacturer}</p>

                  {/*
                    The facts that change what somebody does, as badges: is it
                    on the catalogue, does it need a prescription, does it need
                    a cold van, and can it even go where this customer is. Each
                    is also a row in the record below, which is where somebody
                    reading the whole line finds it; here they are the four
                    worth seeing without reading.
                  */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={item.isActive ? 'success' : 'neutral'}>
                      {item.isActive ? t('catalogue.listedActive') : t('catalogue.listedInactive')}
                    </Badge>
                    {item.coldChain && (
                      <Badge tone="warning">{t('catalogue.coldChainShort')}</Badge>
                    )}
                    {item.deliveryRestriction === DeliveryRestriction.DHAKA_ONLY && (
                      <Badge tone="warning">{t('catalogue.dhakaOnly')}</Badge>
                    )}
                  </div>

                  {/*
                    Trade price first and largest, MRP struck through beside it,
                    and the gap between them as the pharmacy's margin. A
                    consumer shop would call that gap a discount; here it is
                    what the buyer earns, so it is labelled as margin. The MRP
                    is shown only when it is genuinely higher — on a line where
                    the two are equal, a struck-through identical figure reads
                    as a broken offer.
                  */}
                  {showPrices && (
                    <div>
                      {/*
                        Labelled, for the reason the mobile gate enforces on the
                        other client: a bare figure under a medicine reads as
                        the price this shop pays, and it is the list price.
                      */}
                      <p className="m-0 text-sm text-text-muted">{t('catalogue.listPrice')}</p>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-3xl font-semibold tabular-nums text-text">
                          {formatMinor(item.defaultSellingPriceMinor)}
                        </span>
                        {item.mrpMinor !== undefined &&
                          item.mrpMinor > item.defaultSellingPriceMinor && (
                            <span className="text-lg text-text-muted line-through tabular-nums">
                              {formatMinor(item.mrpMinor)}
                            </span>
                          )}
                        {margin !== undefined && margin > 0 && (
                          <Badge tone="success">
                            {t('catalogue.marginBadge', { percent: margin })}
                          </Badge>
                        )}
                      </div>
                      <p className="m-0 mt-1 text-sm text-text-muted">
                        {t('medicinePage.perUnit', { unit: item.unit })}
                        {item.mrpMinor !== undefined &&
                          item.mrpMinor > 0 &&
                          ` · ${t('medicinePage.mrpIs', { amount: formatMinor(item.mrpMinor) })}`}
                      </p>
                      {/*
                        The list price is not necessarily this customer's price.
                        Their own price list and any running offer are applied
                        by the server when the order is priced, and a page that
                        implied otherwise would be quoting a figure the invoice
                        then contradicts.
                      */}
                      <p className="m-0 mt-1 text-sm text-text-muted">
                        {t('medicinePage.priceCaveat')}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={(item.totalAvailable ?? 0) > 0 ? 'success' : 'neutral'}>
                      {(item.totalAvailable ?? 0) > 0
                        ? t('alternatives.inStock', { count: item.totalAvailable ?? 0 })
                        : t('alternatives.noStock')}
                    </Badge>
                    <span className="text-sm text-text-muted">
                      {t('catalogue.orderLimits')}: {item.minimumOrderQuantity}–
                      {item.maximumOrderQuantity ?? t('catalogue.noMaximum')}
                    </span>
                  </div>

                  {mayOrder && (
                    <div>
                      <Button
                        variant="primary"
                        data-test="add-to-order"
                        onClick={() => addToOrder(item)}
                      >
                        {t('catalogue.addToOrder')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/*
              What the warehouse holds, which is a different question from what
              a buyer is deciding. Free stock, the price and the margin all
              moved into the product block above; repeating them here was the
              same figure twice on one screen — the defect this page already
              avoids for the product name.

              `onHand` stays because it is genuinely a second number: everything
              in the building, before anything promised to an order is taken
              off it. Only staff see it, and only staff can act on it.
            */}
            {showStock && (
              <StatGrid className="mb-4">
                <Stat label={t('inventory.onHand')} value={onHand} />
              </StatGrid>
            )}

            <div className="flex flex-col gap-4">
              {/*
                The photographs moved up into the product block, so this is now
                the record rather than the shop window — reference, shelf,
                pack, status. Two galleries a screen apart was one gallery too
                many.
              */}
              <Section id="about" title={t('catalogue.about')}>
                <div className="grid gap-4">
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
                    {/*
                      The whole shelf trail, each level a link to everything
                      under it. The catalogue knew a product was an
                      "Anti-Bacterial" and not that this sits under "Medicine",
                      so there was nowhere to go from here but back to a search.
                    */}
                    <Detail label={t('catalogue.category')}>
                      {item.categoryPath?.length ? (
                        <span className="flex flex-wrap items-baseline gap-1">
                          {item.categoryPath.map((level, index) => (
                            <span key={level} className="flex items-baseline gap-1">
                              {index > 0 && (
                                <span aria-hidden className="text-text-muted">
                                  ›
                                </span>
                              )}
                              <Link
                                to={`/medicines?branch=${encodeURIComponent(level)}`}
                                className="text-brand underline underline-offset-2"
                              >
                                {level}
                              </Link>
                            </span>
                          ))}
                        </span>
                      ) : (
                        item.category
                      )}
                    </Detail>
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

              {/*
                The monograph — dosage, contraindications, interactions — under
                a heading that says whose words these are. This is a reprinted
                manufacturer leaflet plus their marketing copy, and nothing on
                this screen may let it read as MedSupply's own clinical
                guidance: the attribution is the section title so it cannot be
                scrolled past, and the caution sits above the first passage
                rather than below the last one, 29,000 characters too late.
              */}
              {monograph && monograph.groups.length > 0 && (
                <Section id="monograph" title={t('catalogueContent.provenance')}>
                  <p className="mb-1 text-sm text-text-muted">{t('catalogueContent.notAdvice')}</p>
                  {monograph.lang !== monograph.requested && (
                    // The Bangla sibling simply does not exist for this line —
                    // true of one imported product in eleven — and a screen
                    // that swaps language without saying so reads as broken.
                    <p data-test="monograph-language" className="mb-1 text-sm text-text-muted">
                      {t('catalogueContent.onlyInEnglish')}
                    </p>
                  )}
                  <div className="mt-4 flex flex-col gap-5">
                    {monograph.groups.map((bundle) => (
                      <div key={bundle.group}>
                        <h3 className="mb-2 text-sm font-semibold text-text">
                          {t(`catalogueContent.group.${bundle.group}`)}
                        </h3>
                        {bundle.group === MedicineContentGroup.QUICK_TIP ? (
                          // Tips have no titles and are one line each — a list,
                          // not a run of paragraphs pretending to be one.
                          <ul className="m-0 list-disc ps-5 text-text-muted">
                            {bundle.sections.map((section) => (
                              <li key={section.body} className="mb-1 last:mb-0">
                                {section.body}
                              </li>
                            ))}
                          </ul>
                        ) : bundle.group === MedicineContentGroup.SAFETY ? (
                          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
                            {bundle.sections.map((section, index) => (
                              <li
                                key={section.safety?.type ?? index}
                                className="rounded-lg border border-border p-3"
                              >
                                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-medium text-text">
                                    {section.safety?.type
                                      ? t(`catalogueContent.safetyType.${section.safety.type}`)
                                      : section.title}
                                  </span>
                                  {section.safety?.tag && (
                                    <Badge tone={SAFETY_TONES[section.safety.tag]}>
                                      {t(`catalogueContent.safetyTag.${section.safety.tag}`)}
                                    </Badge>
                                  )}
                                </div>
                                <Passage body={section.body} />
                              </li>
                            ))}
                          </ul>
                        ) : (
                          bundle.sections.map((section, index) => (
                            <div key={section.title ?? index} className="mb-3 last:mb-0">
                              {section.title && (
                                <h4 className="mb-1 font-medium text-text">{section.title}</h4>
                              )}
                              <Passage body={section.body} />
                            </div>
                          ))
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

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

              {shelf.length > 0 && (
                <Section id="alternatives" title={t('alternatives.title')}>
                  <p className="mb-3 text-sm text-text-muted">{t('alternatives.subtitle')}</p>
                  {shelf.map((group) => (
                    <div key={group.kind} className="mb-5 last:mb-0">
                      <h3 className="mb-2 text-sm font-semibold text-text">
                        {t(`alternativeGroup.${group.kind}`)}
                      </h3>
                      <AlternativeItems
                        items={group.items}
                        showPrices={showPrices}
                        onAdd={mayOrder ? addToOrder : undefined}
                      />
                    </div>
                  ))}
                </Section>
              )}

              {/*
                The advert, headed as one. See the `shelf`/`promoted` split
                above for why this is never rendered among the alternatives.
              */}
              {promoted.length > 0 && (
                <Section id="promoted" title={t('catalogueContent.promoted')}>
                  <p className="mb-3 text-sm text-text-muted">
                    {t('catalogueContent.promotedNote')}
                  </p>
                  {promoted.map((group) => (
                    <AlternativeItems
                      key={group.kind}
                      items={group.items}
                      showPrices={showPrices}
                      onAdd={mayOrder ? addToOrder : undefined}
                    />
                  ))}
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
                <Field label={t('fields.notes')} hint={t('hints.adjustReason')}>
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
