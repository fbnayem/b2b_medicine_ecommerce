/**
 * The shape of a country pack.
 *
 * Separate from `index.ts` so a pack can import the declarations it is written
 * against without the registry importing the pack and the pack importing the
 * registry back. `LicenceType` and `TaxEngineId` are values, not just types, so
 * that cycle would be a real one at run time rather than one the compiler
 * erases.
 */

/**
 * Ordered so the index is the same number `Date.prototype.getUTCDay` returns,
 * while the name is what MongoDB's `$dateTrunc` takes as `startOfWeek`. Both
 * forms are needed and deriving one from the other beats storing two lists.
 */
export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export function weekdayIndex(day: Weekday): number {
  return WEEKDAYS.indexOf(day);
}

/**
 * Licences a wholesaler must hold to trade. Bangladesh's two are the only ones
 * modelled today because they are the only ones anybody has verified. This list
 * grows when a pack that needs a new one is added, alongside a deployment that
 * can confirm the entry is right.
 */
export const LicenceType = {
  DRUG_LICENCE: 'DRUG_LICENCE',
  TRADE_LICENCE: 'TRADE_LICENCE',
} as const;
export type LicenceType = (typeof LicenceType)[keyof typeof LicenceType];

/**
 * What the year in a document reference means.
 *
 * Bangladesh is `CALENDAR`, which is a transcription of what `Counter.ts`
 * already does rather than a recommendation. Many tax authorities require the
 * invoice series to be gapless **within the financial year**, which is a
 * different reset point — and switching an existing deployment between the two
 * changes the references its customers see, so it is a decision for the
 * business rather than a default.
 */
export const ReferenceYearBasis = {
  CALENDAR: 'CALENDAR',
  FISCAL: 'FISCAL',
} as const;
export type ReferenceYearBasis = (typeof ReferenceYearBasis)[keyof typeof ReferenceYearBasis];

/** Which tax calculation applies. `FLAT` is the single rate the system has today. */
export const TaxEngineId = {
  FLAT: 'FLAT',
} as const;
export type TaxEngineId = (typeof TaxEngineId)[keyof typeof TaxEngineId];

export type AddressField = 'line1' | 'line2' | 'city' | 'district' | 'state' | 'postalCode';

export interface LicenceRule {
  readonly type: LicenceType;
  /**
   * Whether a number must be on file before an order may be approved.
   *
   * Bangladesh sets this `false`, which is a faithful reading of
   * `approvalService.ts:74` rather than an endorsement of it: that check blocks
   * an **expired** licence and says nothing about a missing one, so a shop with
   * no drug licence recorded can order today. Writing the two conditions as
   * separate fields is what makes that visible instead of implied.
   */
  readonly mustBePresent: boolean;
  /** Whether an expiry date in the past blocks approval. */
  readonly blocksWhenExpired: boolean;
}

export interface AddressRules {
  readonly required: readonly AddressField[];
  readonly optional: readonly AddressField[];
  /**
   * What the country calls each field, in English. A district in Bangladesh is
   * an emirate in the UAE and a county in the United Kingdom, and the label is a
   * fact about the country rather than a translation of one — so it belongs
   * here, while rendering it in Bangla or Arabic remains `@medsupply/i18n`'s
   * job.
   */
  readonly labels: Partial<Record<AddressField, string>>;
}

export interface CountryPack {
  /** ISO 3166-1 alpha-2. */
  readonly code: string;
  readonly name: string;
  /** IANA zone. Also the default for the finance calendar and for display. */
  readonly timeZone: string;
  /** ISO 4217 code, resolved against the currency table in `currency.ts`. */
  readonly currencyCode: string;
  /**
   * Month the financial year opens, 1-12. Reference sequences reset here, which
   * is what most tax authorities mean by a gapless annual series. Bangladesh
   * opens in July; India and the United Kingdom open in April.
   */
  readonly fiscalYearStartMonth: number;
  /** Whether reference sequences reset on the calendar year or the financial one. */
  readonly referenceYearBasis: ReferenceYearBasis;
  /** Non-working days. Bangladesh closes Friday and Saturday. */
  readonly weekend: readonly Weekday[];
  /** First day of the reporting week, for week buckets in reports. */
  readonly weekStartsOn: Weekday;
  readonly address: AddressRules;
  /** E.164 calling code, without the `+`. */
  readonly callingCode: string;
  /** Licences this country's regulator issues, and how each one gates trading. */
  readonly licences: readonly LicenceRule[];
  readonly taxEngine: TaxEngineId;
}
