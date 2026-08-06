import Constants from 'expo-constants';
import {
  APP_VARIANT_NAME,
  VARIANT_ROLES,
  isAppVariant,
  isRoleInVariant,
  variantForRole,
  type AppVariant,
} from '@medsupply/navigation';
import { UserRole } from '@medsupply/shared-types';
import { translatedOr, type Translate } from '@medsupply/i18n';

/**
 * Which of the three applications this build is, at run time.
 *
 * `app.config.ts` decides it and writes it into `extra`; this reads it back.
 * The value travels through the built application rather than through an
 * environment variable, because `process.env` is a build-time thing and Hermes
 * has none — what a running app can see is its own configuration.
 *
 * ## What this is for, and what it is not
 *
 * It decides **who may sign in**. A manager's account opening the rider
 * application is not a security hole — the server admits them either way, and
 * they would see a manager's tabs because tabs follow the role — but it is a
 * person who has installed the wrong thing and will spend a while not
 * understanding why the application looks nothing like the one they were
 * shown. Saying so at the sign-in screen, by name, is the whole feature.
 *
 * It is **not** an authorisation boundary. Every one of these three
 * applications talks to the same API, which decides what anybody may read or
 * write from the token, exactly as it did when there was one application. If
 * this file were deleted the product would be less clear and no less safe.
 */

function readVariant(): AppVariant {
  const declared = Constants.expoConfig?.extra?.variant as unknown;
  if (isAppVariant(declared)) return declared;
  /*
   * Not a throw. A configuration that lost its variant is a broken build, but
   * throwing here happens during the first import of the first screen, which
   * shows a red box or — in a release build — a blank window that closes.
   * Falling back to staff keeps the application usable while
   * `appVariant.test.ts` and the config's own validation stop this from ever
   * shipping.
   */
  return 'staff';
}

export const APP_VARIANT: AppVariant = readVariant();

/** The roles this build lets in. */
export const ALLOWED_ROLES: readonly UserRole[] = VARIANT_ROLES[APP_VARIANT];

export function mayUseThisApp(role: UserRole): boolean {
  return isRoleInVariant(role, APP_VARIANT);
}

/**
 * What to tell somebody who signed in to the wrong one of the three.
 *
 * Names the application they should install rather than saying "not
 * permitted" — the account is fine, the download was wrong, and those are
 * opposite problems. Returns `undefined` when the role is welcome here, so a
 * caller can treat the presence of a message as the refusal.
 */
export function wrongAppMessage(role: UserRole, t: Translate): string | undefined {
  if (mayUseThisApp(role)) return undefined;
  const belongs = variantForRole(role);
  const theirs = belongs
    ? translatedOr(t, `appVariant.${belongs}`, APP_VARIANT_NAME[belongs])
    : undefined;
  const ours = translatedOr(t, `appVariant.${APP_VARIANT}`, APP_VARIANT_NAME[APP_VARIANT]);
  return theirs
    ? t('auth.wrongApp', { thisApp: ours, theirApp: theirs })
    : t('auth.noAppForRole', { thisApp: ours });
}
