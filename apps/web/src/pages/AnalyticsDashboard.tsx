import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AnalyticsOverview } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { LineChart, ShareBars } from '../components/Chart';
import { formatMinor } from '../lib/finance';
import { useReportRange } from './reportRange';
import { RangeControls } from '../components/RangeControls';
import './inventory.css';
import { formatQuantity } from '@medsupply/utilities';

const percent = (basisPoints: number) => `${(basisPoints / 100).toFixed(1)}%`;
const hours = (value: number | null) => (value === null ? '—' : `${value} h`);

const AGEING_LABELS: Record<string, string> = {
  CURRENT: 'Not yet due',
  DAYS_1_30: '1–30 days',
  DAYS_31_60: '31–60 days',
  DAYS_61_90: '61–90 days',
  DAYS_90_PLUS: 'Over 90 days',
};

export function AnalyticsDashboard() {
  const range = useReportRange();
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/reports/overview', { params: range.applied });
      setData(response.data.data as AnalyticsOverview);
      setError('');
    } catch (caught) {
      const failure = caught as { response?: { status?: number } };
      setError(
        failure.response?.status === 403
          ? 'Your role cannot view business analytics.'
          : 'Unable to load the analytics overview.',
      );
    } finally {
      setLoading(false);
    }
  }, [range.applied]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Analytics</p>
          <h1>Business overview</h1>
          <p>Sales, orders, delivery, returns and receivables for the selected period.</p>
        </div>
        <Link className="secondary-button" to="/analytics/sales">
          Detailed reports
        </Link>
      </header>

      <RangeControls range={range} />

      {error ? (
        <section className="state error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}

      {loading ? (
        <section className="state">Loading analytics...</section>
      ) : !data ? (
        <section className="state">No analytics are available for this period.</section>
      ) : (
        <>
          <section className="metric-grid finance-metrics">
            <article>
              <span>Net sales</span>
              <strong>{formatMinor(data.sales.netMinor)}</strong>
            </article>
            <article>
              <span>After returns</span>
              <strong>{formatMinor(data.sales.netAfterReturnsMinor)}</strong>
            </article>
            <article>
              <span>Invoices</span>
              <strong>{formatQuantity(data.sales.invoiceCount)}</strong>
            </article>
            <article>
              <span>Average invoice</span>
              <strong>{formatMinor(data.sales.averageInvoiceMinor)}</strong>
            </article>
            <article>
              <span>Outstanding</span>
              <strong>{formatMinor(data.receivables.outstandingMinor)}</strong>
            </article>
            <article>
              <span>Overdue</span>
              <strong>{formatMinor(data.receivables.overdueMinor)}</strong>
            </article>
          </section>

          <section className="panel">
            <h2>Sales trend</h2>
            <LineChart
              title="Net sales and returns by period"
              money
              labels={data.salesSeries.map((point) => point.bucket)}
              series={[
                {
                  key: 'net',
                  label: 'Net sales',
                  values: data.salesSeries.map((point) => point.netMinor),
                },
                {
                  key: 'returned',
                  label: 'Credited returns',
                  values: data.salesSeries.map((point) => point.returnedMinor),
                },
              ]}
              emptyMessage="No invoices were issued in this period."
            />
          </section>

          <div className="analytics-columns">
            <section className="panel">
              <h2>Order pipeline</h2>
              <dl className="stat-list">
                <div>
                  <dt>Submitted</dt>
                  <dd>{data.orders.submitted}</dd>
                </div>
                <div>
                  <dt>Approved</dt>
                  <dd>{data.orders.approved}</dd>
                </div>
                <div>
                  <dt>Invoiced</dt>
                  <dd>{data.orders.invoiced}</dd>
                </div>
                <div>
                  <dt>Delivered</dt>
                  <dd>{data.orders.delivered}</dd>
                </div>
                <div>
                  <dt>Rejected</dt>
                  <dd>{data.orders.rejected}</dd>
                </div>
                <div>
                  <dt>Cancelled</dt>
                  <dd>{data.orders.cancelled}</dd>
                </div>
              </dl>
              <p className="muted">
                Submission to review {hours(data.orderCycleHours.submitToReview)} · review to
                invoice {hours(data.orderCycleHours.reviewToInvoice)} · invoice to delivery{' '}
                {hours(data.orderCycleHours.invoiceToDelivery)}.
              </p>
            </section>

            <section className="panel">
              <h2>Delivery performance</h2>
              <dl className="stat-list">
                <div>
                  <dt>Deliveries</dt>
                  <dd>{data.delivery.total}</dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>{data.delivery.delivered + data.delivery.partiallyDelivered}</dd>
                </div>
                <div>
                  <dt>Failed</dt>
                  <dd>{data.delivery.failed}</dd>
                </div>
                <div>
                  <dt>Success rate</dt>
                  <dd>{percent(data.delivery.successBasisPoints)}</dd>
                </div>
                <div>
                  <dt>On time</dt>
                  <dd>{percent(data.delivery.onTimeBasisPoints)}</dd>
                </div>
                <div>
                  <dt>Average cycle</dt>
                  <dd>{hours(data.delivery.averageCycleHours)}</dd>
                </div>
              </dl>
            </section>

            <section className="panel">
              <h2>Returns</h2>
              <dl className="stat-list">
                <div>
                  <dt>Requests</dt>
                  <dd>{data.returns.returnCount}</dd>
                </div>
                <div>
                  <dt>Open</dt>
                  <dd>{data.returns.pendingCount}</dd>
                </div>
                <div>
                  <dt>Credited</dt>
                  <dd>{formatMinor(data.returns.creditedMinor)}</dd>
                </div>
                <div>
                  <dt>Awaiting credit</dt>
                  <dd>{formatMinor(data.returns.pendingCreditMinor)}</dd>
                </div>
                <div>
                  <dt>Return rate</dt>
                  <dd>{percent(data.returns.returnRateBasisPoints)}</dd>
                </div>
                <div>
                  <dt>Units restocked</dt>
                  <dd>{data.returns.unitsRestocked}</dd>
                </div>
              </dl>
            </section>

            <section className="panel">
              <h2>Inventory</h2>
              <dl className="stat-list">
                <div>
                  <dt>Stock at cost</dt>
                  <dd>{formatMinor(data.inventory.costValueMinor)}</dd>
                </div>
                <div>
                  <dt>Available units</dt>
                  <dd>{formatQuantity(data.inventory.available)}</dd>
                </div>
                <div>
                  <dt>Expiring or expired</dt>
                  <dd>{data.inventory.expiringSoonBatches} batches</dd>
                </div>
                <div>
                  <dt>Low stock</dt>
                  <dd>{data.inventory.lowStockCount} medicines</dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="analytics-columns">
            <section className="panel">
              <h2>Receivables ageing</h2>
              <ShareBars
                title="Receivables ageing"
                money
                slices={data.receivables.ageing.map((bucket) => ({
                  key: bucket.bucket,
                  label: AGEING_LABELS[bucket.bucket] ?? bucket.bucket,
                  value: bucket.amountMinor,
                }))}
                emptyMessage="Nothing is outstanding."
              />
            </section>
            <section className="panel">
              <h2>Top medicines</h2>
              <ShareBars
                title="Top medicines by net sales"
                money
                slices={data.topMedicines.map((row) => ({
                  key: row.key,
                  label: row.label,
                  value: row.netMinor,
                }))}
                emptyMessage="No sales in this period."
              />
            </section>
            <section className="panel">
              <h2>Top customers</h2>
              <ShareBars
                title="Top customers by net sales"
                money
                slices={data.topShops.map((row) => ({
                  key: row.key,
                  label: row.label,
                  value: row.netMinor,
                }))}
                emptyMessage="No sales in this period."
              />
            </section>
          </div>
        </>
      )}
    </main>
  );
}
