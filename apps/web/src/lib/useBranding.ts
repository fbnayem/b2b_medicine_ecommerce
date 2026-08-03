import { useEffect, useState } from 'react';
import { brand as fallback } from '@medsupply/design-tokens';
import { configureFormatting, formattingLocale, type DateFormat } from '@medsupply/utilities';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';

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

let cached: Branding | null = null;

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
 */
export function useBranding(): Branding {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [branding, setBranding] = useState<Branding>(cached ?? DEFAULTS);

  useEffect(() => {
    if (!isAuthenticated || cached) return;
    let cancelled = false;

    apiClient
      .get('/settings/branding')
      .then((response) => {
        if (cancelled) return;
        const resolved: Branding = { ...DEFAULTS, ...response.data.data };
        cached = resolved;
        setBranding(resolved);
        /*
         * The formatter is told once, here, so every screen renders the
         * tenant's own settings rather than the built-in defaults.
         *
         * This used to pass two of the five fields. `currencyCode` and
         * `dateFormat` were fetched, held in state and rendered in the settings
         * screen while reaching no formatter, so choosing `YYYY-MM-DD` changed
         * nothing anywhere and every amount was scaled as though the currency
         * had two minor digits.
         */
        configureFormatting({
          locale: formattingLocale(resolved.locale),
          currencyCode: resolved.currencyCode,
          currencySymbol: resolved.currencySymbol,
          dateFormat: resolved.dateFormat as DateFormat,
          timeZone: resolved.timezone,
        });
      })
      .catch(() => {
        // Branding is decoration. Failing to read it must never stop a
        // storekeeper from seeing their pick list.
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  return branding;
}
