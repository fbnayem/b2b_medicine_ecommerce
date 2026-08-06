import type { AnalyticsOverview } from '@medsupply/shared-types';
import { Card } from './ui';
import { LineChart, ShareBars } from './Chart';
import { useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';

/**
 * The shape of the business, under the numbers that need somebody today.
 *
 * Three questions a distributor asks after "what is waiting for me": is trade
 * going up or down, who owes us and for how long, and what is actually selling.
 * They come from **one** request — `GET /reports/overview` — which the analytics
 * screen already makes, under the key it already uses, so opening this page and
 * then opening analytics costs one round trip between them rather than two.
 *
 * ## Why nothing here fails loudly
 *
 * Every chart renders only once its data has arrived, and the whole section
 * disappears if the request fails. This is the first screen of somebody's day
 * and these are the *secondary* half of it: an error card sitting where a sales
 * line should be would make a working morning look broken. The figures above it
 * come from different requests and are unaffected either way.
 *
 * ## Who sees it
 *
 * `/reports/overview` is management-only on the server, so this is asked for
 * only by a role the navigation manifest says may open the analytics screen —
 * the same test every home-screen figure passes. A storekeeper, a rider and a
 * shop owner get the figures and no charts, which is right: none of the three
 * questions above is theirs to answer.
 */

/** The default window. The analytics screen offers a range picker; this does not. */
const RANGE = '';

export function HomeCharts() {
  const { t } = useLanguage();
  const overview = useApiResource<AnalyticsOverview>(
    keys.analytics.overview(RANGE),
    '/reports/overview',
  );

  const data = overview.data;
  if (!data) return null;

  const series = data.salesSeries ?? [];
  const ageing = data.receivables?.ageing ?? [];
  const top = data.topMedicines ?? [];

  const ageingLabel = (bucket: string) =>
    ({
      CURRENT: t('analytics.notYetDue'),
      DAYS_1_30: t('analytics.days1to30'),
      DAYS_31_60: t('analytics.days31to60'),
      DAYS_61_90: t('analytics.days61to90'),
      DAYS_90_PLUS: t('analytics.over90'),
    })[bucket] ?? bucket;

  return (
    <section className="mb-8" data-test="home-charts">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
        {t('home.howTradeIsGoing')}
      </h2>

      <div className="grid items-start gap-4 xl:grid-cols-[3fr_2fr]">
        <Card>
          <h3 className="mb-2 text-base font-semibold text-text">{t('analytics.salesTrend')}</h3>
          <LineChart
            title={t('analytics.salesChartTitle')}
            money
            figures="collapsed"
            labels={series.map((point) => point.bucket)}
            series={[
              {
                key: 'net',
                label: t('analytics.netSales'),
                values: series.map((point) => point.netMinor),
              },
              {
                key: 'returned',
                label: t('analytics.creditedReturns'),
                values: series.map((point) => point.returnedMinor),
              },
            ]}
            emptyMessage={t('analytics.noInvoices')}
          />
        </Card>

        <div className="grid gap-4">
          <Card>
            <h3 className="mb-2 text-base font-semibold text-text">{t('home.whoOwesUs')}</h3>
            <ShareBars
              compact
              title={t('home.whoOwesUs')}
              money
              slices={ageing.map((bucket) => ({
                key: bucket.bucket,
                label: ageingLabel(bucket.bucket),
                value: bucket.amountMinor,
              }))}
              emptyMessage={t('home.nothingOutstanding')}
            />
          </Card>

          <Card>
            <h3 className="mb-2 text-base font-semibold text-text">{t('home.bestSellers')}</h3>
            <ShareBars
              compact
              title={t('home.bestSellers')}
              money
              // Five, because this is a glance and not the report. The whole
              // list is one click away on the analytics screen.
              slices={top.slice(0, 5).map((row) => ({
                key: row.key,
                label: row.label,
                value: row.netMinor,
              }))}
              emptyMessage={t('home.nothingSoldYet')}
            />
          </Card>
        </div>
      </div>
    </section>
  );
}
