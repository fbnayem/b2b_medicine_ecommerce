import { type AnalyticsOverview, ReportGranularity } from '@medsupply/shared-types';
import { Card } from './ui';
import { LineChart, ShareBars } from './Chart';
import { useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { rollingRange } from '../pages/reportRange';

/**
 * The shape of the business, under the numbers that need somebody today.
 *
 * Three questions a distributor asks after "what is waiting for me": is trade
 * going up or down, who owes us and for how long, and what is actually selling.
 * All three come from **one** request — `GET /reports/overview`, the same
 * endpoint the analytics screen uses, so this section costs a single round trip
 * however many charts get added to it.
 *
 * ## The window is asked for, not defaulted
 *
 * `scopedRange` defaults every report to **month-to-date**, and this section
 * used to take that default. That is a reasonable default for the analytics
 * screen, which prints the period it is showing and offers a picker to change
 * it. It is the wrong one here, where neither is on screen, because it fails
 * worst exactly when this question is asked most: **on the first of a month
 * month-to-date is one day**, and no trend can be drawn through one point. For
 * the first week of every month the line was nearly flat regardless of how
 * trade was actually going.
 *
 * A rolling window always has a month of shape in it. The cost is that this no
 * longer shares a cache entry with the analytics screen — the range is part of
 * the key — so opening both makes two requests rather than one. That is the
 * right trade: a chart that is correct on the 1st is worth more than a round
 * trip saved by a reader who opened two screens.
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

/**
 * Thirty days, ending today. Long enough to show a direction, short enough that
 * a day is still a readable point on a chart this size.
 */
const WINDOW_DAYS = 30;

export function HomeCharts() {
  const { t } = useLanguage();
  const search = new URLSearchParams({
    ...rollingRange(WINDOW_DAYS),
    granularity: ReportGranularity.DAY,
  }).toString();
  const overview = useApiResource<AnalyticsOverview>(
    keys.analytics.overview(search),
    `/reports/overview?${search}`,
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
