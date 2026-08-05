import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { UserRole } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Resource,
  Select,
  Textarea,
  requireReason,
  toast,
  useAsk,
  type Column,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { applyScan, matchScan, parseScan, type ScannableLine } from '../lib/picking';
import { useLanguage } from '../lib/useLanguage';
import { formatMinor } from '../lib/finance';

interface PickingItem {
  _id: string;
  medicineId: { _id: string; brandName: string; genericName: string; strength: string };
  batchId: string;
  quantity: number;
  pickedQuantity: number;
  packedQuantity: number;
}

interface Discrepancy {
  _id: string;
  type: string;
  quantity: number;
  notes: string;
  status: string;
  resolutionNotes?: string;
}

interface PickingList {
  _id: string;
  status: string;
  version: number;
  items: PickingItem[];
  /**
   * Batch numbers, keyed by batch id.
   *
   * Sent alongside the items rather than populated over `batchId`, because the
   * picker posts that id straight back when recording progress — replacing it
   * with a document would have broken picking in order to fix a label.
   */
  batchNumbers?: Record<string, { batchNumber: string; expiryDate: string }>;
  orderId: { reference: string; shopId: { name: string } };
  discrepancies: Discrepancy[];
}

interface IssuedResult {
  invoice: {
    _id: string;
    reference: string;
    items: Array<{
      medicineSnapshot: { brandName: string };
      batchNumber: string;
      quantity: number;
      lineTotalMinor: number;
    }>;
    subtotalMinor: number;
    orderDiscountMinor: number;
    deliveryChargeMinor: number;
    taxMinor: number;
    previousBalanceMinor: number;
    grandTotalMinor: number;
    totalOutstandingMinor: number;
  };
  package: { reference: string; barcode: string; packageCount: number; weightGrams?: number };
}

const DISCREPANCY_TYPES = [
  'MISSING_QUANTITY',
  'DAMAGED_ITEM',
  'WRONG_BATCH',
  'EXPIRED_BATCH',
  'STOCK_MISMATCH',
  'PRODUCT_UNAVAILABLE',
  'OTHER',
];

export function FulfilmentWork() {
  const ask = useAsk();
  const { id } = useParams();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const isStorekeeper = role === UserRole.STOREKEEPER;
  const canResolve = role
    ? ([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER] as UserRole[]).includes(role)
    : false;

  const query = useApiResource<PickingList>(
    keys.fulfilment.picking(id!),
    `/fulfilment/picking/${id}`,
  );
  const list = query.data;

  const [picked, setPicked] = useState<Record<string, number>>({});
  const [packed, setPacked] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [packageCount, setPackageCount] = useState(1);
  const [weight, setWeight] = useState(0);
  const [notes, setNotes] = useState('');
  const [discrepancyLine, setDiscrepancyLine] = useState('');
  const [discrepancyType, setDiscrepancyType] = useState(DISCREPANCY_TYPES[0]!);
  const [discrepancyQuantity, setDiscrepancyQuantity] = useState(0);
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');
  const [issued, setIssued] = useState<IssuedResult>();

  /*
   * Picking from the carton rather than from the screen.
   *
   * The sheet arrives with every line pre-filled at its full allocation, so the
   * ordinary path is "walk the aisle, then press Confirm" — which records what
   * was *allocated* and only catches a shortfall if the picker remembers to
   * type one. That is fine for two lines and wrong for twenty.
   *
   * Scanning switches the sheet to counting **up**: the first scan zeroes every
   * line and each scan after it adds one unit to the line whose batch number
   * was read. Nothing changes for anyone who does not scan, which is why this
   * is a mode rather than a new default — flipping the seed for everybody would
   * turn a picker's muscle memory into systematic under-picking.
   */
  const [counting, setCounting] = useState(false);
  const [scan, setScan] = useState('');
  const [scanError, setScanError] = useState('');

  // Seeded from the server, then owned locally — a revalidation must not
  // overwrite counts a picker is halfway through entering.
  useEffect(() => {
    if (!list) return;
    const seed = Object.fromEntries(
      list.items.map((item) => [item._id, item.pickedQuantity || item.quantity]),
    );
    setPicked(seed);
    setPacked(seed);
  }, [list]);

  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.fulfilment.all }),
      queryClient.invalidateQueries({ queryKey: keys.stock.all }),
      queryClient.invalidateQueries({ queryKey: keys.medicines.all }),
      queryClient.invalidateQueries({ queryKey: keys.orders.all }),
    ]);

  /** The lines as the picker sees them: batch number on the carton, not an id. */
  function scannableLines(current: PickingList): ScannableLine[] {
    return current.items.map((item) => ({
      id: item._id,
      batchNumber: current.batchNumbers?.[item.batchId]?.batchNumber ?? '',
      brandName: item.medicineId.brandName,
      allocated: item.quantity,
    }));
  }

  function onScan(current: PickingList) {
    const parsed = parseScan(scan);
    if (!parsed) return;

    const result = matchScan(scannableLines(current), parsed.code);
    if ('error' in result) {
      setScanError(
        result.error === 'AMBIGUOUS'
          ? t('picking.scanAmbiguous', { code: parsed.code })
          : t('picking.scanNotFound', { code: parsed.code }),
      );
      // The text stays so the picker can see what was actually read, which is
      // usually the whole diagnosis with a scanner.
      return;
    }

    setScanError('');
    setPicked((state) => {
      // The first scan zeroes the sheet: from here the count is what was
      // physically handled, not what was allocated.
      const base = counting
        ? state
        : Object.fromEntries(current.items.map((item) => [item._id, 0]));
      const applied = applyScan(base[result.line.id] ?? 0, parsed.quantity, result.line.allocated);
      if (applied.capped) {
        toast.error(t('picking.scanCapped', { brand: result.line.brandName }));
      }
      return { ...base, [result.line.id]: applied.counted };
    });
    setCounting(true);
    setScan('');
  }

  async function post(path: string, body: Record<string, unknown>, done: string, failed: string) {
    if (!list) return;
    try {
      const response = await apiClient.post(`/fulfilment/picking/${id}/${path}`, {
        version: list.version,
        ...body,
      });
      await reload();
      toast.success(done);
      return response;
    } catch (caught) {
      toast.error(errorMessage(caught, language, failed));
      return undefined;
    }
  }

  const saveProgress = (action: 'SAVE' | 'PAUSE' | 'COMPLETE') =>
    post(
      'progress',
      {
        action,
        items: (list?.items ?? []).map((item) => ({
          medicineId: item.medicineId._id,
          batchId: item.batchId,
          pickedQuantity: picked[item._id] ?? 0,
        })),
      },
      action === 'COMPLETE'
        ? t('picking.completed')
        : action === 'PAUSE'
          ? t('picking.paused')
          : t('picking.saved'),
      t('picking.updateFailed'),
    );

  /**
   * Which line the problem is on, chosen rather than assumed.
   *
   * This posted `items[0]` — the *first* line — whatever the picker was
   * actually looking at, so a damaged item on line four was recorded against
   * line one's medicine and line one's batch. That record is what management
   * reads to decide whether to re-pick, adjust stock or quarantine, and it was
   * naming the wrong carton. Mobile had the same line, copied.
   */
  async function reportDiscrepancy() {
    const line = list?.items.find((item) => item._id === discrepancyLine) ?? list?.items[0];
    if (!line || discrepancyNotes.trim().length < 3) {
      toast.error(t('picking.needNotes'));
      return;
    }
    await post(
      'discrepancies',
      {
        type: discrepancyType,
        medicineId: line.medicineId._id,
        batchId: line.batchId,
        quantity: discrepancyQuantity,
        notes: discrepancyNotes,
      },
      t('picking.reported'),
      t('picking.reportFailed'),
    );
  }

  async function resolveDiscrepancy() {
    const resolutionNotes = await ask.prompt({
      title: t('picking.resolveTitle'),
      description: t('picking.resolveBody'),
      label: t('picking.resolveLabel'),
      multiline: true,
      confirmLabel: t('picking.resolveConfirm'),
      validate: requireReason(t),
    });
    if (!resolutionNotes) return;
    await post(
      'discrepancies/resolve',
      { resolutionNotes },
      t('picking.resolved'),
      t('picking.resolveFailed'),
    );
  }

  async function pack() {
    const response = await post(
      'pack',
      {
        items: (list?.items ?? []).map((item) => ({
          medicineId: item.medicineId._id,
          batchId: item.batchId,
          packedQuantity: packed[item._id] ?? 0,
          shortfallReason:
            (packed[item._id] ?? 0) < item.pickedQuantity ? reasons[item._id] : undefined,
        })),
        packageCount,
        weightGrams: weight || undefined,
        notes: notes || undefined,
      },
      t('picking.packed'),
      t('picking.packFailed'),
    );
    if (response) setIssued(response.data.data as IssuedResult);
  }

  async function openInvoice(layout: 'a4' | 'thermal') {
    if (!issued) return;
    try {
      const response = await apiClient.get(`/fulfilment/invoices/${issued.invoice._id}/pdf`, {
        params: { layout },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast.error(t('picking.pdfFailed'));
    }
  }

  function print(layout: 'a4' | 'thermal') {
    document.body.dataset.invoiceLayout = layout;
    window.print();
    window.setTimeout(() => delete document.body.dataset.invoiceLayout, 500);
  }

  function itemColumns(current: PickingList): ReadonlyArray<Column<PickingItem>> {
    return [
      {
        key: 'medicine',
        header: t('fields.medicine'),
        cell: (item) => `${item.medicineId.brandName} ${item.medicineId.strength}`,
      },
      {
        key: 'batch',
        header: t('fields.batch'),
        // The number printed on the carton, not the database id.
        cell: (item) => current.batchNumbers?.[item.batchId]?.batchNumber ?? '—',
      },
      {
        key: 'allocated',
        header: t('picking.columnAllocated'),
        numeric: true,
        cell: (item) => item.quantity,
      },
      {
        key: 'picked',
        header: t('picking.columnPicked'),
        numeric: true,
        cell: (item) =>
          current.status === 'PICKING' ? (
            <input
              aria-label={t('picking.pickedFor', { brand: item.medicineId.brandName })}
              type="number"
              min={0}
              max={item.quantity}
              value={picked[item._id] ?? 0}
              onChange={(event) =>
                setPicked((state) => ({ ...state, [item._id]: Number(event.target.value) }))
              }
              className="min-h-11 w-20 rounded-md border border-border bg-surface px-2 text-end tabular-nums text-text"
            />
          ) : (
            item.pickedQuantity
          ),
      },
      {
        key: 'packed',
        header: t('picking.columnPacked'),
        numeric: true,
        cell: (item) =>
          current.status === 'PACKING' ? (
            <input
              aria-label={t('picking.packedFor', { brand: item.medicineId.brandName })}
              type="number"
              min={0}
              max={item.pickedQuantity}
              value={packed[item._id] ?? 0}
              onChange={(event) =>
                setPacked((state) => ({ ...state, [item._id]: Number(event.target.value) }))
              }
              className="min-h-11 w-20 rounded-md border border-border bg-surface px-2 text-end tabular-nums text-text"
            />
          ) : (
            item.packedQuantity
          ),
      },
      {
        key: 'shortfall',
        header: t('picking.columnShortfall'),
        hideWhenStacked: current.status !== 'PACKING',
        cell: (item) =>
          current.status === 'PACKING' ? (
            <input
              aria-label={t('picking.shortfallFor', { brand: item.medicineId.brandName })}
              value={reasons[item._id] ?? ''}
              onChange={(event) =>
                setReasons((state) => ({ ...state, [item._id]: event.target.value }))
              }
              className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-text"
            />
          ) : null,
      },
    ];
  }

  return (
    <>
      <Resource
        query={query}
        loadingLabel={t('picking.loading')}
        errorMessageFallback={t('picking.couldNotLoad')}
      >
        {(current) => (
          <>
            <PageHeader
              routeId="fulfilment-work"
              title={current.orderId.reference}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={current.status === 'BLOCKED_DISCREPANCY' ? 'danger' : 'info'}>
                    {t(`pickingStatus.${current.status}`)}
                  </Badge>
                  {current.orderId.shopId.name}
                </span>
              }
              actions={<LinkButton to="/fulfilment">{t('picking.queue')}</LinkButton>}
            />

            {current.status === 'PICKING' && (
              <Card className="mb-4">
                <div className="flex flex-col gap-2">
                  <Field label={t('picking.scan')} hint={t('picking.scanHint')}>
                    <Input
                      autoFocus
                      value={scan}
                      onChange={(event) => setScan(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          onScan(current);
                        }
                      }}
                      placeholder={t('picking.scanPlaceholder')}
                    />
                  </Field>

                  {/*
                    Announced rather than only drawn: a picker scanning down an
                    aisle is looking at cartons, not at the screen, and a
                    running count they cannot hear is a count they will not
                    check.
                  */}
                  <p aria-live="polite" className="text-sm text-text-muted">
                    {counting
                      ? t('picking.countingProgress', {
                          counted: Object.values(picked).reduce((sum, value) => sum + value, 0),
                          allocated: current.items.reduce((sum, item) => sum + item.quantity, 0),
                        })
                      : t('picking.notCounting')}
                  </p>

                  {scanError && (
                    <p role="alert" className="text-sm text-danger">
                      {scanError}
                    </p>
                  )}

                  {counting && (
                    <div>
                      <Button
                        onClick={() => {
                          setCounting(false);
                          setScan('');
                          setScanError('');
                          setPicked(
                            Object.fromEntries(
                              current.items.map((item) => [item._id, item.quantity]),
                            ),
                          );
                        }}
                      >
                        {t('picking.stopCounting')}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {current.discrepancies.length > 0 && (
              <Card className="mb-4">
                <h2 className="mb-2 text-lg font-semibold text-text">
                  {t('picking.discrepancies')}
                </h2>
                <ul className="m-0 list-none p-0">
                  {current.discrepancies.map((item) => (
                    <li
                      key={item._id}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0"
                    >
                      <div>
                        <p className="font-medium text-text">{t(`discrepancyType.${item.type}`)}</p>
                        <p className="text-sm text-text-muted">{item.notes}</p>
                      </div>
                      <div className="text-end">
                        {/* The status of a discrepancy is a server string with
                            no shared enum, so it is shown as it comes rather
                            than mapped to words this client made up. */}
                        <Badge>{item.status.replaceAll('_', ' ').toLowerCase()}</Badge>
                        {item.resolutionNotes && (
                          <p className="mt-1 text-sm text-text-muted">{item.resolutionNotes}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {current.status === 'BLOCKED_DISCREPANCY' && canResolve && (
                  <Button
                    variant="primary"
                    className="mt-3"
                    onClick={() => void resolveDiscrepancy()}
                  >
                    {t('picking.resolveAndReturn')}
                  </Button>
                )}
              </Card>
            )}

            {issued ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="invoice-print">
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {issued.invoice.reference}
                  </h2>
                  <ul className="m-0 list-none p-0">
                    {issued.invoice.items.map((item, index) => (
                      <li
                        key={index}
                        className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-1"
                      >
                        <span className="text-text">
                          {item.medicineSnapshot.brandName} · {item.batchNumber} × {item.quantity}
                        </span>
                        <span className="tabular-nums text-text">
                          {formatMinor(item.lineTotalMinor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <dl className="m-0 mt-3">
                    {(
                      [
                        ['picking.invoiceSubtotal', issued.invoice.subtotalMinor],
                        ['picking.invoiceDiscount', issued.invoice.orderDiscountMinor],
                        ['picking.invoiceDelivery', issued.invoice.deliveryChargeMinor],
                        ['picking.invoiceTax', issued.invoice.taxMinor],
                        ['picking.invoiceGrandTotal', issued.invoice.grandTotalMinor],
                        ['picking.invoicePreviousBalance', issued.invoice.previousBalanceMinor],
                        ['picking.invoiceOutstanding', issued.invoice.totalOutstandingMinor],
                      ] as const
                    ).map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-4 py-1">
                        <dt className="text-text-muted">{t(key)}</dt>
                        <dd className="tabular-nums text-text">{formatMinor(value)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-6 text-text-muted">{t('picking.signature')}: ________________</p>
                  <div className="mt-3 flex flex-wrap gap-2 print:hidden">
                    <Button variant="primary" onClick={() => void openInvoice('a4')}>
                      {t('picking.a4Pdf')}
                    </Button>
                    <Button onClick={() => void openInvoice('thermal')}>
                      {t('picking.thermalPdf')}
                    </Button>
                    <Button onClick={() => print('a4')}>{t('picking.printA4')}</Button>
                    <Button onClick={() => print('thermal')}>{t('picking.printThermal')}</Button>
                  </div>
                </Card>

                <Card className="package-label">
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {t('picking.packageLabel')}
                  </h2>
                  <p className="text-lg text-text">{issued.package.reference}</p>
                  <p className="font-mono text-2xl tracking-widest text-text">
                    {issued.package.barcode}
                  </p>
                  <p className="text-text-muted">
                    {issued.package.packageCount === 1
                      ? t('picking.oneBox')
                      : t('picking.boxes', { count: issued.package.packageCount })}
                  </p>
                  {issued.package.weightGrams ? (
                    <p className="text-text-muted">
                      {t('picking.grams', { grams: issued.package.weightGrams })}
                    </p>
                  ) : null}
                </Card>
              </div>
            ) : (
              <>
                <Card className="mb-4">
                  <h2 className="mb-2 text-lg font-semibold text-text">
                    {current.status === 'PACKING'
                      ? t('picking.packingConfirmation')
                      : t('picking.allocated')}
                  </h2>
                  <DataTable
                    caption={t('picking.allocated')}
                    columns={itemColumns(current)}
                    rows={current.items}
                    rowKey={(item) => item._id}
                    rowTest={(item) =>
                      current.batchNumbers?.[item.batchId]?.batchNumber ?? item.medicineId.brandName
                    }
                  />
                </Card>

                {current.status === 'PACKING' && isStorekeeper && (
                  <Card className="mb-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={t('picking.packageCount')} required>
                        <Input
                          type="number"
                          min={1}
                          value={packageCount}
                          onChange={(event) => setPackageCount(Number(event.target.value))}
                        />
                      </Field>
                      <Field label={t('picking.weight')} hint={t('picking.weightHint')}>
                        <Input
                          type="number"
                          min={0}
                          value={weight}
                          onChange={(event) => setWeight(Number(event.target.value))}
                        />
                      </Field>
                    </div>
                    <Field label={t('picking.packingNotes')} className="mt-3">
                      <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                    </Field>
                    <div className="mt-3 flex justify-end">
                      <Button variant="primary" onClick={() => void pack()}>
                        {t('picking.confirmPacking')}
                      </Button>
                    </div>
                  </Card>
                )}

                {isStorekeeper && ['PICKING', 'PAUSED', 'PACKING'].includes(current.status) && (
                  <Card className="mb-4">
                    <h2 className="mb-2 text-lg font-semibold text-text">
                      {t('picking.reportTitle')}
                    </h2>
                    <Field label={t('picking.reportLine')} className="mb-3">
                      <Select
                        value={discrepancyLine || (current.items[0]?._id ?? '')}
                        onChange={(event) => setDiscrepancyLine(event.target.value)}
                      >
                        {current.items.map((item) => (
                          <option key={item._id} value={item._id}>
                            {item.medicineId.brandName} ·{' '}
                            {current.batchNumbers?.[item.batchId]?.batchNumber ?? '—'}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={t('picking.reportType')}>
                        <Select
                          value={discrepancyType}
                          onChange={(event) => setDiscrepancyType(event.target.value)}
                        >
                          {DISCREPANCY_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {t(`discrepancyType.${type}`)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t('picking.affectedQuantity')}>
                        <Input
                          type="number"
                          min={0}
                          value={discrepancyQuantity}
                          onChange={(event) => setDiscrepancyQuantity(Number(event.target.value))}
                        />
                      </Field>
                    </div>
                    <Field label={t('fields.notes')} className="mt-3">
                      <Textarea
                        value={discrepancyNotes}
                        onChange={(event) => setDiscrepancyNotes(event.target.value)}
                      />
                    </Field>
                    <div className="mt-3 flex justify-end">
                      <Button onClick={() => void reportDiscrepancy()}>
                        {t('picking.report')}
                      </Button>
                    </div>
                  </Card>
                )}

                {isStorekeeper && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {current.status === 'PENDING' && (
                      <Button
                        variant="primary"
                        onClick={() =>
                          void post('start', {}, t('picking.started'), t('picking.startFailed'))
                        }
                      >
                        {t('picking.startPicking')}
                      </Button>
                    )}
                    {current.status === 'PICKING' && (
                      <>
                        <Button onClick={() => void saveProgress('SAVE')}>
                          {t('picking.saveProgress')}
                        </Button>
                        <Button onClick={() => void saveProgress('PAUSE')}>
                          {t('picking.pause')}
                        </Button>
                        <Button variant="primary" onClick={() => void saveProgress('COMPLETE')}>
                          {t('picking.completePicking')}
                        </Button>
                      </>
                    )}
                    {current.status === 'PAUSED' && (
                      <Button
                        variant="primary"
                        onClick={() =>
                          void post('resume', {}, t('picking.resumed'), t('picking.updateFailed'))
                        }
                      >
                        {t('picking.resumePicking')}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Resource>
    </>
  );
}
