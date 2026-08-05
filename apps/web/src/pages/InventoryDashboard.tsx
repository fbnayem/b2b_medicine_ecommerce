import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { StockMovementType } from '@medsupply/shared-types';
import type { Medicine, MedicineBatch } from '@medsupply/shared-types';
import { parseMoney } from '@medsupply/utilities';
import { apiClient, errorMessage } from '../api/client';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  FilterTabs,
  Input,
  PageHeader,
  Resource,
  Select,
  Textarea,
  requireReason,
  toast,
  useAsk,
  type Column,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { createActionKey, formatFinanceDate, formatFinanceDateTime } from '../lib/finance';

interface Movement {
  _id: string;
  type: StockMovementType;
  quantity: number;
  reason: string;
  createdAt: string;
  medicineId?: { brandName: string; sku: string };
  batchId?: { batchNumber: string };
}

/** The changes a storekeeper may record by hand, in the order they occur. */
const MANUAL_MOVEMENTS: StockMovementType[] = [
  StockMovementType.DAMAGE,
  StockMovementType.EXPIRY,
  StockMovementType.QUARANTINE,
  StockMovementType.QUARANTINE_RELEASE,
  StockMovementType.RESERVATION,
  StockMovementType.RESERVATION_RELEASE,
  StockMovementType.PICKING,
  StockMovementType.PICKING_RETURN,
  StockMovementType.PACKING,
  StockMovementType.PACKING_REVERSAL,
];

const WARNINGS = ['', 'low-stock', 'near-expiry', 'expired'];
const WARNING_KEYS: Record<string, string> = {
  '': 'allBatches',
  'low-stock': 'lowStock',
  'near-expiry': 'nearExpiry',
  expired: 'expired',
};

const EMPTY_RECEIPT = {
  medicineId: '',
  batchNumber: '',
  manufacturingDate: '',
  expiryDate: '',
  costPrice: '',
  sellingPrice: '',
  quantity: '',
  warehouseLocation: '',
  notes: '',
};

export function InventoryDashboard() {
  const ask = useAsk();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [warning, setWarning] = useState('');
  const [receipt, setReceipt] = useState(EMPTY_RECEIPT);
  const [receiving, setReceiving] = useState(false);

  const medicines = useApiCollection<Medicine>(
    keys.medicines.picker(),
    '/inventory/medicines?limit=100',
  );
  const batches = useApiCollection<MedicineBatch>(
    keys.stock.batches(warning),
    `/inventory/batches${warning ? `?warning=${warning}` : ''}`,
  );
  const movements = useApiCollection<Movement>(
    keys.stock.movements('recent'),
    '/inventory/movements?limit=50',
  );

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.stock.all }),
      queryClient.invalidateQueries({ queryKey: keys.medicines.all }),
    ]);
  }

  /**
   * Two questions, both required: how many, and why.
   *
   * The reason is not ceremony. A stock movement is an append-only record that
   * an inspector may read years later, and "someone reduced this batch by six"
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

  async function receive(event: React.FormEvent) {
    event.preventDefault();
    const cost = parseMoney(receipt.costPrice);
    const selling = receipt.sellingPrice ? parseMoney(receipt.sellingPrice) : undefined;
    // Integer minor units from the shared parser. The old code did
    // `Math.round(Number(input) * 100)`, which is float arithmetic on money.
    if (!cost.ok || (selling && !selling.ok)) {
      toast.error(t('inventory.badAmount'));
      return;
    }
    setReceiving(true);
    try {
      await apiClient.post('/inventory/batches/receive', {
        ...receipt,
        costPriceMinor: cost.minor,
        sellingPriceOverrideMinor: selling?.ok ? selling.minor : undefined,
        quantity: Number(receipt.quantity),
      });
      setReceipt(EMPTY_RECEIPT);
      await refresh();
      toast.success(t('inventory.received'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('inventory.receiveFailed')));
    } finally {
      setReceiving(false);
    }
  }

  const rows = batches.data?.items ?? [];
  const totals = rows.reduce(
    (sum, batch) => ({
      onHand: sum.onHand + batch.quantities.onHand,
      available: sum.available + batch.quantities.available,
      reserved: sum.reserved + batch.quantities.reserved,
      damaged: sum.damaged + batch.quantities.damaged,
    }),
    { onHand: 0, available: 0, reserved: 0, damaged: 0 },
  );

  const batchColumns: ReadonlyArray<Column<MedicineBatch>> = [
    {
      key: 'batch',
      header: t('inventory.columnBatch'),
      cell: (batch) => (
        <div>
          <p className="font-medium text-text">{(batch.medicineId as Medicine).brandName}</p>
          <p className="text-sm text-text-muted">
            {batch.batchNumber} · {batch.warehouseLocation}
          </p>
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
      header: t('inventory.available'),
      numeric: true,
      cell: (batch) => batch.quantities.available,
    },
    {
      key: 'reserved',
      header: t('inventory.reserved'),
      numeric: true,
      cell: (batch) => batch.quantities.reserved,
    },
    {
      key: 'picking',
      header: t('inventory.columnPicking'),
      numeric: true,
      cell: (batch) => batch.quantities.picking,
    },
    {
      key: 'packed',
      header: t('inventory.columnPacked'),
      numeric: true,
      cell: (batch) => batch.quantities.packed,
    },
    {
      key: 'warnings',
      header: t('inventory.columnWarnings'),
      cell: (batch) => (
        <span className="flex flex-wrap gap-1">
          {batch.isBlocked && <Badge tone="danger">{t('inventory.blocked')}</Badge>}
          {batch.isQuarantined && <Badge tone="warning">{t('inventory.quarantined')}</Badge>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('inventory.columnActions'),
      cell: (batch) => (
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
      ),
    },
  ];

  const totalCards: Array<[string, number]> = [
    [t('inventory.onHand'), totals.onHand],
    [t('inventory.available'), totals.available],
    [t('inventory.reserved'), totals.reserved],
    [t('inventory.damaged'), totals.damaged],
  ];

  return (
    <>
      <PageHeader
        routeId="inventory"
        title={t('inventory.title')}
        description={t('inventory.subtitle')}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {totalCards.map(([label, value]) => (
          <Card key={label}>
            <p className="text-sm text-text-muted">{label}</p>
            <p className="text-xl font-semibold tabular-nums text-text">{value}</p>
          </Card>
        ))}
      </div>

      <div className="mb-4">
        <FilterTabs
          label={t('inventory.filterLabel')}
          options={WARNINGS.map((value) => ({
            value,
            label: t(`inventory.${WARNING_KEYS[value]}`),
          }))}
          value={warning}
          onChange={setWarning}
        />
      </div>

      <Card className="mb-4">
        <h2 className="mb-2 text-lg font-semibold text-text">{t('inventory.batchStock')}</h2>
        <Resource
          query={batches}
          loadingLabel={t('inventory.loading')}
          errorMessageFallback={t('inventory.couldNotLoad')}
          empty={<EmptyState title={t('inventory.noBatches')} />}
        >
          {(page) => (
            <DataTable
              caption={t('inventory.batchStock')}
              columns={batchColumns}
              rows={page.items}
              rowKey={(batch) => batch._id}
              rowTest={(batch) => batch.batchNumber}
            />
          )}
        </Resource>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-text">{t('inventory.receiveStock')}</h2>
          <form className="flex flex-col gap-3" onSubmit={(event) => void receive(event)}>
            <Field label={t('inventory.medicine')} required>
              <Select
                required
                value={receipt.medicineId}
                onChange={(event) =>
                  setReceipt((current) => ({ ...current, medicineId: event.target.value }))
                }
              >
                <option value="">{t('inventory.selectMedicine')}</option>
                {(medicines.data?.items ?? []).map((medicine) => (
                  <option key={medicine._id} value={medicine._id}>
                    {medicine.brandName} · {medicine.sku}
                  </option>
                ))}
              </Select>
            </Field>

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
                  hint={name === 'sellingPrice' ? t('inventory.sellingOverrideHint') : undefined}
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

            <div className="flex justify-end">
              <Button type="submit" variant="primary" busy={receiving}>
                {t('inventory.receiveStock')}
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="mb-2 text-lg font-semibold text-text">{t('inventory.movements')}</h2>
          <Resource
            query={movements}
            loadingLabel={t('inventory.movements')}
            errorMessageFallback={t('inventory.couldNotLoad')}
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
                      <p className="font-medium text-text">{t(`movementType.${movement.type}`)}</p>
                      <p className="text-sm text-text-muted">
                        {movement.medicineId?.brandName} · {movement.batchId?.batchNumber}
                      </p>
                      {movement.reason && (
                        <p className="text-sm text-text-muted">{movement.reason}</p>
                      )}
                    </div>
                    <div className="text-end">
                      <strong className="tabular-nums text-text">{movement.quantity}</strong>
                      <p className="text-sm text-text-muted">
                        {formatFinanceDateTime(movement.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Resource>
        </Card>
      </div>
    </>
  );
}
