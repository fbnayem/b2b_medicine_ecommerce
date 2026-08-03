import { ReportGranularity } from '@medsupply/shared-types';
import { WEEKDAYS } from '@medsupply/jurisdictions';
import {
  formatSettings,
  toDateInputValue,
  zonedDayBoundary,
  zonedWeekday,
} from '@medsupply/utilities';
import { businessTimeZone, countryPack } from './localisation';

/**
 * Reports bucket on the business calendar, the same boundary the finance day
 * uses. A report and the ledger it summarises must agree on which day a
 * transaction belongs to, so this is deliberately not the display time zone.
 *
 * Both the zone and the day a week starts on were compiled in — `Asia/Dhaka`
 * and `saturday`, which is the Bangladeshi working week. They now come from the
 * deployment's country pack, and for Bangladesh they are the same two values.
 */
export function reportTimeZone(): string {
  return businessTimeZone();
}

/** Mongo expression that turns a date field into a stable bucket label. */
export function bucketExpression(field: string, granularity: ReportGranularity) {
  const timezone = reportTimeZone();
  if (granularity === ReportGranularity.MONTH) {
    return { $dateToString: { date: `$${field}`, format: '%Y-%m', timezone } };
  }
  if (granularity === ReportGranularity.WEEK) {
    return {
      $dateToString: {
        date: {
          $dateTrunc: {
            date: `$${field}`,
            unit: 'week',
            timezone,
            startOfWeek: countryPack().weekStartsOn,
          },
        },
        format: '%Y-%m-%d',
        timezone,
      },
    };
  }
  return { $dateToString: { date: `$${field}`, format: '%Y-%m-%d', timezone } };
}

const DAY_MS = 86_400_000;

/**
 * Every bucket in the range, so a chart shows a gap as zero instead of closing
 * it up and implying the quiet day never existed.
 */
export function bucketLabels(from: string, to: string, granularity: ReportGranularity): string[] {
  const labels: string[] = [];
  const timezone = reportTimeZone();
  let start: Date;
  let end: Date;
  try {
    // Was `${from}T00:00:00.000+06:00`. A literal offset is only ever right for
    // a zone with no daylight saving.
    start = zonedDayBoundary(from, timezone);
    end = zonedDayBoundary(to, timezone);
  } catch {
    return labels;
  }
  if (start > end) return labels;

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
  // Weeks are labelled by the day that starts them, matching the aggregation.
  let cursor = start.getTime();
  if (granularity === ReportGranularity.WEEK) {
    const weekStart = WEEKDAYS.indexOf(countryPack().weekStartsOn);
    cursor -= ((zonedWeekday(cursor, timezone) - weekStart + 7) % 7) * DAY_MS;
  }
  for (let guard = 0; cursor <= end.getTime() && guard < 1200; guard += 1) {
    labels.push(toDateInputValue(new Date(cursor), { ...formatSettings(), timeZone: timezone }));
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
