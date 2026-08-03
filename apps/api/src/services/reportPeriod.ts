import { ReportGranularity } from '@medsupply/shared-types';
import { toDateInputValue } from '@medsupply/utilities';

/**
 * Reports bucket on the Asia/Dhaka calendar, the same boundary the finance
 * day uses. A report and the ledger it summarises must agree on which day a
 * transaction belongs to, so this is deliberately not the display time zone.
 */
export const REPORT_TIMEZONE = 'Asia/Dhaka';

/** Mongo expression that turns a date field into a stable bucket label. */
export function bucketExpression(field: string, granularity: ReportGranularity) {
  if (granularity === ReportGranularity.MONTH) {
    return { $dateToString: { date: `$${field}`, format: '%Y-%m', timezone: REPORT_TIMEZONE } };
  }
  if (granularity === ReportGranularity.WEEK) {
    return {
      $dateToString: {
        date: {
          $dateTrunc: {
            date: `$${field}`,
            unit: 'week',
            timezone: REPORT_TIMEZONE,
            startOfWeek: 'saturday',
          },
        },
        format: '%Y-%m-%d',
        timezone: REPORT_TIMEZONE,
      },
    };
  }
  return { $dateToString: { date: `$${field}`, format: '%Y-%m-%d', timezone: REPORT_TIMEZONE } };
}

const DAY_MS = 86_400_000;

/**
 * Every bucket in the range, so a chart shows a gap as zero instead of closing
 * it up and implying the quiet day never existed.
 */
export function bucketLabels(from: string, to: string, granularity: ReportGranularity): string[] {
  const labels: string[] = [];
  const start = new Date(`${from}T00:00:00.000+06:00`);
  const end = new Date(`${to}T00:00:00.000+06:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return labels;

  if (granularity === ReportGranularity.MONTH) {
    let year = Number(from.slice(0, 4));
    let month = Number(from.slice(5, 7));
    const endLabel = to.slice(0, 7);
    for (let guard = 0; guard < 600; guard += 1) {
      const label = `${year}-${String(month).padStart(2, '0')}`;
      labels.push(label);
      if (label >= endLabel) break;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return labels;
  }

  const step = granularity === ReportGranularity.WEEK ? 7 * DAY_MS : DAY_MS;
  // Weeks are labelled by the Saturday that starts them, matching the aggregation.
  let cursor = start.getTime();
  if (granularity === ReportGranularity.WEEK) {
    const dhakaDay = new Date(cursor + 6 * 3_600_000).getUTCDay();
    cursor -= ((dhakaDay + 1) % 7) * DAY_MS;
  }
  for (let guard = 0; cursor <= end.getTime() && guard < 1200; guard += 1) {
    labels.push(toDateInputValue(new Date(cursor)));
    cursor += step;
  }
  return labels;
}

/** Merges sparse aggregation rows onto the full bucket list. */
export function fillBuckets<T extends { bucket: string }>(
  labels: string[],
  rows: T[],
  empty: (bucket: string) => T,
): T[] {
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  return labels.map((label) => byBucket.get(label) ?? empty(label));
}

export function basisPoints(part: number, whole: number) {
  if (!whole) return 0;
  const value = Math.round((part * 10_000) / whole);
  return Number.isFinite(value) ? value : 0;
}

export function millisToHours(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round((value / 3_600_000) * 10) / 10;
}
