import type { LocalisationSettings } from '@medsupply/shared-types';
import { currencyFor, packFor, type CountryPack } from '@medsupply/jurisdictions';
import {
  configureFormatting,
  fiscalYearOf,
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
