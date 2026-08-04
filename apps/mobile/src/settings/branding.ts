import { useEffect, useState } from 'react';
import { brand as fallback } from '@medsupply/design-tokens';
import { configureFormatting, formattingLocale, type DateFormat } from '@medsupply/utilities';
import { apiClient } from '../api/client';

/**
 * The tenant's formatting, applied on this device.
 *
 * `configureFormatting` was called from exactly one place in the repository —
 * the web client — so the rider and warehouse apps rendered every amount and
 * every date with the package defaults: the taka symbol, `Asia/Dhaka` and
 * `DD MMM YYYY`, whatever the deployment had configured. The same gap existed
 * on the server, which is why an invoice printed in taka for a tenant who had
 * chosen something else.
 *
 * Deliberately the same shape as `apps/web/src/lib/useBranding.ts`. The two API
 * clients have already drifted once — web guards against an infinite refresh
 * loop and has a request timeout where mobile has neither — and this is exactly
 * the kind of small parallel module that drifts next.
 */

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

/** Intended for tests, which must not inherit another case's tenant. */
export function resetBrandingCache(): void {
  cached = null;
}

export function applyBranding(branding: Branding): void {
  configureFormatting({
    // The setting is a language; `Intl` needs a locale tag. Passing `en`
    // straight through renders times as `03:30 PM` rather than `03:30 pm`.
    locale: formattingLocale(branding.locale),
    currencyCode: branding.currencyCode,
    currencySymbol: branding.currencySymbol,
    dateFormat: branding.dateFormat as DateFormat,
    timeZone: branding.timezone,
  });
}

/**
 * Fetches branding once per session, configures the shared formatters, and
 * hands back what it read.
 *
 * `GET /settings/branding` sits behind `requireAuth`, so this waits for a
 * session rather than running at launch. Until it answers, the package defaults
 * apply — which is correct on the sign-in screen, where the tenant is not yet
 * known.
 *
 * It returns the branding rather than nothing because `locale` is the tenant's
 * language, and `LanguageProvider` ranks that above the handset's own setting:
 * this is a business tool on shared warehouse terminals and on personal phones,
 * so the distributor's choice should beat a second-hand handset that came with
 * its language already set.
 */
export function useBranding(isAuthenticated: boolean): Branding {
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
        applyBranding(resolved);
      })
      .catch(() => {
        // Branding is decoration. Failing to read it must never stop a rider
        // from completing a delivery.
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  return branding;
}
