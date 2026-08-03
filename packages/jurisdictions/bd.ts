import { LicenceType, ReferenceYearBasis, TaxEngineId, type CountryPack } from './types';

/**
 * Bangladesh — the first pack, and a transcription rather than a design.
 *
 * Every value here is what the system already does, read out of the code it is
 * replacing: `Asia/Dhaka` from `DEFAULT_FORMAT_SETTINGS`, `BDT` and the taka
 * symbol from `settingsDefaults.ts`, the Saturday week start from
 * `reportPeriod.ts`'s `$dateTrunc`, the two licence fields from `Shop.ts`, the
 * required `district` from its address sub-schema, and the flat tax from
 * `invoiceMath.ts`.
 *
 * That is the point of doing this country first. The seam is only trustworthy
 * if lifting the existing behaviour into it changes nothing, so this file
 * introduces no new decision — and the test for it is the existing suite going
 * green untouched.
 */
export const BD: CountryPack = {
  code: 'BD',
  name: 'Bangladesh',
  timeZone: 'Asia/Dhaka',
  currencyCode: 'BDT',
  // The Bangladeshi financial year runs July to June.
  fiscalYearStartMonth: 7,
  // What `Counter.ts` does today. Moving this deployment to a financial-year
  // series would change the references its customers already quote, so it stays
  // as found until the business asks for it.
  referenceYearBasis: ReferenceYearBasis.CALENDAR,
  weekend: ['friday', 'saturday'],
  weekStartsOn: 'saturday',
  address: {
    required: ['line1', 'city', 'district'],
    optional: ['line2', 'postalCode'],
    labels: {
      district: 'District',
      city: 'City',
      postalCode: 'Post code',
    },
  },
  callingCode: '880',
  licences: [
    // Recorded and checked for expiry, but not demanded — see `LicenceRule`.
    { type: LicenceType.DRUG_LICENCE, mustBePresent: false, blocksWhenExpired: true },
    // Captured on the shop record; nothing gates on it.
    { type: LicenceType.TRADE_LICENCE, mustBePresent: false, blocksWhenExpired: false },
  ],
  taxEngine: TaxEngineId.FLAT,
};
