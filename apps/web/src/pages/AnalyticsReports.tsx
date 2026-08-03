import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  SalesDimension,
  type DeliveryPerformanceReport,
  type InventoryAnalyticsReport,
  type ReceivablesAgeingReport,
  type ReturnsAnalyticsReport,
  type SalesSummaryReport,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { BarChart, LineChart, ShareBars } from '../components/Chart';
import { formatFinanceDate, formatMinor } from '../lib/finance';
import { downloadCsv, useReportRange } from './reportRange';
import { RangeControls } from '../components/RangeControls';
import './inventory.css';
import { formatQuantity } from '@medsupply/utilities';

type ReportKind = 'sales' | 'inventory' | 'deliveries' | 'returns' | 'ageing';

const TABS: Array<{ kind: ReportKind; path: string; label: string }> = [
  { kind: 'sales', path: '/analytics/sales', label: 'Sales' },
  { kind: 'inventory', path: '/analytics/inventory', label: 'Inventory' },
  { kind: 'deliveries', path: '/analytics/deliveries', label: 'Delivery' },
  { kind: 'returns', path: '/analytics/returns', label: 'Returns' },
  { kind: 'ageing', path: '/analytics/receivables', label: 'Receivables' },
];

const ENDPOINTS: Record<ReportKind, string> = {
  sales: '/reports/sales',
  inventory: '/reports/inventory',
  deliveries: '/reports/deliveries',
  returns: '/reports/returns',
  ageing: '/reports/receivables-ageing',
};

const COPY: Record<ReportKind, { title: string; description: string }> = {
  sales: {
    title: 'Sales report',
    description: 'Invoiced value, discounts, tax and returned value over time.',
  },
  inventory: {
    title: 'Inventory report',
    description: 'Stock valuation, expiry exposure, low stock and dead stock.',
  },
  deliveries: {
    title: 'Delivery report',
    description: 'Success, punctuality and failure reasons by delivery person.',
  },
  returns: {
    title: 'Returns report',
    description: 'Return rate, reasons, value credited and units recovered.',
  },
  ageing: {
    title: 'Receivables ageing',
    description: 'Outstanding customer balances bucketed by days past due.',
  },
};

const DIMENSION_LABELS: Array<{ value: SalesDimension; label: string }> = [
  { value: SalesDimension.MEDICINE, label: 'Medicine' },
  { value: SalesDimension.CATEGORY, label: 'Category' },
  { value: SalesDimension.MANUFACTURER, label: 'Manufacturer' },
  { value: SalesDimension.SHOP, label: 'Customer' },
  { value: SalesDimension.TERRITORY, label: 'Territory' },
];

const AGEING_LABELS: Record<string, string> = {
  CURRENT: 'Not yet due',
  DAYS_1_30: '1–30 days',
  DAYS_31_60: '31–60 days',
  DAYS_61_90: '61–90 days',
  DAYS_90_PLUS: 'Over 90 days',
};

const EXPIRY_LABELS: Record<string, string> = {
  EXPIRED: 'Already expired',
  WITHIN_30_DAYS: 'Expiring within 30 days',
  WITHIN_90_DAYS: 'Expiring within 90 days',
  BEYOND_90_DAYS: 'More than 90 days left',
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

function AnalyticsReportPage({ kind }: { kind: ReportKind }) {
  const range = useReportRange();
  const [report, setReport] = useState<unknown>(null);
  const [dimension, setDimension] = useState<SalesDimension>(SalesDimension.MEDICINE);
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const usesRange = kind !== 'inventory' && kind !== 'ageing';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = usesRange ? range.applied : {};
      const response = await apiClient.get(ENDPOINTS[kind], { params });
      setReport(response.data.data);
      if (kind === 'sales') {
        const detail = await apiClient.get('/reports/sales/breakdown', {
          params: { ...range.applied, dimension, limit: 20 },
        });
        setBreakdown(detail.data.data.data as BreakdownRow[]);
      }
      setError('');
    } catch (caught) {
      const failure = caught as { response?: { status?: number } };
      setError(
        failure.response?.status === 403
          ? 'Your role cannot view this report.'
          : `Unable to load the ${COPY[kind].title.toLowerCase()}.`,
      );
    } finally {
      setLoading(false);
    }
  }, [kind, range.applied, dimension, usesRange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadCsv(ENDPOINTS[kind], usesRange ? range.applied : {}, `${kind}-report.csv`);
      setError('');
    } catch {
      setError('The CSV export could not be prepared.');
    } finally {
      setExporting(false);
    }
  }

  const copy = COPY[kind];
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Analytics</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <Link className="secondary-button" to="/analytics">
          Overview
        </Link>
      </header>

      <nav className="filter-tabs" aria-label="Analytics report">
        {TABS.map((tab) => (
          <Link key={tab.kind} className={tab.kind === kind ? 'selected' : ''} to={tab.path}>
            {tab.label}
          </Link>
        ))}
      </nav>

      {usesRange ? (
        <RangeControls range={range} onExport={() => void exportCsv()} exporting={exporting} />
      ) : (
        <section className="panel actions">
          <button className="link-button" disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? 'Preparing CSV...' : 'Export CSV'}
          </button>
        </section>
      )}

      {error ? (
        <section className="state error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}

      {loading ? (
        <section className="state">Loading report...</section>
      ) : !report ? (
        <section className="state">No data is available for this report.</section>
      ) : kind === 'sales' ? (
        <SalesReportBody
          report={report as SalesSummaryReport}
          breakdown={breakdown}
          dimension={dimension}
          onDimension={setDimension}
        />
      ) : kind === 'inventory' ? (
        <InventoryReportBody report={report as InventoryAnalyticsReport} />
      ) : kind === 'deliveries' ? (
        <DeliveryReportBody report={report as DeliveryPerformanceReport} />
      ) : kind === 'returns' ? (
        <ReturnsReportBody report={report as ReturnsAnalyticsReport} />
      ) : (
        <AgeingReportBody report={report as ReceivablesAgeingReport} />
      )}
    </main>
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
  return (
    <>
      <section className="metric-grid finance-metrics">
        <article>
          <span>Invoices</span>
          <strong>{report.totals.invoiceCount}</strong>
        </article>
        <article>
          <span>Units sold</span>
          <strong>{formatQuantity(report.totals.unitsSold)}</strong>
        </article>
        <article>
          <span>Gross</span>
          <strong>{formatMinor(report.totals.grossMinor)}</strong>
        </article>
        <article>
          <span>Discounts</span>
          <strong>{formatMinor(report.totals.discountMinor)}</strong>
        </article>
        <article>
          <span>Tax</span>
          <strong>{formatMinor(report.totals.taxMinor)}</strong>
        </article>
        <article>
          <span>Net after returns</span>
          <strong>{formatMinor(report.totals.netAfterReturnsMinor)}</strong>
        </article>
      </section>

      <section className="panel">
        <h2>Trend</h2>
        <LineChart
          title="Net sales and credited returns"
          money
          labels={report.series.map((point) => point.bucket)}
          series={[
            {
              key: 'net',
              label: 'Net sales',
              values: report.series.map((point) => point.netMinor),
            },
            {
              key: 'returned',
              label: 'Credited returns',
              values: report.series.map((point) => point.returnedMinor),
            },
          ]}
          emptyMessage="No invoices were issued in this period."
        />
      </section>

      <section className="panel">
        <header className="panel-heading">
          <h2>Breakdown</h2>
          <label>
            Group by
            <select
              value={dimension}
              onChange={(event) => onDimension(event.target.value as SalesDimension)}
            >
              {DIMENSION_LABELS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </header>
        {breakdown.length === 0 ? (
          <p className="state">Nothing was sold in this period.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Invoices</th>
                  <th>Units</th>
                  <th>Net</th>
                  <th>Returned</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.key}>
                    <td>
                      {row.label}
                      {row.secondaryLabel ? <small>{row.secondaryLabel}</small> : null}
                    </td>
                    <td>{row.invoiceCount}</td>
                    <td>{row.quantity}</td>
                    <td>
                      <strong>{formatMinor(row.netMinor)}</strong>
                    </td>
                    <td>{formatMinor(row.returnedMinor)}</td>
                    <td>{percent(row.sharePercentBasisPoints)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function InventoryReportBody({ report }: { report: InventoryAnalyticsReport }) {
  return (
    <>
      <section className="metric-grid finance-metrics">
        <article>
          <span>Batches</span>
          <strong>{report.totals.batchCount}</strong>
        </article>
        <article>
          <span>On hand</span>
          <strong>{formatQuantity(report.totals.onHand)}</strong>
        </article>
        <article>
          <span>Available</span>
          <strong>{formatQuantity(report.totals.available)}</strong>
        </article>
        <article>
          <span>Value at cost</span>
          <strong>{formatMinor(report.totals.costValueMinor)}</strong>
        </article>
        <article>
          <span>Value at retail</span>
          <strong>{formatMinor(report.totals.retailValueMinor)}</strong>
        </article>
        <article>
          <span>Blocked batches</span>
          <strong>{report.totals.blockedBatchCount}</strong>
        </article>
      </section>

      <section className="panel">
        <h2>Expiry exposure</h2>
        <ShareBars
          title="Stock value by expiry window"
          money
          slices={report.expiryBuckets.map((bucket) => ({
            key: bucket.bucket,
            label: EXPIRY_LABELS[bucket.bucket] ?? bucket.bucket,
            value: bucket.costValueMinor,
          }))}
          emptyMessage="No stock is on hand."
        />
      </section>

      <section className="panel">
        <h2>Valuation by category</h2>
        {report.byCategory.length === 0 ? (
          <p className="state">No stock has been received yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Batches</th>
                  <th>On hand</th>
                  <th>Available</th>
                  <th>Cost value</th>
                  <th>Retail value</th>
                </tr>
              </thead>
              <tbody>
                {report.byCategory.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{row.batchCount}</td>
                    <td>{row.onHand}</td>
                    <td>{row.available}</td>
                    <td>
                      <strong>{formatMinor(row.costValueMinor)}</strong>
                    </td>
                    <td>{formatMinor(row.retailValueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="analytics-columns">
        <section className="panel">
          <h2>Low stock</h2>
          {report.lowStock.length === 0 ? (
            <p className="state">Nothing is at or below the low-stock threshold.</p>
          ) : (
            <ul className="movement-list">
              {report.lowStock.map((row) => (
                <li key={row.medicineId}>
                  <strong>{row.brandName}</strong> — {row.available} available (threshold{' '}
                  {row.threshold})<small>{row.genericName}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Dead stock</h2>
          {report.deadStock.length === 0 ? (
            <p className="state">Every batch has seen recent demand.</p>
          ) : (
            <ul className="movement-list">
              {report.deadStock.map((row) => (
                <li key={row.batchId}>
                  <strong>{row.brandName}</strong> — batch {row.batchNumber}, {row.available} units,{' '}
                  {formatMinor(row.costValueMinor)}
                  <small>Expires {formatFinanceDate(row.expiryDate)}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function DeliveryReportBody({ report }: { report: DeliveryPerformanceReport }) {
  return (
    <>
      <section className="metric-grid finance-metrics">
        <article>
          <span>Deliveries</span>
          <strong>{report.totals.total}</strong>
        </article>
        <article>
          <span>Delivered</span>
          <strong>{report.totals.delivered}</strong>
        </article>
        <article>
          <span>Failed</span>
          <strong>{report.totals.failed}</strong>
        </article>
        <article>
          <span>Success rate</span>
          <strong>{percent(report.totals.successBasisPoints)}</strong>
        </article>
        <article>
          <span>On time</span>
          <strong>{percent(report.totals.onTimeBasisPoints)}</strong>
        </article>
        <article>
          <span>Average cycle</span>
          <strong>
            {report.totals.averageCycleHours === null
              ? '—'
              : `${report.totals.averageCycleHours} h`}
          </strong>
        </article>
      </section>

      <section className="panel">
        <h2>Completed against failed</h2>
        <BarChart
          title="Deliveries completed and failed by period"
          labels={report.series.map((point) => point.bucket)}
          series={[
            {
              key: 'delivered',
              label: 'Delivered',
              values: report.series.map((point) => point.delivered),
            },
            {
              key: 'failed',
              label: 'Failed',
              values: report.series.map((point) => point.failed),
              colour: '#dc2626',
            },
          ]}
          emptyMessage="No deliveries were created in this period."
        />
      </section>

      <section className="panel">
        <h2>Failure reasons</h2>
        <ShareBars
          title="Delivery failures by reason"
          slices={report.failureReasons.map((row) => ({
            key: row.reason,
            label: row.reason.replaceAll('_', ' ').toLowerCase(),
            value: row.count,
          }))}
          emptyMessage="No deliveries failed in this period."
        />
      </section>

      <section className="panel">
        <h2>By delivery person</h2>
        {report.byPerson.length === 0 ? (
          <p className="state">No deliveries were assigned in this period.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Assigned</th>
                  <th>Delivered</th>
                  <th>Failed</th>
                  <th>On time</th>
                  <th>Success</th>
                  <th>Collected</th>
                </tr>
              </thead>
              <tbody>
                {report.byPerson.map((row) => (
                  <tr key={row.userId}>
                    <td>{row.name}</td>
                    <td>{row.assigned}</td>
                    <td>{row.delivered}</td>
                    <td>{row.failed}</td>
                    <td>{row.onTime}</td>
                    <td>{percent(row.successBasisPoints)}</td>
                    <td>
                      <strong>{formatMinor(row.collectedMinor)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ReturnsReportBody({ report }: { report: ReturnsAnalyticsReport }) {
  return (
    <>
      <section className="metric-grid finance-metrics">
        <article>
          <span>Returns</span>
          <strong>{report.totals.returnCount}</strong>
        </article>
        <article>
          <span>Open</span>
          <strong>{report.totals.pendingCount}</strong>
        </article>
        <article>
          <span>Credited</span>
          <strong>{formatMinor(report.totals.creditedMinor)}</strong>
        </article>
        <article>
          <span>Awaiting credit</span>
          <strong>{formatMinor(report.totals.pendingCreditMinor)}</strong>
        </article>
        <article>
          <span>Return rate</span>
          <strong>{percent(report.totals.returnRateBasisPoints)}</strong>
        </article>
        <article>
          <span>Units restocked</span>
          <strong>
            {report.totals.unitsRestocked} of {report.totals.unitsReturned}
          </strong>
        </article>
      </section>

      <section className="panel">
        <h2>Returns over time</h2>
        <LineChart
          title="Return requests and credited value"
          labels={report.series.map((point) => point.bucket)}
          series={[
            {
              key: 'count',
              label: 'Requests',
              values: report.series.map((point) => point.returnCount),
            },
          ]}
          emptyMessage="No returns were requested in this period."
        />
      </section>

      <div className="analytics-columns">
        <section className="panel">
          <h2>By reason</h2>
          <ShareBars
            title="Returned units by reason"
            slices={report.byReason.map((row) => ({
              key: row.reason,
              label: row.reason.replaceAll('_', ' ').toLowerCase(),
              value: row.quantity,
            }))}
            emptyMessage="No returns in this period."
          />
        </section>
        <section className="panel">
          <h2>By status</h2>
          <ShareBars
            title="Returns by status"
            slices={report.byStatus.map((row) => ({
              key: row.status,
              label: row.status.replaceAll('_', ' ').toLowerCase(),
              value: row.count,
            }))}
            emptyMessage="No returns in this period."
          />
        </section>
      </div>

      <section className="panel">
        <h2>Most returned medicines</h2>
        {report.byMedicine.length === 0 ? (
          <p className="state">No medicines were returned in this period.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Units</th>
                  <th>Credited</th>
                </tr>
              </thead>
              <tbody>
                {report.byMedicine.map((row) => (
                  <tr key={row.medicineId}>
                    <td>
                      {row.brandName}
                      <small>{row.genericName}</small>
                    </td>
                    <td>{row.quantity}</td>
                    <td>
                      <strong>{formatMinor(row.creditedMinor)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function AgeingReportBody({ report }: { report: ReceivablesAgeingReport }) {
  return (
    <>
      <section className="metric-grid finance-metrics">
        <article>
          <span>Total outstanding</span>
          <strong>{formatMinor(report.totalMinor)}</strong>
        </article>
        {report.buckets.map((bucket) => (
          <article key={bucket.bucket}>
            <span>{AGEING_LABELS[bucket.bucket] ?? bucket.bucket}</span>
            <strong>{formatMinor(bucket.amountMinor)}</strong>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>By customer</h2>
        {report.rows.length === 0 ? (
          <p className="state">Nothing is outstanding.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Not due</th>
                  <th>1–30</th>
                  <th>31–60</th>
                  <th>61–90</th>
                  <th>90+</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.shopId}>
                    <td>
                      <Link to={`/shops/${row.shopId}/ledger`}>{row.shopName}</Link>
                      <small>{row.shopReference}</small>
                    </td>
                    <td>{formatMinor(row.currentMinor)}</td>
                    <td>{formatMinor(row.days1to30Minor)}</td>
                    <td>{formatMinor(row.days31to60Minor)}</td>
                    <td>{formatMinor(row.days61to90Minor)}</td>
                    <td>{formatMinor(row.days90PlusMinor)}</td>
                    <td>
                      <strong>{formatMinor(row.totalMinor)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
