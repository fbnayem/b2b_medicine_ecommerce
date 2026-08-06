import { useId } from 'react';
import { formatMoneyMinor, formatQuantity } from '@medsupply/utilities';
import { chartDark, chartLight } from '@medsupply/design-tokens';
import { resolveTheme, storedTheme } from '../lib/theme';
import { useLanguage } from '../lib/useLanguage';
import { EmptyState, Table, Td, Th } from './ui';

/**
 * The analytics charts.
 *
 * Colour came from the token package and was always right; **geometry** came
 * from `chart`, `chart-bars`, `chart-bar-group`, `chart-bar-stack`,
 * `share-track` and `share-fill` in `inventory.css`, which was deleted. So the
 * lines still drew and the bar charts did not: a stack of unsized `<div>`s with
 * inline percentage heights against no height at all, and share bars with no
 * track to fill. Both analytics screens have been rendering that way.
 *
 * Rebuilt on utilities. The one rule worth keeping in view is that the SVG is
 * `aria-hidden` and the same numbers are always present as a real table — a
 * chart is decoration to anybody who cannot see it.
 */

export interface ChartSeries {
  key: string;
  label: string;
  /** CSS colour; falls back to the palette when omitted. */
  colour?: string;
  values: number[];
}

interface ChartProps {
  title: string;
  labels: string[];
  series: ChartSeries[];
  /** Renders values as BDT rather than plain counts. */
  money?: boolean;
  height?: number;
  emptyMessage?: string;
  /**
   * Where the figures table sits.
   *
   * `open` on the analytics screens, where the table *is* the report and the
   * chart is the summary of it. `collapsed` on the home screen, where three
   * charts each trailing a full table would bury everything under them — the
   * numbers are still there, still in the accessibility tree, still findable by
   * Ctrl-F, behind a disclosure the reader opens.
   *
   * There is deliberately no option to omit it. The SVG is `aria-hidden`, so a
   * chart with no table is a chart that does not exist for anybody using a
   * screen reader.
   */
  figures?: 'open' | 'collapsed';
}

/**
 * The token palette, picked by surface.
 *
 * This file carried its own unrelated blue-and-purple palette, unconnected to
 * anything else in the product, and a single set of colours for both themes —
 * the light greens are unreadable on a dark ground and the dark ones are
 * unreadable on white.
 */
function palette(): readonly string[] {
  return resolveTheme(storedTheme()) === 'dark' ? chartDark : chartLight;
}

/**
 * A dash pattern per series, so the lines are distinguishable **without
 * colour**.
 *
 * Around 8% of men have some form of colour blindness, and a printed report is
 * monochrome regardless. The series were separated by hue alone, which means
 * two of them were the same line to a meaningful share of readers.
 */
const DASHES = ['0', '6 4', '2 3', '10 4 2 4', '1 4', '8 3 1 3'];

function formatValue(value: number, money: boolean) {
  return money ? formatMoneyMinor(value) : formatQuantity(value);
}

/** Keeps a long axis readable by labelling at most eight ticks. */
function tickIndexes(count: number) {
  if (count <= 8) return Array.from({ length: count }, (_, index) => index);
  const step = Math.ceil(count / 8);
  const ticks: number[] = [];
  for (let index = 0; index < count; index += step) ticks.push(index);
  if (ticks[ticks.length - 1] !== count - 1) ticks.push(count - 1);
  return ticks;
}

function ChartFigures({
  title,
  labels,
  series,
  money,
  figures,
}: Required<Pick<ChartProps, 'title' | 'labels' | 'series'>> & {
  money: boolean;
  figures: 'open' | 'collapsed';
}) {
  const { t } = useLanguage();
  const table = <ChartFiguresTable title={title} labels={labels} series={series} money={money} />;

  if (figures === 'open') return table;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm text-text-muted">{t('charts.figures')}</summary>
      {table}
    </details>
  );
}

function ChartFiguresTable({
  title,
  labels,
  series,
  money,
}: Required<Pick<ChartProps, 'title' | 'labels' | 'series'>> & { money: boolean }) {
  const { t } = useLanguage();
  return (
    <Table className="mt-4 text-sm">
      <caption className="px-3 py-2 text-start text-sm text-text-muted">
        {title} — {t('charts.figures')}
      </caption>
      <thead>
        <tr>
          <Th>{t('charts.period')}</Th>
          {series.map((entry) => (
            <Th key={entry.key} numeric>
              {entry.label}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {labels.map((label, index) => (
          <tr key={label}>
            <Th scope="row" className="font-normal text-text">
              {label}
            </Th>
            {series.map((entry) => (
              <Td key={entry.key} numeric>
                {formatValue(entry.values[index] ?? 0, money)}
              </Td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <ul className="mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm text-text-muted">
      {series.map((entry, index) => (
        <li key={entry.key} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-sm"
            style={{ background: entry.colour ?? palette()[index % palette().length] }}
          />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

export function LineChart({
  title,
  labels,
  series,
  money = false,
  height = 220,
  emptyMessage,
  figures = 'open',
}: ChartProps) {
  const { t } = useLanguage();
  const gradientId = useId();
  const width = 720;
  const padding = { top: 16, right: 16, bottom: 28, left: 16 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const allValues = series.flatMap((entry) => entry.values);
  const max = Math.max(1, ...allValues);
  const min = Math.min(0, ...allValues);
  const span = max - min || 1;

  if (!labels.length || !series.length) {
    return <EmptyState title={emptyMessage ?? t('charts.noData')} />;
  }

  const pointX = (index: number) =>
    padding.left +
    (labels.length === 1 ? plotWidth / 2 : (index * plotWidth) / (labels.length - 1));
  const pointY = (value: number) => padding.top + plotHeight - ((value - min) / span) * plotHeight;

  return (
    <figure className="m-0">
      <svg
        aria-hidden="true"
        focusable="false"
        role="presentation"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-[13.75rem] w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={series[0].colour ?? palette()[0]} stopOpacity="0.25" />
            <stop offset="100%" stopColor={series[0].colour ?? palette()[0]} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={pointY(Math.max(0, min))}
          y2={pointY(Math.max(0, min))}
          stroke="var(--color-border)"
          strokeWidth="1"
        />
        {series.map((entry, seriesIndex) => {
          const colour = entry.colour ?? palette()[seriesIndex % palette().length];
          const points = entry.values.map((value, index) => `${pointX(index)},${pointY(value)}`);
          return (
            <g key={entry.key}>
              {seriesIndex === 0 ? (
                <polygon
                  fill={`url(#${gradientId})`}
                  points={`${pointX(0)},${pointY(Math.max(0, min))} ${points.join(' ')} ${pointX(
                    labels.length - 1,
                  )},${pointY(Math.max(0, min))}`}
                />
              ) : null}
              <polyline
                points={points.join(' ')}
                fill="none"
                stroke={colour}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                // `preserveAspectRatio="none"` stretches the viewBox, and a
                // scaled stroke would make each series a different thickness.
                vectorEffect="non-scaling-stroke"
                strokeDasharray={DASHES[seriesIndex % DASHES.length]}
              />
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
      <figcaption className="mt-1 flex justify-between gap-2 text-xs text-text-muted">
        {tickIndexes(labels.length).map((index) => (
          <span key={labels[index]}>{labels[index]}</span>
        ))}
      </figcaption>
      <ChartFigures title={title} labels={labels} series={series} money={money} figures={figures} />
    </figure>
  );
}

export function BarChart({
  title,
  labels,
  series,
  money = false,
  emptyMessage,
  figures = 'open',
}: ChartProps) {
  const { t } = useLanguage();
  if (!labels.length || !series.length) {
    return <EmptyState title={emptyMessage ?? t('charts.noData')} />;
  }
  const max = Math.max(1, ...series.flatMap((entry) => entry.values));
  return (
    <figure className="m-0">
      {/*
        A fixed plot height, because the bars are sized as a percentage of their
        column. With no height on the container — which is what the deleted
        stylesheet used to supply — every percentage resolved against zero and
        the chart drew nothing.
      */}
      <div aria-hidden="true" className="flex h-56 items-end gap-2 overflow-x-auto">
        {labels.map((label, index) => (
          <div key={label} className="flex h-full min-w-10 flex-1 flex-col items-center gap-1">
            <div className="flex h-full w-full items-end justify-center gap-0.5">
              {series.map((entry, seriesIndex) => (
                <span
                  key={entry.key}
                  className="w-full max-w-6 rounded-t-sm"
                  style={{
                    height: `${Math.round(((entry.values[index] ?? 0) / max) * 100)}%`,
                    background: entry.colour ?? palette()[seriesIndex % palette().length],
                  }}
                />
              ))}
            </div>
            <small className="truncate text-xs text-text-muted">{label}</small>
          </div>
        ))}
      </div>
      <Legend series={series} />
      <ChartFigures title={title} labels={labels} series={series} money={money} figures={figures} />
    </figure>
  );
}

export interface ShareSlice {
  key: string;
  label: string;
  value: number;
}

export function ShareBars({
  title,
  slices,
  money = false,
  emptyMessage,
  compact = false,
}: {
  title: string;
  slices: ShareSlice[];
  money?: boolean;
  emptyMessage?: string;
  /**
   * A sentence instead of an empty state.
   *
   * `EmptyState` is sized for a screen that has nothing on it — a heading, a
   * dashed frame, room to breathe. Dropped into a dashboard card beside two
   * others it becomes the largest thing on the page, so "nothing is
   * outstanding" ends up shouting louder than the sales figures next to it.
   */
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (!slices.length || total === 0) {
    const message = emptyMessage ?? t('charts.nothingToBreakDown');
    return compact ? (
      <p className="m-0 text-sm text-text-muted">{message}</p>
    ) : (
      <EmptyState title={message} />
    );
  }
  return (
    <ul aria-label={title} className="flex list-none flex-col gap-2 p-0">
      {slices.map((slice, index) => (
        <li
          key={slice.key}
          className="grid grid-cols-[minmax(6rem,1fr)_2fr_auto] items-center gap-3"
        >
          <span className="truncate text-sm text-text">{slice.label}</span>
          <span className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max(2, Math.round((slice.value / total) * 100))}%`,
                background: palette()[index % palette().length],
              }}
            />
          </span>
          <span className="text-sm tabular-nums text-text-muted">
            {formatValue(slice.value, money)}
          </span>
        </li>
      ))}
    </ul>
  );
}
