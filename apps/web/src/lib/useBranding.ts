import { useEffect } from 'react';
import { brand as fallback } from '@medsupply/design-tokens';
import { configureFormatting, formattingLocale, type DateFormat } from '@medsupply/utilities';
import { useAuthStore } from '../store/useAuth';
import { useApiResource } from './query';
import { keys } from './queryKeys';

export interface Branding {
  name: string;
  logoUrl?: string;
  currencySymbol: string;
  currencyCode: string;
  timezone: string;
  locale: string;
  dateFormat: string;
}

const DEFAULTS: Branding = {
  name: fallback.name,
  currencySymbol: fallback.currencySymbol,
  currencyCode: 'BDT',
  timezone: 'Asia/Dhaka',
  locale: 'en',
  dateFormat: 'DD MMM YYYY',
};

/**
 * The tenant's own name, symbol and timezone.
 *
 * `GET /settings/branding` has returned all of this since phase 10 and
 * **neither client read any of it** — "MedSupply B2B" was hard-coded in two
 * places on web, and the currency symbol in ten. A distributor who configured
 * their own name saw ours.
 *
 * The endpoint sits behind `requireAuth`, so the login screen resolves without
 * it and falls back to the token package's defaults. That is correct rather
 * than merely convenient: the sign-in page is the one screen where the tenant
 * is not yet known.
 *
 * **Read through the query cache, not a module variable.** This used to hold
 * `let cached: Branding | null` and guard the fetch with `if (cached) return` —
 * so it was read exactly once per page load and *nothing could ever clear it*.
 * An administrator changing the currency symbol, the timezone or the date
 * format saw their own change, and every other user went on seeing the old one
 * until they happened to reload. `SETTINGS_UPDATED` was already being emitted
 * to every role for exactly this, and landed nowhere. It is in the settings
 * family now, so saving on the settings screen and the push from another
 * browser both reach it.
 */
export function useBranding(): Branding {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const query = useApiResource<Partial<Branding>>(keys.settings.branding(), '/settings/branding', {
    enabled: isAuthenticated,
    // Branding is decoration. Failing to read it must never stop a storekeeper
    // from seeing their pick list, so a failure resolves to the defaults rather
    // than to an error state anybody has to acknowledge.
    retry: false,
  });

  const branding: Branding = { ...DEFAULTS, ...(query.data ?? {}) };

  /*
   * The formatter is told whenever the answer changes, so every screen renders
   * the tenant's own settings rather than the built-in defaults.
   *
   * This used to pass two of the five fields. `currencyCode` and `dateFormat`
   * were fetched, held in state and rendered in the settings screen while
   * reaching no formatter, so choosing `YYYY-MM-DD` changed nothing anywhere
   * and every amount was scaled as though the currency had two minor digits.
   */
  const { locale, currencyCode, currencySymbol, dateFormat, timezone }: Branding = branding;
  useEffect(() => {
    configureFormatting({
      locale: formattingLocale(locale),
      currencyCode,
      currencySymbol,
      dateFormat: dateFormat as DateFormat,
      timeZone: timezone,
    });
  }, [locale, currencyCode, currencySymbol, dateFormat, timezone]);

  return branding;
}
