import type { CurrencySnapshot, LocalisationSettings } from '@medsupply/shared-types';
import { currencyFor, packFor, type CountryPack } from '@medsupply/jurisdictions';
import {
  configureFormatting,
  fiscalYearOf,
  formatSettings,
  formattingLocale,
  zonedYear,
  type DateFormat,
  type FormatSettings,
} from '@medsupply/utilities';
import { env } from '../env';
import { logger } from './logger';

/**
 * Teaching the server what the tenant configured.
 *
 * `configureFormatting` was called from exactly one place in the repository —
 * `apps/web/src/lib/useBranding.ts` — so the API rendered **every invoice PDF,
 * every CSV export and every server-side date** with the package defaults: the
 * taka symbol, `Asia/Dhaka` and `en-GB`, whatever the deployment had been
 * configured with. A client could set their currency symbol in System Settings,
 * watch it change on screen, and still receive an invoice printed in taka.
 *
 * That is the shape of this whole part of the work: the localisation surface
 * existed and was not connected. `currencyCode` and `dateFormat` were
 * persisted, validated, returned by `/settings/branding` and rendered in the
 * settings screen while being read by no formatter at all.
 */

/** The pack this deployment runs under. Fixed for the life of the process. */
export function countryPack(): CountryPack {
  return packFor(env.PRIMARY_COUNTRY);
}

/**
 * The zone the business day begins and ends in.
 *
 * **From the country pack, deliberately not from the administrable settings.**
 * This decides which day a posted transaction belongs to, so moving it moves
 * transactions between reporting periods — `docs/ASSUMPTIONS.md` pinned it to
 * Asia/Dhaka for exactly that reason, calling it "a finance-calendar decision
 * rather than a display setting". That reasoning is right and this keeps it;
 * all that changes is that the answer now comes from the deployment's country
 * instead of being compiled in.
 *
 * `localisation.timezone` remains the **display** zone and stays editable. The
 * two are the same value for every existing deployment.
 */
export function businessTimeZone(): string {
  return countryPack().timeZone;
}

/** The financial year a moment falls in, on this deployment's calendar. */
export function businessFiscalYear(value: string | number | Date = new Date()): number {
  return fiscalYearOf(value, businessTimeZone(), countryPack().fiscalYearStartMonth);
}

/** Settings the shared formatters take, derived from what the tenant saved. */
export function formatSettingsFrom(localisation: LocalisationSettings): FormatSettings {
  return {
    // The setting is a language; `Intl` needs a locale tag. See `formattingLocale`.
    locale: formattingLocale(localisation.locale),
    currencyCode: localisation.currencyCode,
    currencySymbol: localisation.currencySymbol,
    dateFormat: localisation.dateFormat as DateFormat,
    timeZone: localisation.timezone,
  };
}

let lastApplied = '';

/**
 * Applies the tenant's localisation to the shared formatters.
 *
 * Called on every settings load, which covers both start-up and a later change:
 * the cache refreshes at most every thirty seconds, so the active formatting is
 * never staler than that. It is idempotent and logs only when something
 * actually moved, because this runs on a hot path.
 *
 * A currency the build does not know throws here rather than being formatted at
 * an assumed exponent of two — which for yen would be a hundredfold error on
 * every amount, and is precisely the failure that must not be silent.
 */
export function applyFormatting(localisation: LocalisationSettings): void {
  const settings = formatSettingsFrom(localisation);
  const fingerprint = JSON.stringify(settings);
  if (fingerprint === lastApplied) return;

  // Resolving the currency first means an unknown code fails before the global
  // formatter state has been half-updated.
  const currency = currencyFor(settings.currencyCode);
  configureFormatting(settings);
  lastApplied = fingerprint;

  logger.info('Localisation applied', {
    country: env.PRIMARY_COUNTRY,
    currency: currency.code,
    exponent: currency.exponent,
    timeZone: settings.timeZone,
    dateFormat: settings.dateFormat,
    locale: settings.locale,
  });
}

/**
 * The year a document reference is stamped with.
 *
 * Two fixes in one place. It reads the year **in the business zone** rather
 * than `getUTCFullYear()`, which in Dhaka labels anything issued between
 * midnight and 6 am on 1 January with the previous year. And it honours the
 * pack's series basis, because many tax authorities require the invoice series
 * to be gapless within the financial year rather than the calendar one.
 */
export function referenceYear(value: string | number | Date = new Date()): number {
  const pack = countryPack();
  return pack.referenceYearBasis === 'FISCAL'
    ? businessFiscalYear(value)
    : zonedYear(value, businessTimeZone());
}

/** Intended for tests, which must not inherit another case's configuration. */
export function resetAppliedFormatting(): void {
  lastApplied = '';
}

/**
 * The currency a document is being issued in, as a snapshot to store on it.
 *
 * Documents render from this rather than from the live setting, because
 * `currencyCode` and `currencySymbol` are administrable: changing either would
 * otherwise restate every invoice ever issued, including ones a customer holds
 * on paper and an auditor may read years later. The exponent is carried because
 * it relates the stored integer to the printed amount, and reading that from a
 * later configuration is a hundredfold error rather than a cosmetic one.
 *
 * The same principle as `medicineSnapshot` and the business-identity snapshot.
 */
export function currencySnapshot(): CurrencySnapshot {
  const settings = formatSettings();
  const currency = currencyFor(settings.currencyCode);
  return {
    code: currency.code,
    // The tenant's own symbol wins over the currency's default: a deployment
    // that writes `Tk` rather than `৳` means it, and the document should say
    // what the business says.
    symbol: settings.currencySymbol || currency.symbol,
    exponent: currency.exponent,
  };
}

/**
 * Formatting settings for one document, from what that document recorded.
 *
 * Rendering an invoice through the live settings would restate it the moment an
 * administrator edits the currency — so a PDF regenerated next year would carry
 * a different symbol from the paper the customer signed for. Documents issued
 * before the snapshot existed fall back to the live settings, which is what
 * they were rendered with anyway.
 *
 * The exponent is taken from the currency table keyed by the recorded code
 * rather than from the recorded exponent itself: the two agree by construction,
 * and reading the code keeps one source for how a currency is written. The
 * stored exponent is the record of what the document was actually written with,
 * which is what an auditor would need if the table were ever corrected.
 */
export function documentFormatSettings(
  snapshot: Partial<CurrencySnapshot> | null | undefined,
): FormatSettings {
  const live = formatSettings();
  if (!snapshot?.code) return live;
  return {
    ...live,
    currencyCode: snapshot.code,
    currencySymbol: snapshot.symbol || live.currencySymbol,
  };
}
