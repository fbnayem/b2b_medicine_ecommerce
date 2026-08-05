import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  SalesDimension,
  type DeliveryPerformanceReport,
  type InventoryAnalyticsReport,
  type ReceivablesAgeingReport,
  type ReturnsAnalyticsReport,
  type SalesSummaryReport,
} from '@medsupply/shared-types';
import { formatQuantity } from '@medsupply/utilities';
import { BarChart, LineChart, ShareBars } from '../components/Chart';
import { RangeControls } from '../components/RangeControls';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  LinkButton,
  PageHeader,
  Resource,
  Select,
  toast,
  type Column,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate, formatMinor } from '../lib/finance';
import { downloadCsv, useReportRange } from './reportRange';

type ReportKind = 'sales' | 'inventory' | 'deliveries' | 'returns' | 'ageing';

const TABS: Array<{ kind: ReportKind; path: string; key: string }> = [
  { kind: 'sales', path: '/analytics/sales', key: 'reports.tabSales' },
  { kind: 'inventory', path: '/analytics/inventory', key: 'reports.tabInventory' },
  { kind: 'deliveries', path: '/analytics/deliveries', key: 'reports.tabDeliveries' },
  { kind: 'returns', path: '/analytics/returns', key: 'reports.tabReturns' },
  { kind: 'ageing', path: '/analytics/receivables', key: 'reports.tabAgeing' },
];

const ENDPOINTS: Record<ReportKind, string> = {
  sales: '/reports/sales',
  inventory: '/reports/inventory',
  deliveries: '/reports/deliveries',
  returns: '/reports/returns',
  ageing: '/reports/receivables-ageing',
};

const ROUTE_IDS: Record<ReportKind, string> = {
  sales: 'analytics-sales',
  inventory: 'analytics-inventory',
  deliveries: 'analytics-deliveries',
  returns: 'analytics-returns',
  ageing: 'analytics-receivables',
};

const percent = (basisPoints: number) => `${(basisPoints / 100).toFixed(1)}%`;

interface BreakdownRow {
  key: string;
  label: string;
  secondaryLabel?: string;
  invoiceCount: number;
  quantity: number;
  netMinor: number;
  returnedMinor: number;
  sharePercentBasisPoints: number;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card>
      <p className="text-sm text-text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-text">{value}</p>
    </Card>
  );
}

function Metrics({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{children}</div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="mb-4">
      <h2 className="mb-2 text-lg font-semibold text-text">{title}</h2>
      {children}
    </Card>
  );
}

function AnalyticsReportPage({ kind }: { kind: ReportKind }) {
  const { t } = useLanguage();
  const range = useReportRange();
  const [dimension, setDimension] = useState<SalesDimension>(SalesDimension.MEDICINE);
  const [exporting, setExporting] = useState(false);

  // Stock and ageing are a snapshot of right now, not a period.
  const usesRange = kind !== 'inventory' && kind !== 'ageing';
  const search = usesRange
    ? new URLSearchParams(range.applied as unknown as Record<string, string>).toString()
    : '';

  const report = useApiResource<unknown>(
    ['analytics-report', kind, search],
    `${ENDPOINTS[kind]}${search ? `?${search}` : ''}`,
  );

  const breakdown = useApiResource<{ data: BreakdownRow[] }>(
    ['analytics-breakdown', search, dimension],
    `/reports/sales/breakdown?${search}&dimension=${dimension}&limit=20`,
    { enabled: kind === 'sales' },
  );

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadCsv(ENDPOINTS[kind], usesRange ? range.applied : {}, `${kind}-report.csv`);
    } catch {
      toast.error(t('reports.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  const ageingLabel = (bucket: string) =>
    ({
      CURRENT: t('analytics.notYetDue'),
      DAYS_1_30: t('analytics.days1to30'),
      DAYS_31_60: t('analytics.days31to60'),
      DAYS_61_90: t('analytics.days61to90'),
      DAYS_90_PLUS: t('analytics.over90'),
    })[bucket] ?? bucket;

  return (
    <>
      <PageHeader
        routeId={ROUTE_IDS[kind]}
        title={t(`reports.${kind}Title`)}
        description={t(`reports.${kind}Subtitle`)}
        actions={<LinkButton to="/analytics">{t('reports.overview')}</LinkButton>}
      />

      {/* Links, not buttons: each report is its own route and has to be shareable. */}
      <nav aria-label={t('nav.sections')} className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.kind}
            to={tab.path}
            aria-current={tab.kind === kind ? 'page' : undefined}
            className={
              tab.kind === kind
                ? 'min-h-11 rounded-full border border-brand bg-brand-subtle px-4 py-2 text-sm font-medium text-brand'
                : 'min-h-11 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-hover'
            }
          >
            {t(tab.key)}
          </Link>
        ))}
      </nav>

      {usesRange ? (
        <RangeControls range={range} onExport={() => void exportCsv()} exporting={exporting} />
      ) : (
        <div className="mb-4">
          <Button busy={exporting} onClick={() => void exportCsv()}>
            {exporting ? t('reports.preparingCsv') : t('finance.exportCsv')}
          </Button>
        </div>
      )}

      <Resource
        query={report}
        loadingLabel={t('reports.loading')}
        errorMessageFallback={t('reports.couldNotLoad')}
        isEmpty={(data) => !data}
        empty={<EmptyState title={t('reports.none')} description={t('reports.noneBody')} />}
      >
        {(data) =>
          kind === 'sales' ? (
            <SalesReportBody
              report={data as SalesSummaryReport}
              breakdown={breakdown.data?.data ?? []}
              dimension={dimension}
              onDimension={setDimension}
            />
          ) : kind === 'inventory' ? (
            <InventoryReportBody report={data as InventoryAnalyticsReport} />
          ) : kind === 'deliveries' ? (
            <DeliveryReportBody report={data as DeliveryPerformanceReport} />
          ) : kind === 'returns' ? (
            <ReturnsReportBody report={data as ReturnsAnalyticsReport} />
          ) : (
            <AgeingReportBody report={data as ReceivablesAgeingReport} label={ageingLabel} />
          )
        }
      </Resource>
    </>
  );
}

function SalesReportBody({
  report,
  breakdown,
  dimension,
  onDimension,
}: {
  report: SalesSummaryReport;
  breakdown: BreakdownRow[];
  dimension: SalesDimension;
  onDimension: (value: SalesDimension) => void;
}) {
  const { t } = useLanguage();

  const columns: ReadonlyArray<Column<BreakdownRow>> = [
    {
      key: 'name',
      header: t('reports.name'),
      cell: (row) => (
        <div>
          <p className="text-text">{row.label}</p>
          {row.secondaryLabel && <p className="text-sm text-text-muted">{row.secondaryLabel}</p>}
        </div>
      ),
    },
    {
      key: 'invoices',
      header: t('analytics.invoices'),
      numeric: true,
      cell: (row) => row.invoiceCount,
    },
    { key: 'units', header: t('reports.units'), numeric: true, cell: (row) => row.quantity },
    {
      key: 'net',
      header: t('reports.net'),
      numeric: true,
      cell: (row) => <strong>{formatMinor(row.netMinor)}</strong>,
    },
    {
      key: 'returned',
      header: t('reports.returned'),
      numeric: true,
      cell: (row) => formatMinor(row.returnedMinor),
    },
    {
      key: 'share',
      header: t('reports.share'),
      numeric: true,
      cell: (row) => percent(row.sharePercentBasisPoints),
    },
  ];

  return (
    <>
      <Metrics>
        <Metric label={t('analytics.invoices')} value={report.totals.invoiceCount} />
        <Metric label={t('reports.unitsSold')} value={formatQuantity(report.totals.unitsSold)} />
        <Metric label={t('reports.gross')} value={formatMinor(report.totals.grossMinor)} />
        <Metric label={t('reports.discounts')} value={formatMinor(report.totals.discountMinor)} />
        <Metric label={t('reports.tax')} value={formatMinor(report.totals.taxMinor)} />
        <Metric
          label={t('reports.netAfterReturns')}
          value={formatMinor(report.totals.netAfterReturnsMinor)}
        />
      </Metrics>

      <Panel title={t('reports.trend')}>
        <LineChart
          title={t('reports.trendTitle')}
          money
          labels={report.series.map((point) => point.bucket)}
          series={[
            {
              key: 'net',
              label: t('analytics.netSales'),
              values: report.series.map((point) => point.netMinor),
            },
            {
              key: 'returned',
              label: t('analytics.creditedReturns'),
              values: report.series.map((point) => point.returnedMinor),
            },
          ]}
          emptyMessage={t('analytics.noInvoices')}
        />
      </Panel>

      <Panel title={t('reports.breakdown')}>
        <Field label={t('reports.groupBy')} className="mb-3 max-w-56">
          <Select
            value={dimension}
            onChange={(event) => onDimension(event.target.value as SalesDimension)}
          >
            <option value={SalesDimension.MEDICINE}>{t('reports.dimensionMedicine')}</option>
            <option value={SalesDimension.CATEGORY}>{t('reports.dimensionCategory')}</option>
            <option value={SalesDimension.MANUFACTURER}>
              {t('reports.dimensionManufacturer')}
            </option>
            <option value={SalesDimension.SHOP}>{t('reports.dimensionShop')}</option>
            <option value={SalesDimension.TERRITORY}>{t('reports.dimensionTerritory')}</option>
          </Select>
        </Field>
        {breakdown.length === 0 ? (
          <EmptyState title={t('reports.nothingSold')} />
        ) : (
          <DataTable
            caption={t('reports.breakdown')}
            columns={columns}
            rows={breakdown}
            rowKey={(row) => row.key}
          />
        )}
      </Panel>
    </>
  );
}

function InventoryReportBody({ report }: { report: InventoryAnalyticsReport }) {
  const { t } = useLanguage();

  const expiryLabel = (bucket: string) =>
    ({
      EXPIRED: t('reports.alreadyExpired'),
      WITHIN_30_DAYS: t('reports.within30'),
      WITHIN_90_DAYS: t('reports.within90'),
      BEYOND_90_DAYS: t('reports.beyond90'),
    })[bucket] ?? bucket;

  const columns: ReadonlyArray<Column<InventoryAnalyticsReport['byCategory'][number]>> = [
    { key: 'category', header: t('catalogue.category'), cell: (row) => row.label },
    { key: 'batches', header: t('reports.batches'), numeric: true, cell: (row) => row.batchCount },
    { key: 'on-hand', header: t('reports.onHand'), numeric: true, cell: (row) => row.onHand },
    {
      key: 'available',
      header: t('reports.availableUnits'),
      numeric: true,
      cell: (row) => row.available,
    },
    {
      key: 'cost',
      header: t('reports.costValue'),
      numeric: true,
      cell: (row) => <strong>{formatMinor(row.costValueMinor)}</strong>,
    },
    {
      key: 'retail',
      header: t('reports.retailValue'),
      numeric: true,
      cell: (row) => formatMinor(row.retailValueMinor),
    },
  ];

  return (
    <>
      <Metrics>
        <Metric label={t('reports.batches')} value={report.totals.batchCount} />
        <Metric label={t('reports.onHand')} value={formatQuantity(report.totals.onHand)} />
        <Metric
          label={t('reports.availableUnits')}
          value={formatQuantity(report.totals.available)}
        />
        <Metric label={t('reports.costValue')} value={formatMinor(report.totals.costValueMinor)} />
        <Metric
          label={t('reports.retailValue')}
          value={formatMinor(report.totals.retailValueMinor)}
        />
        <Metric label={t('reports.blockedBatches')} value={report.totals.blockedBatchCount} />
      </Metrics>

      <Panel title={t('reports.expiryExposure')}>
        <ShareBars
          title={t('reports.expiryChartTitle')}
          money
          slices={report.expiryBuckets.map((bucket) => ({
            key: bucket.bucket,
            label: expiryLabel(bucket.bucket),
            value: bucket.costValueMinor,
          }))}
          emptyMessage={t('reports.noStock')}
        />
      </Panel>

      <Panel title={t('reports.valuationByCategory')}>
        {report.byCategory.length === 0 ? (
          <EmptyState title={t('reports.noStockYet')} />
        ) : (
          <DataTable
            caption={t('reports.valuationByCategory')}
            columns={columns}
            rows={report.byCategory}
            rowKey={(row) => row.key}
          />
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-text">{t('reports.lowStock')}</h2>
          {report.lowStock.length === 0 ? (
            <p className="text-text-muted">{t('reports.noLowStock')}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {report.lowStock.map((row) => (
                <li key={row.medicineId} className="border-b border-border py-2 last:border-b-0">
                  <p className="font-medium text-text">{row.brandName}</p>
                  <p className="text-sm text-text-muted">
                    {t('reports.lowStockRow', {
                      available: row.available,
                      threshold: row.threshold,
                    })}{' '}
                    · {row.genericName}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-text">{t('reports.deadStock')}</h2>
          {report.deadStock.length === 0 ? (
            <p className="text-text-muted">{t('reports.noDeadStock')}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {report.deadStock.map((row) => (
                <li key={row.batchId} className="border-b border-border py-2 last:border-b-0">
                  <p className="font-medium text-text">{row.brandName}</p>
                  <p className="text-sm text-text-muted">
                    {t('reports.deadStockRow', {
                      batch: row.batchNumber,
                      units: row.available,
                      value: formatMinor(row.costValueMinor),
                    })}{' '}
                    · {t('reports.expiresOn', { date: formatFinanceDate(row.expiryDate) })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function DeliveryReportBody({ report }: { report: DeliveryPerformanceReport }) {
  const { t } = useLanguage();

  const columns: ReadonlyArray<Column<DeliveryPerformanceReport['byPerson'][number]>> = [
    { key: 'person', header: t('reports.person'), cell: (row) => row.name },
    { key: 'assigned', header: t('reports.assigned'), numeric: true, cell: (row) => row.assigned },
    {
      key: 'delivered',
      header: t('reports.delivered'),
      numeric: true,
      cell: (row) => row.delivered,
    },
    { key: 'failed', header: t('reports.failed'), numeric: true, cell: (row) => row.failed },
    { key: 'on-time', header: t('reports.onTime'), numeric: true, cell: (row) => row.onTime },
    {
      key: 'success',
      header: t('reports.successRate'),
      numeric: true,
      cell: (row) => percent(row.successBasisPoints),
    },
    {
      key: 'collected',
      header: t('reports.collected'),
      numeric: true,
      cell: (row) => <strong>{formatMinor(row.collectedMinor)}</strong>,
    },
  ];

  return (
    <>
      <Metrics>
        <Metric label={t('reports.deliveries')} value={report.totals.total} />
        <Metric label={t('reports.delivered')} value={report.totals.delivered} />
        <Metric label={t('reports.failed')} value={report.totals.failed} />
        <Metric
          label={t('reports.successRate')}
          value={percent(report.totals.successBasisPoints)}
        />
        <Metric label={t('reports.onTime')} value={percent(report.totals.onTimeBasisPoints)} />
        <Metric
          label={t('reports.averageCycle')}
          value={
            report.totals.averageCycleHours === null
              ? t('analytics.notKnown')
              : t('analytics.hours', { hours: report.totals.averageCycleHours })
          }
        />
      </Metrics>

      <Panel title={t('reports.completedAgainstFailed')}>
        <BarChart
          title={t('reports.deliveryChartTitle')}
          labels={report.series.map((point) => point.bucket)}
          series={[
            {
              key: 'delivered',
              label: t('reports.delivered'),
              values: report.series.map((point) => point.delivered),
            },
            {
              key: 'failed',
              label: t('reports.failed'),
              values: report.series.map((point) => point.failed),
              colour: '#dc2626',
            },
          ]}
          emptyMessage={t('reports.noDeliveries')}
        />
      </Panel>

      <Panel title={t('reports.failureReasons')}>
        <ShareBars
          title={t('reports.failureChartTitle')}
          slices={report.failureReasons.map((row) => ({
            key: row.reason,
            label: t(`deliveryFailureReason.${row.reason}`),
            value: row.count,
          }))}
          emptyMessage={t('reports.noFailures')}
        />
      </Panel>

      <Panel title={t('reports.byPerson')}>
        {report.byPerson.length === 0 ? (
          <EmptyState title={t('reports.noAssignments')} />
        ) : (
          <DataTable
            caption={t('reports.byPerson')}
            columns={columns}
            rows={report.byPerson}
            rowKey={(row) => row.userId}
          />
        )}
      </Panel>
    </>
  );
}

function ReturnsReportBody({ report }: { report: ReturnsAnalyticsReport }) {
  const { t } = useLanguage();

  const columns: ReadonlyArray<Column<ReturnsAnalyticsReport['byMedicine'][number]>> = [
    {
      key: 'medicine',
      header: t('fields.medicine'),
      cell: (row) => (
        <div>
          <p className="text-text">{row.brandName}</p>
          <p className="text-sm text-text-muted">{row.genericName}</p>
        </div>
      ),
    },
    { key: 'units', header: t('reports.units'), numeric: true, cell: (row) => row.quantity },
    {
      key: 'credited',
      header: t('reports.credited'),
      numeric: true,
      cell: (row) => <strong>{formatMinor(row.creditedMinor)}</strong>,
    },
  ];

  return (
    <>
      <Metrics>
        <Metric label={t('reports.returns')} value={report.totals.returnCount} />
        <Metric label={t('reports.openReturns')} value={report.totals.pendingCount} />
        <Metric label={t('reports.credited')} value={formatMinor(report.totals.creditedMinor)} />
        <Metric
          label={t('reports.awaitingCredit')}
          value={formatMinor(report.totals.pendingCreditMinor)}
        />
        <Metric
          label={t('reports.returnRate')}
          value={percent(report.totals.returnRateBasisPoints)}
        />
        <Metric
          label={t('reports.unitsRestocked')}
          value={t('reports.restockedOf', {
            restocked: report.totals.unitsRestocked,
            returned: report.totals.unitsReturned,
          })}
        />
      </Metrics>

      <Panel title={t('reports.returnsOverTime')}>
        <LineChart
          title={t('reports.returnsChartTitle')}
          labels={report.series.map((point) => point.bucket)}
          series={[
            {
              key: 'count',
              label: t('reports.requests'),
              values: report.series.map((point) => point.returnCount),
            },
          ]}
          emptyMessage={t('reports.noReturns')}
        />
      </Panel>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-text">{t('reports.byReason')}</h2>
          <ShareBars
            title={t('reports.reasonChartTitle')}
            slices={report.byReason.map((row) => ({
              key: row.reason,
              label: t(`returnReason.${row.reason}`),
              value: row.quantity,
            }))}
            emptyMessage={t('reports.noReturnsShort')}
          />
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-text">{t('reports.byStatus')}</h2>
          <ShareBars
            title={t('reports.statusChartTitle')}
            slices={report.byStatus.map((row) => ({
              key: row.status,
              label: t(`returnStatus.${row.status}`),
              value: row.count,
            }))}
            emptyMessage={t('reports.noReturnsShort')}
          />
        </Card>
      </div>

      <Panel title={t('reports.mostReturned')}>
        {report.byMedicine.length === 0 ? (
          <EmptyState title={t('reports.noMedicinesReturned')} />
        ) : (
          <DataTable
            caption={t('reports.mostReturned')}
            columns={columns}
            rows={report.byMedicine}
            rowKey={(row) => row.medicineId}
          />
        )}
      </Panel>
    </>
  );
}

function AgeingReportBody({
  report,
  label,
}: {
  report: ReceivablesAgeingReport;
  label: (bucket: string) => string;
}) {
  const { t } = useLanguage();

  const columns: ReadonlyArray<Column<ReceivablesAgeingReport['rows'][number]>> = [
    {
      key: 'customer',
      header: t('fields.customer'),
      cell: (row) => (
        <div>
          <Link className="font-medium text-brand underline" to={`/shops/${row.shopId}/ledger`}>
            {row.shopName}
          </Link>
          <p className="text-sm text-text-muted">{row.shopReference}</p>
        </div>
      ),
    },
    {
      key: 'current',
      header: t('reports.notDue'),
      numeric: true,
      cell: (row) => formatMinor(row.currentMinor),
    },
    {
      key: 'b1',
      header: t('reports.bucket1to30'),
      numeric: true,
      cell: (row) => formatMinor(row.days1to30Minor),
    },
    {
      key: 'b2',
      header: t('reports.bucket31to60'),
      numeric: true,
      cell: (row) => formatMinor(row.days31to60Minor),
    },
    {
      key: 'b3',
      header: t('reports.bucket61to90'),
      numeric: true,
      cell: (row) => formatMinor(row.days61to90Minor),
    },
    {
      key: 'b4',
      header: t('reports.bucket90Plus'),
      numeric: true,
      cell: (row) => formatMinor(row.days90PlusMinor),
    },
    {
      key: 'total',
      header: t('fields.total'),
      numeric: true,
      cell: (row) => <strong>{formatMinor(row.totalMinor)}</strong>,
    },
  ];

  return (
    <>
      <Metrics>
        <Metric label={t('reports.totalOutstanding')} value={formatMinor(report.totalMinor)} />
        {report.buckets.map((bucket) => (
          <Metric
            key={bucket.bucket}
            label={label(bucket.bucket)}
            value={formatMinor(bucket.amountMinor)}
          />
        ))}
      </Metrics>

      <Panel title={t('reports.byCustomer')}>
        {report.rows.length === 0 ? (
          <EmptyState title={t('reports.nothingOutstanding')} />
        ) : (
          <DataTable
            caption={t('reports.byCustomer')}
            columns={columns}
            rows={report.rows}
            rowKey={(row) => row.shopId}
            rowTest={(row) => row.shopReference}
          />
        )}
      </Panel>
    </>
  );
}

export function SalesAnalytics() {
  return <AnalyticsReportPage kind="sales" />;
}
export function InventoryAnalytics() {
  return <AnalyticsReportPage kind="inventory" />;
}
export function DeliveryAnalytics() {
  return <AnalyticsReportPage kind="deliveries" />;
}
export function ReturnsAnalytics() {
  return <AnalyticsReportPage kind="returns" />;
}
export function ReceivablesAnalytics() {
  return <AnalyticsReportPage kind="ageing" />;
}
