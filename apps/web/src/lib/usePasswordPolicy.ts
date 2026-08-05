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
 *
 * **This asked `GET /settings/security`, which the server has never served** —
 * `settingsRoutes.ts` mounts `GET /settings` and `PUT /settings/:group`, and
 * there is no per-group read. The `catch` below swallowed the 404 by design, so
 * the form silently used the floor no matter what an administrator had
 * configured: a policy of twelve characters was never enforced by the field,
 * only by the server's refusal afterwards. Found by the screen sweep in
 * `e2e/screens.spec.ts`, which asserts that no screen makes a request the
 * server refuses.
 */
const FLOOR = 8;

let cached: number | null = null;

export function usePasswordPolicy(): number {
  const [minimum, setMinimum] = useState(cached ?? FLOOR);

  useEffect(() => {
    if (cached !== null) return;
    let cancelled = false;
    apiClient
      .get('/settings')
      .then((response) => {
        const value = Number(response.data?.data?.settings?.security?.passwordMinLength);
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
