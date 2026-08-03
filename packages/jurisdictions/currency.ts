/**
 * Currency as data.
 *
 * Money formatting lives in `@medsupply/utilities` and this package holds what
 * it needs to know. Four things vary by currency and all four are hard-coded
 * today:
 *
 *   **Exponent.** `formatMoneyMinor` divides by 100. Japanese yen has no minor
 *   unit at all and Kuwaiti, Bahraini and Omani dinars have three, so the same
 *   stored integer renders 100x too small in one direction and 10x too large in
 *   the other. Minor units are the stored truth everywhere in this system, so
 *   this number decides what that truth means.
 *
 *   **Separators.** `,` for groups and `.` for the decimal. Most of Europe
 *   writes it the other way round.
 *
 *   **Symbol position.** Always a prefix. The euro is conventionally written
 *   after the amount in most of the euro area.
 *
 *   **Group sizes.** Always threes. India groups the first three and then in
 *   twos — `12,34,567`, not `1,234,567` — which the current grouping regex
 *   cannot express at all.
 *
 * Nothing here uses `Intl.NumberFormat`, and that is deliberate rather than an
 * oversight: React Native runs Hermes, which bundles no ICU of its own and
 * delegates to whatever the operating system provides, so `Intl` money output
 * varies by device and OS version. The whole reason `@medsupply/utilities`
 * formats money by integer arithmetic is to be identical on every runtime, and
 * a table of plain data is what lets that stay true across currencies.
 */

export interface Currency {
  /** ISO 4217 alphabetic code. */
  readonly code: string;
  /**
   * Digits after the decimal point — ISO 4217 calls this the minor unit. It is
   * the exponent relating the stored integer to the displayed amount, so
   * changing it on a live deployment restates every figure ever recorded.
   */
  readonly exponent: number;
  readonly symbol: string;
  readonly symbolPosition: 'prefix' | 'suffix';
  readonly groupSeparator: string;
  readonly decimalSeparator: string;
  /**
   * Digit-group sizes reading outwards from the decimal point. The final entry
   * repeats, so `[3]` is the common pattern and `[3, 2]` is the Indian one.
   */
  readonly groupSizes: readonly number[];
}

const THREES = [3] as const;

/**
 * Only currencies a chosen market actually uses, plus the two exponent edge
 * cases. This is not a full ISO 4217 table on purpose: an unused row is an
 * untested row, and a wrong exponent is a hundredfold error in a ledger.
 */
export const CURRENCIES: Readonly<Record<string, Currency>> = {
  BDT: {
    code: 'BDT',
    exponent: 2,
    symbol: '৳',
    symbolPosition: 'prefix',
    groupSeparator: ',',
    decimalSeparator: '.',
    groupSizes: THREES,
  },
  // Indian grouping is the reason `groupSizes` is an array rather than a
  // boolean: 1234567 paise is 12,345.67, and a lakh is written 1,00,000.
  INR: {
    code: 'INR',
    exponent: 2,
    symbol: '₹',
    symbolPosition: 'prefix',
    groupSeparator: ',',
    decimalSeparator: '.',
    groupSizes: [3, 2],
  },
  AED: {
    code: 'AED',
    exponent: 2,
    symbol: 'د.إ',
    symbolPosition: 'prefix',
    groupSeparator: ',',
    decimalSeparator: '.',
    groupSizes: THREES,
  },
  SAR: {
    code: 'SAR',
    exponent: 2,
    symbol: 'ر.س',
    symbolPosition: 'prefix',
    groupSeparator: ',',
    decimalSeparator: '.',
    groupSizes: THREES,
  },
  GBP: {
    code: 'GBP',
    exponent: 2,
    symbol: '£',
    symbolPosition: 'prefix',
    groupSeparator: ',',
    decimalSeparator: '.',
    groupSizes: THREES,
  },
  EUR: {
    code: 'EUR',
    exponent: 2,
    symbol: '€',
    symbolPosition: 'suffix',
    groupSeparator: '.',
    decimalSeparator: ',',
    groupSizes: THREES,
  },
  USD: {
    code: 'USD',
    exponent: 2,
    symbol: '$',
    symbolPosition: 'prefix',
    groupSeparator: ',',
    decimalSeparator: '.',
    groupSizes: THREES,
  },
  // No minor unit: 1000 JPY is stored as 1000, not 100000.
  JPY: {
    code: 'JPY',
    exponent: 0,
    symbol: '¥',
    symbolPosition: 'prefix',
    groupSeparator: ',',
    decimalSeparator: '.',
    groupSizes: THREES,
  },
  // Three minor digits: 1 KWD is 1000 fils.
  KWD: {
    code: 'KWD',
    exponent: 3,
    symbol: 'د.ك',
    symbolPosition: 'prefix',
    groupSeparator: ',',
    decimalSeparator: '.',
    groupSizes: THREES,
  },
};

export function isKnownCurrency(code: string): boolean {
  return Object.hasOwn(CURRENCIES, code.toUpperCase());
}

/**
 * The currency for a code.
 *
 * Throws on an unknown code rather than guessing an exponent of 2. A deployment
 * configured with a currency this build does not know about must fail at
 * start-up, where somebody is watching, and not silently render every amount in
 * the wrong scale.
 */
export function currencyFor(code: string): Currency {
  const found = CURRENCIES[code.toUpperCase()];
  if (!found) {
    throw new Error(
      `Unknown currency '${code}'. Known currencies: ${Object.keys(CURRENCIES).join(', ')}. ` +
        `Add it to packages/jurisdictions/currency.ts with its ISO 4217 exponent.`,
    );
  }
  return found;
}
