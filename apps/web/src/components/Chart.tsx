import { useId } from 'react';
import { formatMoneyMinor, formatQuantity } from '@medsupply/utilities';
import { chartDark, chartLight } from '@medsupply/design-tokens';
import { resolveTheme, storedTheme } from '../lib/theme';

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

/**
 * A chart is decoration for people who can see it and useless to everyone else,
 * so the SVG is hidden from assistive technology and the same numbers are
 * always present as a real table.
 */
function DataTable({
  title,
  labels,
  series,
  money,
}: Required<Pick<ChartProps, 'title' | 'labels' | 'series'>> & { money: boolean }) {
  return (
    <table className="chart-data">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          {series.map((entry) => (
            <th key={entry.key} scope="col">
              {entry.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {labels.map((label, index) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            {series.map((entry) => (
              <td key={entry.key}>{formatValue(entry.values[index] ?? 0, money)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LineChart({
  title,
  labels,
  series,
  money = false,
  height = 220,
  emptyMessage = 'No data for this period.',
}: ChartProps) {
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
    return <p className="state chart-empty">{emptyMessage}</p>;
  }

  const pointX = (index: number) =>
    padding.left +
    (labels.length === 1 ? plotWidth / 2 : (index * plotWidth) / (labels.length - 1));
  const pointY = (value: number) => padding.top + plotHeight - ((value - min) / span) * plotHeight;

  return (
    <figure className="chart">
      <svg
        aria-hidden="true"
        focusable="false"
        role="presentation"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={series[0].colour ?? palette()[0]} stopOpacity="0.25" />
            <stop offset="100%" stopColor={series[0].colour ?? palette()[0]} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          className="chart-axis"
          x1={padding.left}
          x2={width - padding.right}
          y1={pointY(Math.max(0, min))}
          y2={pointY(Math.max(0, min))}
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
                className="chart-line"
                points={points.join(' ')}
                stroke={colour}
                strokeDasharray={DASHES[seriesIndex % DASHES.length]}
              />
            </g>
          );
        })}
      </svg>
      <ul className="chart-legend">
        {series.map((entry, index) => (
          <li key={entry.key}>
            <span
              className="chart-swatch"
              style={{ background: entry.colour ?? palette()[index % palette().length] }}
            />
            {entry.label}
          </li>
        ))}
      </ul>
      <figcaption className="chart-axis-labels">
        {tickIndexes(labels.length).map((index) => (
          <span key={labels[index]}>{labels[index]}</span>
        ))}
      </figcaption>
      <DataTable title={title} labels={labels} series={series} money={money} />
    </figure>
  );
}

export function BarChart({
  title,
  labels,
  series,
  money = false,
  emptyMessage = 'No data for this period.',
}: ChartProps) {
  if (!labels.length || !series.length) {
    return <p className="state chart-empty">{emptyMessage}</p>;
  }
  const max = Math.max(1, ...series.flatMap((entry) => entry.values));
  return (
    <figure className="chart">
      <div className="chart-bars" aria-hidden="true">
        {labels.map((label, index) => (
          <div className="chart-bar-group" key={label}>
            <div className="chart-bar-stack">
              {series.map((entry, seriesIndex) => (
                <span
                  key={entry.key}
                  className="chart-bar"
                  style={{
                    height: `${Math.round(((entry.values[index] ?? 0) / max) * 100)}%`,
                    background: entry.colour ?? palette()[seriesIndex % palette().length],
                  }}
                />
              ))}
            </div>
            <small>{label}</small>
          </div>
        ))}
      </div>
      <ul className="chart-legend">
        {series.map((entry, index) => (
          <li key={entry.key}>
            <span
              className="chart-swatch"
              style={{ background: entry.colour ?? palette()[index % palette().length] }}
            />
            {entry.label}
          </li>
        ))}
      </ul>
      <DataTable title={title} labels={labels} series={series} money={money} />
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
  emptyMessage = 'Nothing to break down yet.',
}: {
  title: string;
  slices: ShareSlice[];
  money?: boolean;
  emptyMessage?: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (!slices.length || total === 0) return <p className="state chart-empty">{emptyMessage}</p>;
  return (
    <ul className="share-bars" aria-label={title}>
      {slices.map((slice, index) => (
        <li key={slice.key}>
          <span className="share-label">{slice.label}</span>
          <span className="share-track">
            <span
              className="share-fill"
              style={{
                width: `${Math.max(2, Math.round((slice.value / total) * 100))}%`,
                background: palette()[index % palette().length],
              }}
            />
          </span>
          <span className="share-value">{formatValue(slice.value, money)}</span>
        </li>
      ))}
    </ul>
  );
}
