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
 *
 * What varies by country is not hard-coded here any more. The exponent, the
 * separators, the symbol position and the digit-group sizes all come from
 * `@medsupply/jurisdictions`, which holds them as data. The dependency runs one
 * way — that package holds no behaviour and imports nothing from here.
 */

import { currencyFor, type Currency } from '@medsupply/jurisdictions';

/** The zone every existing deployment runs in; everything is stored in UTC. */
export const DHAKA_TIME_ZONE = 'Asia/Dhaka';

/** Shown when a value is missing or could not be rendered. */
export const NO_VALUE = '—';

/**
 * Date patterns an administrator may choose. Mirrors the enum in
 * `@medsupply/validation`, which is the schema this is configured through.
 */
export const DATE_FORMATS = ['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface FormatSettings {
  /**
   * Affects month and weekday names only. **Digits stay Western in every
   * locale** — these amounts are reconciled against printed invoices, bank
   * slips and mobile-money messages, and both money parsers accept only
   * `[0-9]`. That is not automatic: `Intl` with a `bn` locale renders
   * `০২ আগ, ২০২৬`, so every date formatter below appends the `-u-nu-latn`
   * extension to force Latin digits and get `02 আগ, 2026` — the rendering
   * `docs/ASSUMPTIONS.md` settled on.
   */
  locale: string;
  /** ISO 4217 code. Decides the exponent, separators and grouping. */
  currencyCode: string;
  /**
   * Overrides the currency's own symbol, so a deployment can render `Tk`
   * instead of `৳` without claiming to be a different currency.
   */
  currencySymbol: string;
  dateFormat: DateFormat;
  timeZone: string;
}

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  locale: 'en-GB',
  currencyCode: 'BDT',
  currencySymbol: '৳',
  dateFormat: 'DD MMM YYYY',
  timeZone: DHAKA_TIME_ZONE,
};

/**
 * The formatting locale for a configured language.
 *
 * The settings field named `locale` is really a **language** — its schema is
 * `['en', 'bn']` — while `Intl` wants a locale tag, and the difference is not
 * cosmetic. Bare `en` renders a time as `03:30 PM`; `en-GB` renders `03:30 pm`,
 * which is what this product has always shown. Passing the language straight
 * through would have restyled every timestamp in the application as a side
 * effect of connecting a setting.
 *
 * The obvious tag to reach for, `en-BD`, is **not a CLDR locale at all**. It
 * silently resolves to `en`, which is why the app never rendered Bangladeshi
 * conventions despite appearing to ask for them — the same trap recorded
 * against the old money formatters.
 */
export function formattingLocale(language: string): string {
  const base = language.trim().toLowerCase();
  if (base.startsWith('bn')) return 'bn-BD';
  if (base.startsWith('en')) return 'en-GB';
  return base || DEFAULT_FORMAT_SETTINGS.locale;
}

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

/** The currency backing these settings, resolved from the shared table. */
export function currencyOf(settings: FormatSettings = active): Currency {
  return currencyFor(settings.currencyCode);
}

/** The symbol actually rendered: the tenant's override, else the currency's own. */
function symbolOf(settings: FormatSettings, currency: Currency): string {
  return settings.currencySymbol || currency.symbol;
}

/**
 * Inserts group separators, reading the sizes outwards from the decimal point.
 *
 * The old implementation was the regex `\B(?=(\d{3})+(?!\d))`, which can only
 * ever produce groups of three. India writes a lakh as `1,00,000` — three
 * digits and then twos — so the sizes are a list rather than a constant, and
 * the last entry repeats.
 */
function group(digits: string, currency: Currency): string {
  const { groupSeparator, groupSizes } = currency;
  if (!groupSeparator || groupSizes.length === 0) return digits;
  const parts: string[] = [];
  let rest = digits;
  for (let index = 0; ; index += 1) {
    const size = groupSizes[Math.min(index, groupSizes.length - 1)] ?? 3;
    if (size <= 0 || rest.length <= size) break;
    parts.unshift(rest.slice(-size));
    rest = rest.slice(0, -size);
  }
  parts.unshift(rest);
  return parts.join(groupSeparator);
}

/**
 * Splits integer minor units into whole and fractional digit strings.
 *
 * By string surgery rather than division. `Math.floor(absolute / 100)` is a
 * floating-point divide on a value that is only exact as an integer, and this
 * file's whole premise is that minor units are the stored truth. Padding and
 * slicing is exact by construction at any exponent, including zero — where the
 * fraction is empty and no decimal separator is rendered at all.
 */
function splitMinor(absolute: number, exponent: number): { whole: string; fraction: string } {
  const digits = String(absolute).padStart(exponent + 1, '0');
  const cut = digits.length - exponent;
  return { whole: digits.slice(0, cut), fraction: digits.slice(cut) };
}

/**
 * Renders integer minor units as major units with a currency symbol.
 * `123456789` becomes `৳1,234,567.89` under BDT and `1.234.567,89 €` under EUR.
 */
export function formatMoneyMinor(
  minor: number | null | undefined,
  settings: FormatSettings = active,
): string {
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor)) return NO_VALUE;
  const currency = currencyOf(settings);
  const { whole, fraction } = splitMinor(Math.abs(minor), currency.exponent);
  const amount = fraction
    ? `${group(whole, currency)}${currency.decimalSeparator}${fraction}`
    : group(whole, currency);
  const sign = minor < 0 ? '-' : '';
  const symbol = symbolOf(settings, currency);
  return currency.symbolPosition === 'suffix'
    ? `${sign}${amount} ${symbol}`
    : `${sign}${symbol}${amount}`;
}

const DIGITS = /^\d+$/;

export type MoneyParseFailure = 'malformed' | 'too-large';
export type MoneyParseResult =
  | { readonly ok: true; readonly minor: number }
  | { readonly ok: false; readonly reason: MoneyParseFailure };

/**
 * Converts a typed major-unit amount to integer minor units.
 *
 * Deliberately no sign: every amount a user types here is positive. Negatives
 * in this system are produced by the ledger — a reversal, a credit note — never
 * keyed into a form, and accepting one would turn a mistyped payment into a
 * refund. Formatting a negative is still supported; only entry is not.
 *
 * The two failures are distinguished because they need different words: an
 * amount with too many decimal places is a typo the user can correct, whereas
 * one beyond the safe integer range means the figure itself is wrong. `BigInt`
 * throughout, so an unsafe value is rejected rather than silently rounded.
 *
 * Grouping is validated by **rendering it back**: separators are accepted only
 * where `formatMoneyMinor` would have put them. That keeps `12,34.00` a typo
 * rather than a silent `1,234`, and it makes the Indian `12,34,567` correct
 * without a second rule — the formatter and the parser cannot drift because one
 * is defined in terms of the other.
 */
export function parseMoney(input: string, settings: FormatSettings = active): MoneyParseResult {
  const currency = currencyOf(settings);
  const { groupSeparator, decimalSeparator, exponent } = currency;
  const entered = input.trim();
  if (entered === '') return { ok: false, reason: 'malformed' };

  const pieces = entered.split(decimalSeparator);
  if (pieces.length > 2) return { ok: false, reason: 'malformed' };
  const wholeTyped = pieces[0] ?? '';
  const fractionTyped = pieces.length === 2 ? (pieces[1] ?? '') : '';

  if (pieces.length === 2) {
    // A currency with no minor unit has no decimal part to type at all.
    if (exponent === 0 || !DIGITS.test(fractionTyped) || fractionTyped.length > exponent) {
      return { ok: false, reason: 'malformed' };
    }
  }

  const digits = groupSeparator ? wholeTyped.split(groupSeparator).join('') : wholeTyped;
  if (!DIGITS.test(digits)) return { ok: false, reason: 'malformed' };
  if (digits.length > 1 && digits.startsWith('0')) return { ok: false, reason: 'malformed' };
  if (
    groupSeparator &&
    wholeTyped.includes(groupSeparator) &&
    group(digits, currency) !== wholeTyped
  ) {
    return { ok: false, reason: 'malformed' };
  }

  try {
    const value =
      BigInt(digits) * 10n ** BigInt(exponent) +
      (exponent > 0 ? BigInt(fractionTyped.padEnd(exponent, '0')) : 0n);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'too-large' };
    return { ok: true, minor: Number(value) };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/** `parseMoney` for callers that only need "did it work". */
export function parseMoneyToMinor(input: string, settings: FormatSettings = active): number | null {
  const result = parseMoney(input, settings);
  return result.ok ? result.minor : null;
}

/**
 * Minor units as a bare major-unit string for prefilling an amount field —
 * `123456` becomes `1234.56`. No symbol and no grouping, so it round-trips
 * through `parseMoney` exactly as the user would have typed it, and string
 * surgery rather than `(minor / 100).toFixed(2)`, which is a float divide on a
 * value that is only exact as an integer.
 */
export function toMoneyInputValue(
  minor: number | null | undefined,
  settings: FormatSettings = active,
): string {
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor)) return '';
  const currency = currencyOf(settings);
  const { whole, fraction } = splitMinor(Math.abs(minor), currency.exponent);
  const sign = minor < 0 ? '-' : '';
  return fraction ? `${sign}${whole}${currency.decimalSeparator}${fraction}` : `${sign}${whole}`;
}

/** Grouped whole units — stock counts, pack sizes, order lines. */
export function formatQuantity(
  value: number | null | undefined,
  settings: FormatSettings = active,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  const sign = value < 0 ? '-' : '';
  return `${sign}${group(String(Math.abs(Math.trunc(value))), currencyOf(settings))}`;
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

/**
 * The locale with Latin digits forced.
 *
 * `Intl` renders `02 Aug 2026` under `bn` as `০২ আগ, ২০২৬`, because the numbering
 * system is part of the locale. Every figure in this product is reconciled
 * against printed invoices, bank slips and mobile-money messages in Western
 * digits, and both money parsers accept only `[0-9]` — so a Bangla date with
 * Bengali digits is a number nobody can type back in. The `-u-nu-latn`
 * extension keeps the month name translated and the digits Latin, which is the
 * `02 আগ, 2026` rendering `docs/ASSUMPTIONS.md` settled on.
 *
 * This was dormant rather than absent: nothing passed the configured locale
 * through until the server began applying tenant settings, at which point a
 * tenant choosing Bangla would have got Bengali digits on every date.
 */
function latinDigits(locale: string): string {
  return locale.includes('-u-') ? locale : `${locale}-u-nu-latn`;
}

function cachedFormatter(key: string, build: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = build();
  formatterCache.set(key, created);
  return created;
}

/**
 * Day, month and year as separate strings, so the configured pattern decides
 * the arrangement while the locale still decides the month name.
 *
 * Asking `Intl` for a whole formatted date would hand back the locale's own
 * ordering, which is why `dateFormat` had no effect: it was persisted,
 * validated as a three-option enum and rendered in the settings screen while
 * every date in the product came out as `DD MMM YYYY` regardless.
 */
function datePartsFor(parsed: Date, settings: FormatSettings) {
  const named = settings.dateFormat === 'DD MMM YYYY';
  const formatter = cachedFormatter(
    `date|${settings.locale}|${settings.timeZone}|${named}`,
    () =>
      new Intl.DateTimeFormat(latinDigits(settings.locale), {
        day: '2-digit',
        month: named ? 'short' : '2-digit',
        year: 'numeric',
        timeZone: settings.timeZone,
      }),
  );
  const parts = formatter.formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return { day: part('day'), month: part('month'), year: part('year') };
}

function timeFor(parsed: Date, settings: FormatSettings): string {
  return cachedFormatter(
    `time|${settings.locale}|${settings.timeZone}`,
    () =>
      new Intl.DateTimeFormat(latinDigits(settings.locale), {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: settings.timeZone,
      }),
  ).format(parsed);
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `02 Aug 2026` by default, in the configured pattern and time zone. */
export function formatDate(
  value: string | number | Date | null | undefined,
  settings: FormatSettings = active,
): string {
  const parsed = toDate(value);
  if (!parsed) return NO_VALUE;
  const { day, month, year } = datePartsFor(parsed, settings);
  switch (settings.dateFormat) {
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    default:
      return `${day} ${month} ${year}`;
  }
}

/** `02 Aug 2026, 03:30 pm`, in the configured pattern and time zone. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  settings: FormatSettings = active,
): string {
  const parsed = toDate(value);
  if (!parsed) return NO_VALUE;
  return `${formatDate(parsed, settings)}, ${timeFor(parsed, settings)}`;
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

/**
 * How far ahead of UTC a zone is at a given instant, in milliseconds.
 *
 * Derived from `Intl` rather than from a table, so it is right across daylight
 * saving without carrying zone data. Milliseconds are removed from both sides
 * because `Date.UTC` has no millisecond argument here and would otherwise leave
 * them in the difference.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA-u-nu-latn', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    // `en-CA` reports midnight as hour 24 in some engines.
    value('hour') % 24,
    value('minute'),
    value('second'),
  );
  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The instant a calendar day begins or ends in a given zone.
 *
 * This replaces `new Date(\`${value}T00:00:00.000+06:00\`)`, which is right for
 * Bangladesh only because Dhaka has no daylight saving. Anywhere that observes
 * it, a fixed offset puts the boundary an hour out for half the year — and a
 * finance day boundary an hour out moves transactions between reporting
 * periods.
 *
 * Resolved in two passes: the offset is read at the guessed instant and then
 * re-read at the result, which corrects the case where the guess and the answer
 * fall on opposite sides of a transition. Local times that do not exist, in the
 * hour a zone springs forward, resolve deterministically to the instant after
 * the gap rather than throwing.
 */
export function zonedDayBoundary(dateString: string, timeZone: string, end = false): Date {
  const match = DATE_ONLY.exec(dateString);
  if (!match) throw new Error(`Dates must use YYYY-MM-DD, received '${dateString}'`);
  const [, year, month, day] = match;
  const wall = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    end ? 23 : 0,
    end ? 59 : 0,
    end ? 59 : 0,
    end ? 999 : 0,
  );
  if (Number.isNaN(wall)) throw new Error(`Date is invalid: '${dateString}'`);

  const guessed = wall - zoneOffsetMs(new Date(wall), timeZone);
  const refined = wall - zoneOffsetMs(new Date(guessed), timeZone);
  return new Date(refined);
}

/** The calendar year in a zone, which near midnight is not the UTC one. */
export function zonedYear(value: string | number | Date, timeZone: string): number {
  return Number(toDateInputValue(value, { ...active, timeZone }).slice(0, 4));
}

/**
 * The day of the week in a zone, numbered as `Date.prototype.getUTCDay` does.
 *
 * Taken from the calendar date rather than by adding a fixed offset to the
 * clock, so it stays correct across a daylight-saving transition.
 */
export function zonedWeekday(value: string | number | Date, timeZone: string): number {
  const day = toDateInputValue(value, { ...active, timeZone });
  return new Date(`${day}T00:00:00.000Z`).getUTCDay();
}

/**
 * The financial year a moment falls in, labelled by the year it opened.
 *
 * A year opening in July means 2 August 2026 and 2 March 2027 are both in
 * financial year 2026. Countries differ: Bangladesh opens in July, India and
 * the United Kingdom in April, the UAE in January — which is why the month is a
 * parameter rather than a constant.
 */
export function fiscalYearOf(
  value: string | number | Date,
  timeZone: string,
  startMonth: number,
): number {
  const day = toDateInputValue(value, { ...active, timeZone });
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return month >= startMonth ? year : year - 1;
}

/**
 * The local date and time in the configured zone, as `YYYY-MM-DDTHH:mm`, for a
 * `datetime-local` input.
 *
 * The call site this replaces added six hours to the clock and sliced the ISO
 * string. That is right for Bangladesh only for as long as the offset never
 * changes, and it is the kind of constant that gets copied to a second call
 * site and then to a third — which is exactly what had begun to happen.
 */
export function toDateTimeInputValue(
  value: string | number | Date | null | undefined,
  settings: FormatSettings = active,
): string {
  const parsed = toDate(value);
  if (!parsed) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: settings.timeZone,
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  // `en-CA` renders midnight as `24` rather than `00` in some engines.
  const hour = part('hour') === '24' ? '00' : part('hour');
  return `${part('year')}-${part('month')}-${part('day')}T${hour}:${part('minute')}`;
}

/**
 * Which client and which platform a session's user agent names.
 *
 * `null` means "we could not tell", which the caller words in its own language
 * — the whole reason this returns a pair rather than a sentence. Both clients
 * carried this function verbatim (`apps/web/src/pages/securityLabels.ts` and
 * `apps/mobile/src/security/api.ts`), already diverging by one regex, and both
 * returned hard-coded English into a screen that is otherwise translated.
 *
 * The names it does return — Chrome, Android, MedSupply mobile — are proper
 * nouns and stay as they are in every language.
 */
export interface DeviceDescription {
  client: string | null;
  platform: string | null;
}

export function describeDevice(userAgent: string | null | undefined): DeviceDescription {
  if (!userAgent) return { client: null, platform: null };
  const platform = /android/i.test(userAgent)
    ? 'Android'
    : /iphone|ipad|ios|darwin/i.test(userAgent)
      ? 'iOS'
      : /windows/i.test(userAgent)
        ? 'Windows'
        : /mac os|macintosh/i.test(userAgent)
          ? 'macOS'
          : /linux/i.test(userAgent)
            ? 'Linux'
            : null;
  const client = /medsupply|expo|okhttp/i.test(userAgent)
    ? 'MedSupply mobile'
    : /edg\//i.test(userAgent)
      ? 'Edge'
      : /chrome\//i.test(userAgent)
        ? 'Chrome'
        : /firefox\//i.test(userAgent)
          ? 'Firefox'
          : /safari\//i.test(userAgent)
            ? 'Safari'
            : null;
  return { client, platform };
}

/** The four reasons a session can end, plus the ordinary one. */
export type RevocationReason =
  'tokenReuse' | 'revokedByAdmin' | 'roleChanged' | 'signedOutEverywhere' | 'signedOut';

/**
 * The catalogue key suffix for why a session ended.
 *
 * The server sends `TOKEN_REUSE`; this maps it to a name the catalogue holds
 * words for, so neither client has to keep its own switch of English sentences.
 */
export function revocationReason(reason: string | null | undefined): RevocationReason {
  switch (reason) {
    case 'TOKEN_REUSE':
      return 'tokenReuse';
    case 'REVOKED_BY_ADMIN':
      return 'revokedByAdmin';
    case 'ROLE_CHANGED':
      return 'roleChanged';
    case 'SIGNED_OUT_EVERYWHERE':
      return 'signedOutEverywhere';
    default:
      return 'signedOut';
  }
}
