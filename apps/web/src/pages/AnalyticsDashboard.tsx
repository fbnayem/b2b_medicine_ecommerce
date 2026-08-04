import type { ReactNode } from 'react';
import type { AnalyticsOverview } from '@medsupply/shared-types';
import { formatQuantity } from '@medsupply/utilities';
import { LineChart, ShareBars } from '../components/Chart';
import { RangeControls } from '../components/RangeControls';
import { Card, EmptyState, LinkButton, PageHeader, Resource } from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatMinor } from '../lib/finance';
import { useReportRange } from './reportRange';

const percent = (basisPoints: number) => `${(basisPoints / 100).toFixed(1)}%`;

/** A figure with its name above it. Six of these are the top of the page. */
function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card>
      <p className="text-sm text-text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-text">{value}</p>
    </Card>
  );
}

/** A labelled figure inside a panel. */
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="tabular-nums text-text">{value}</dd>
    </div>
  );
}

export function AnalyticsDashboard() {
  const { t } = useLanguage();
  const range = useReportRange();

  const search = new URLSearchParams(
    Object.entries(range.applied).filter(([, value]) => Boolean(value)) as [string, string][],
  );
  const overview = useApiResource<AnalyticsOverview>(
    ['analytics-overview', search.toString()],
    `/reports/overview?${search.toString()}`,
  );

  const hours = (value: number | null) =>
    value === null ? t('analytics.notKnown') : t('analytics.hours', { hours: value });

  const ageingLabel = (bucket: string) =>
    ({
      CURRENT: t('analytics.notYetDue'),
      DAYS_1_30: t('analytics.days1to30'),
      DAYS_31_60: t('analytics.days31to60'),
      DAYS_61_90: t('analytics.days61to90'),
      DAYS_90_PLUS: t('analytics.over90'),
    })[bucket] ?? bucket;

  return (
    <main>
      <PageHeader
        routeId="analytics"
        title={t('analytics.title')}
        description={t('analytics.subtitle')}
        actions={<LinkButton to="/analytics/sales">{t('analytics.detailedReports')}</LinkButton>}
      />

      <RangeControls range={range} />

      <Resource
        query={overview}
        loadingLabel={t('analytics.loading')}
        errorMessageFallback={t('analytics.couldNotLoad')}
        empty={<EmptyState title={t('analytics.none')} description={t('analytics.noneBody')} />}
      >
        {(data) => (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <Metric label={t('analytics.netSales')} value={formatMinor(data.sales.netMinor)} />
              <Metric
                label={t('analytics.afterReturns')}
                value={formatMinor(data.sales.netAfterReturnsMinor)}
              />
              <Metric
                label={t('analytics.invoices')}
                value={formatQuantity(data.sales.invoiceCount)}
              />
              <Metric
                label={t('analytics.averageInvoice')}
                value={formatMinor(data.sales.averageInvoiceMinor)}
              />
              <Metric
                label={t('analytics.outstanding')}
                value={formatMinor(data.receivables.outstandingMinor)}
              />
              <Metric
                label={t('analytics.overdue')}
                value={formatMinor(data.receivables.overdueMinor)}
              />
            </div>

            <Card className="mb-4">
              <h2 className="mb-2 text-lg font-semibold text-text">{t('analytics.salesTrend')}</h2>
              <LineChart
                title={t('analytics.salesChartTitle')}
                money
                labels={data.salesSeries.map((point) => point.bucket)}
                series={[
                  {
                    key: 'net',
                    label: t('analytics.netSales'),
                    values: data.salesSeries.map((point) => point.netMinor),
                  },
                  {
                    key: 'returned',
                    label: t('analytics.creditedReturns'),
                    values: data.salesSeries.map((point) => point.returnedMinor),
                  },
                ]}
                emptyMessage={t('analytics.noInvoices')}
              />
            </Card>

            <div className="mb-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <Card>
                <h2 className="mb-2 text-lg font-semibold text-text">
                  {t('analytics.orderPipeline')}
                </h2>
                <dl className="m-0">
                  <Stat label={t('analytics.submitted')} value={data.orders.submitted} />
                  <Stat label={t('analytics.approved')} value={data.orders.approved} />
                  <Stat label={t('analytics.invoiced')} value={data.orders.invoiced} />
                  <Stat label={t('analytics.delivered')} value={data.orders.delivered} />
                  <Stat label={t('analytics.rejected')} value={data.orders.rejected} />
                  <Stat label={t('analytics.cancelled')} value={data.orders.cancelled} />
                </dl>
                <p className="mt-2 text-sm text-text-muted">
                  {t('analytics.cycleTimes', {
                    submitToReview: hours(data.orderCycleHours.submitToReview),
                    reviewToInvoice: hours(data.orderCycleHours.reviewToInvoice),
                    invoiceToDelivery: hours(data.orderCycleHours.invoiceToDelivery),
                  })}
                </p>
              </Card>

              <Card>
                <h2 className="mb-2 text-lg font-semibold text-text">
                  {t('analytics.deliveryPerformance')}
                </h2>
                <dl className="m-0">
                  <Stat label={t('analytics.deliveries')} value={data.delivery.total} />
                  <Stat
                    label={t('analytics.completed')}
                    value={data.delivery.delivered + data.delivery.partiallyDelivered}
                  />
                  <Stat label={t('analytics.failed')} value={data.delivery.failed} />
                  <Stat
                    label={t('analytics.successRate')}
                    value={percent(data.delivery.successBasisPoints)}
                  />
                  <Stat
                    label={t('analytics.onTime')}
                    value={percent(data.delivery.onTimeBasisPoints)}
                  />
                  <Stat
                    label={t('analytics.averageCycle')}
                    value={hours(data.delivery.averageCycleHours)}
                  />
                </dl>
              </Card>

              <Card>
                <h2 className="mb-2 text-lg font-semibold text-text">
                  {t('analytics.returnsTitle')}
                </h2>
                <dl className="m-0">
                  <Stat label={t('analytics.requests')} value={data.returns.returnCount} />
                  <Stat label={t('analytics.open')} value={data.returns.pendingCount} />
                  <Stat
                    label={t('analytics.credited')}
                    value={formatMinor(data.returns.creditedMinor)}
                  />
                  <Stat
                    label={t('analytics.awaitingCredit')}
                    value={formatMinor(data.returns.pendingCreditMinor)}
                  />
                  <Stat
                    label={t('analytics.returnRate')}
                    value={percent(data.returns.returnRateBasisPoints)}
                  />
                  <Stat label={t('analytics.unitsRestocked')} value={data.returns.unitsRestocked} />
                </dl>
              </Card>

              <Card>
                <h2 className="mb-2 text-lg font-semibold text-text">
                  {t('analytics.inventoryTitle')}
                </h2>
                <dl className="m-0">
                  <Stat
                    label={t('analytics.stockAtCost')}
                    value={formatMinor(data.inventory.costValueMinor)}
                  />
                  <Stat
                    label={t('analytics.availableUnits')}
                    value={formatQuantity(data.inventory.available)}
                  />
                  <Stat
                    label={t('analytics.expiringOrExpired')}
                    value={t('analytics.expiringBatches', {
                      count: data.inventory.expiringSoonBatches,
                    })}
                  />
                  <Stat
                    label={t('analytics.lowStock')}
                    value={t('analytics.lowStockCount', { count: data.inventory.lowStockCount })}
                  />
                </dl>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <h2 className="mb-2 text-lg font-semibold text-text">{t('analytics.ageing')}</h2>
                <ShareBars
                  title={t('analytics.ageing')}
                  money
                  slices={data.receivables.ageing.map((bucket) => ({
                    key: bucket.bucket,
                    label: ageingLabel(bucket.bucket),
                    value: bucket.amountMinor,
                  }))}
                  emptyMessage={t('analytics.nothingOutstanding')}
                />
              </Card>
              <Card>
                <h2 className="mb-2 text-lg font-semibold text-text">
                  {t('analytics.topMedicines')}
                </h2>
                <ShareBars
                  title={t('analytics.topMedicinesTitle')}
                  money
                  slices={data.topMedicines.map((row) => ({
                    key: row.key,
                    label: row.label,
                    value: row.netMinor,
                  }))}
                  emptyMessage={t('analytics.noSales')}
                />
              </Card>
              <Card>
                <h2 className="mb-2 text-lg font-semibold text-text">
                  {t('analytics.topCustomers')}
                </h2>
                <ShareBars
                  title={t('analytics.topCustomersTitle')}
                  money
                  slices={data.topShops.map((row) => ({
                    key: row.key,
                    label: row.label,
                    value: row.netMinor,
                  }))}
                  emptyMessage={t('analytics.noSales')}
                />
              </Card>
            </div>
          </>
        )}
      </Resource>
    </main>
  );
}
