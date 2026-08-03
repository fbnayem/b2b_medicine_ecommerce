/**
 * What differs between countries, as data.
 *
 * The system was built for one country and says so in a hundred places: a
 * currency symbol compiled into a formatter, a `+880` phone regex, a finance
 * day that begins at `+06:00`, a report week that starts on Saturday, a licence
 * field named after a Bangladeshi instrument. None of that is wrong — it was
 * right for the deployment it was written for. It only becomes wrong when there
 * is a second deployment.
 *
 * A **country pack** answers "what does this country do?", and the registry
 * below is the only place in the codebase where a country code appears. Core
 * code depends on the interface and never on a member of it.
 *
 * Two rules keep this honest.
 *
 * **Packs hold data, not behaviour.** No I/O, no dates, no formatting — those
 * live in `@medsupply/utilities`, which reads this. Keeping the dependency
 * one-way is also what stops the two packages forming a cycle, since the money
 * formatter needs the currency table and the calendar helpers need a zone.
 *
 * **Nothing speculative.** `LicenceType` lists the two instruments Bangladesh
 * actually issues and `TaxEngineId` lists the one engine that exists. Each
 * grows when a pack that needs it is added, alongside a deployment that can say
 * whether the entry is right. A list of plausible-looking values for countries
 * nobody has sold to yet is not an abstraction, it is a guess with a type.
 */

import { BD } from './bd';
import { currencyFor, type Currency } from './currency';
import type { CountryPack, Weekday } from './types';

export { CURRENCIES, currencyFor, isKnownCurrency, type Currency } from './currency';
export {
  LicenceType,
  ReferenceYearBasis,
  TaxEngineId,
  WEEKDAYS,
  weekdayIndex,
  type AddressField,
  type AddressRules,
  type CountryPack,
  type LicenceRule,
  type Weekday,
} from './types';
export { BD };

export const COUNTRY_PACKS: Readonly<Record<string, CountryPack>> = { BD };

/**
 * The pack a deployment uses when nothing is configured.
 *
 * Bangladesh, because that is what every existing deployment is, and because a
 * default that changes behaviour for the installed base is not a default.
 */
export const DEFAULT_COUNTRY_CODE = 'BD';

/**
 * The pack for a country code.
 *
 * Throws on an unknown code. A single-tenant deployment configured for a
 * country this build does not carry is a misconfiguration that must surface at
 * start-up, where somebody is watching, rather than as a subtly wrong invoice
 * three weeks later.
 */
export function packFor(code: string = DEFAULT_COUNTRY_CODE): CountryPack {
  const found = COUNTRY_PACKS[code.toUpperCase()];
  if (!found) {
    throw new Error(
      `No country pack for '${code}'. Available: ${Object.keys(COUNTRY_PACKS).join(', ')}.`,
    );
  }
  return found;
}

/** The pack's currency, resolved and validated against the currency table. */
export function currencyOf(pack: CountryPack): Currency {
  return currencyFor(pack.currencyCode);
}

export function isWeekend(pack: CountryPack, day: Weekday): boolean {
  return pack.weekend.includes(day);
}
