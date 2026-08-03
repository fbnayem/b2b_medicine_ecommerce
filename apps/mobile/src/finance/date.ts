import { formatDate, formatDateTime, toDateInputValue } from '@medsupply/utilities';

/**
 * `formatFinanceDate` and its date-time counterpart now come from
 * `@medsupply/utilities`, which always pins the configured time zone. The
 * versions here did too, but the ~11 other date call sites in this app did not
 * and silently used the device's zone.
 */
export { formatDateTime as formatFinanceDateTime };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
}

export function defaultStatementRange(now = new Date()): { from: string; to: string } {
  // `formatToParts` is Android-only under Hermes, so the shared helper returns
  // an assembled en-CA string and this splits it rather than reaching for parts.
  const today = toDateInputValue(now);
  const [year, month] = today.split('-');
  return { from: `${year}-${month}-01`, to: today };
}

export function formatFinanceDate(value?: string | number | Date | null): string {
  return formatDate(value);
}
