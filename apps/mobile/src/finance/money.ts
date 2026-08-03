/**
 * Mobile-facing names for the shared money formatters.
 *
 * The implementation lives in `@medsupply/utilities` so this app and the web
 * app cannot drift again. They already had: the same medicine price rendered
 * `৳12,500.00` on the web and `৳12500.00` here, from the same API response.
 *
 * The shared version is this file's old algorithm promoted — integer
 * arithmetic and a grouping regex, no `Intl` — because Hermes bundles no ICU
 * and delegates to the operating system, so `Intl` output varies by device.
 */
export {
  formatMoneyMinor,
  formatPercentFromBasisPoints,
  parseMoney,
  parseMoneyToMinor,
} from '@medsupply/utilities';
