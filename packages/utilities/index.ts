/**
 * Money, quantity and date formatting — one implementation, both clients.
 *
 * There were ten money formatters before this package. Four were named and six
 * were written inline at the point of use, and they did not agree: eighteen
 * call sites rendered `৳${(minor / 100).toFixed(2)}`, which produces
 * `৳1250000.00` with no grouping at all, while adjacent screens produced
 * `৳1,234.5` and `৳1,234.50` for the very same field. A shop owner reading a
 * credit limit off the web and off their phone saw two different numbers.
 *
 * Dates were worse in a quieter way. Forty-one call sites formatted with the
 * device's own time zone because they never passed one, and only two helpers
 * pinned `Asia/Dhaka`. Nobody noticed because the machine this was built on is
 * itself in Dhaka — the bug stays invisible until the first user, server or CI
 * runner sits anywhere else, at which point an order placed at 1 am on the 3rd
 * is reported against the 2nd.
 *
 * Two rules follow from where this runs.
 *
 * Money and quantities never touch `Intl`. React Native uses Hermes, which
 * bundles no ICU of its own and delegates to whatever the operating system
 * provides, so `Intl` output varies by device and OS version. Integer
 * arithmetic and a grouping regex give the same string on every runtime — the
 * browser, Hermes, Node, jsdom and Playwright alike. It is also why nothing
 * here divides by 100 in floating point: minor units are the stored truth.
 *
 * Dates do use `Intl`, because month names are genuinely locale data, but
 * always with an explicit time zone.
 */

/** The business operates in one time zone; everything is stored in UTC. */
export const DHAKA_TIME_ZONE = 'Asia/Dhaka';

/** Shown when a value is missing or could not be rendered. */
export const NO_VALUE = '—';

export interface FormatSettings {
  /**
   * Reserved for the language work. Only month and weekday names will change;
   * digits stay Western in every locale, because these amounts are reconciled
   * against printed invoices, bank slips and mobile-money messages, and because
   * both money parsers accept only `[0-9]`.
   */
  locale: string;
  /** Configurable per tenant, so a deployment can render `Tk` instead. */
  currencySymbol: string;
  timeZone: string;
}

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  locale: 'en-GB',
  currencySymbol: '৳',
  timeZone: DHAKA_TIME_ZONE,
};

let active: FormatSettings = DEFAULT_FORMAT_SETTINGS;

/**
 * Applied once at start-up from the tenant's branding settings. Call sites take
 * the active settings implicitly, so adopting this package did not require
 * threading a context argument through several hundred components; tests and
 * anything order-sensitive pass settings explicitly instead.
 */
export function configureFormatting(next: Partial<FormatSettings>): void {
  active = { ...active, ...next };
}

export function formatSettings(): FormatSettings {
  return active;
}

/** Restores the defaults. Intended for tests. */
export function resetFormatting(): void {
  active = DEFAULT_FORMAT_SETTINGS;
}

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Renders integer minor units as major units with a currency symbol.
 * `123456789` becomes `৳1,234,567.89`.
 */
export function formatMoneyMinor(
  minor: number | null | undefined,
  settings: FormatSettings = active,
): string {
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor)) return NO_VALUE;
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const major = group(String(Math.floor(absolute / 100)));
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${settings.currencySymbol}${major}.${fraction}`;
}

// Deliberately no sign: every amount a user types here is positive. Negatives
// in this system are produced by the ledger — a reversal, a credit note — never
// keyed into a form, and accepting one would turn a mistyped payment into a
// refund. Formatting a negative is still supported; only entry is not.
const MONEY_INPUT = /^(?:(?:0|[1-9]\d*)|(?:[1-9]\d{0,2}(?:,\d{3})+))(?:\.(\d{1,2}))?$/;

export type MoneyParseFailure = 'malformed' | 'too-large';
export type MoneyParseResult =
  | { readonly ok: true; readonly minor: number }
  | { readonly ok: false; readonly reason: MoneyParseFailure };

/**
 * Converts a typed major-unit amount to integer minor units.
 *
 * The two failures are distinguished because they need different words: an
 * amount with three decimal places is a typo the user can correct, whereas one
 * beyond the safe integer range means the figure itself is wrong. `BigInt`
 * throughout, so an unsafe value is rejected rather than silently rounded.
 */
export function parseMoney(input: string): MoneyParseResult {
  const entered = input.trim();
  if (!MONEY_INPUT.test(entered)) return { ok: false, reason: 'malformed' };

  const [whole = '0', fraction = ''] = entered.replaceAll(',', '').split('.');
  try {
    const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'too-large' };
    return { ok: true, minor: Number(value) };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/** `parseMoney` for callers that only need "did it work". */
export function parseMoneyToMinor(input: string): number | null {
  const result = parseMoney(input);
  return result.ok ? result.minor : null;
}

/**
 * Minor units as a bare major-unit string for prefilling an amount field —
 * `123456` becomes `1234.56`. No symbol and no grouping, so it round-trips
 * through `parseMoney` exactly as the user would have typed it, and integer
 * arithmetic rather than `(minor / 100).toFixed(2)`, which is a float divide on
 * a value that is only exact as an integer.
 */
export function toMoneyInputValue(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor)) return '';
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  return `${negative ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** Grouped whole units — stock counts, pack sizes, order lines. */
export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  const negative = value < 0;
  return `${negative ? '-' : ''}${group(String(Math.abs(Math.trunc(value))))}`;
}

/**
 * Basis points to a percentage. Rates are stored as integer basis points for
 * the same reason money is stored in poisha, so 1234 is 12.34%.
 */
export function formatPercentFromBasisPoints(basisPoints: number | null | undefined): string {
  if (basisPoints === null || basisPoints === undefined || !Number.isSafeInteger(basisPoints)) {
    return NO_VALUE;
  }
  const negative = basisPoints < 0;
  const absolute = Math.abs(basisPoints);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}%`;
}

// Building an Intl.DateTimeFormat is expensive relative to formatting with one,
// and a table renders hundreds of dates per paint.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(settings: FormatSettings, withTime: boolean): Intl.DateTimeFormat {
  const key = `${settings.locale}|${settings.timeZone}|${withTime}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  const created = new Intl.DateTimeFormat(settings.locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: settings.timeZone,
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  });
  formatterCache.set(key, created);
  return created;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `02 Aug 2026`, in the configured time zone. */
export function formatDate(
  value: string | number | Date | null | undefined,
  settings: FormatSettings = active,
): string {
  const parsed = toDate(value);
  return parsed ? dateFormatter(settings, false).format(parsed) : NO_VALUE;
}

/** `02 Aug 2026, 03:30 pm`, in the configured time zone. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  settings: FormatSettings = active,
): string {
  const parsed = toDate(value);
  return parsed ? dateFormatter(settings, true).format(parsed) : NO_VALUE;
}

/**
 * The calendar date in the configured time zone, as `YYYY-MM-DD`, for date
 * inputs and range filters. `toISOString().slice(0, 10)` yields the UTC day,
 * which in Dhaka is the previous one for everything before 6 am.
 */
export function toDateInputValue(
  value: string | number | Date | null | undefined,
  settings: FormatSettings = active,
): string {
  const parsed = toDate(value);
  if (!parsed) return '';
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: settings.timeZone,
  }).format(parsed);
}
