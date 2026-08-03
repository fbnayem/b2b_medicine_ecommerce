import { UserRole } from '@medsupply/shared-types';

/**
 * Where each role lands after signing in.
 *
 * This exists because the answer was previously written inline in `Login.tsx`,
 * where it sent every `SHOP_OWNER` to `/shop` — a path no route has ever
 * declared. The catch-all matched it and redirected to `/login`, so a shop
 * owner who typed the right password was returned to the login form with no
 * error shown, and the web application was unusable for that entire role.
 *
 * A `Record` rather than a function body, so adding a role to the enum is a
 * compile error here rather than a silent fallback to somebody else's home
 * screen. That every entry currently reads `/dashboard` is a fact about the
 * dashboard — it branches by role internally — not a reason to collapse this;
 * the entries diverge as soon as each role gets its own landing screen.
 */
const LANDING_ROUTE: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: '/dashboard',
  [UserRole.ADMIN]: '/dashboard',
  [UserRole.MANAGER]: '/dashboard',
  [UserRole.STOREKEEPER]: '/dashboard',
  [UserRole.DELIVERY_PERSON]: '/dashboard',
  [UserRole.SHOP_OWNER]: '/dashboard',
};

export function landingRouteFor(role: UserRole): string {
  return LANDING_ROUTE[role] ?? '/dashboard';
}
