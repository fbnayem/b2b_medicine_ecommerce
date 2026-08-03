import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

/**
 * The configured minimum password length.
 *
 * Read from System Settings rather than hard-coded, so a form refuses exactly
 * what the server would refuse. The administrative password reset previously
 * validated nothing at all — it was a `window.prompt` — so an administrator
 * could type four characters, watch the request fail, and have no idea why.
 *
 * Eight is the floor in `@medsupply/validation`, so it is the safe assumption
 * while the real value is on its way or if the request fails.
 */
const FLOOR = 8;

let cached: number | null = null;

export function usePasswordPolicy(): number {
  const [minimum, setMinimum] = useState(cached ?? FLOOR);

  useEffect(() => {
    if (cached !== null) return;
    let cancelled = false;
    apiClient
      .get('/settings/security')
      .then((response) => {
        const value = Number(response.data?.data?.values?.passwordMinLength);
        if (cancelled || !Number.isInteger(value) || value < FLOOR) return;
        cached = value;
        setMinimum(value);
      })
      .catch(() => {
        // Settings are administrator-only and this screen is too, but a failure
        // here must not stop a password being reset.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return minimum;
}
