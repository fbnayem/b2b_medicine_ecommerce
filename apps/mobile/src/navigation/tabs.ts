import { MOBILE_TABS, NAV_BY_ID } from '@medsupply/navigation';
import { translatedOr, type Translate } from '@medsupply/i18n';
import { UserRole } from '@medsupply/shared-types';

/**
 * Which file in `app/(protected)/(tabs)/` serves each shared navigation id.
 *
 * The mapping is not the identity, and cannot be: the shared `payments` id
 * means "the money screen", which on web is a payments list and on mobile is
 * `finance-dashboard` — a summary built for a phone. Writing the map out is
 * what keeps the shared ids honest instead of forcing mobile to adopt web's
 * file names.
 */
export const TAB_ROUTE_FILE: Record<string, string> = {
  dashboard: 'dashboard',
  approvals: 'approvals',
  orders: 'orders',
  payments: 'finance-dashboard',
  settings: 'system-settings',
  analytics: 'analytics',
  fulfilment: 'fulfilment',
  'fulfilment-ready': 'ready',
  inventory: 'inventory',
  returns: 'returns',
  deliveries: 'deliveries',
  notifications: 'notifications',
  security: 'security',
  medicines: 'medicines',
  cart: 'cart',
  'shop-account': 'account',
};

export interface MobileTab {
  /** The shared navigation id. */
  id: string;
  /** The expo-router screen name, which is the file name without its extension. */
  name: string;
  title: string;
}

/** Every file that must exist under `(tabs)/`, whatever the signed-in role. */
export const ALL_TAB_FILES: readonly string[] = [
  ...new Set(
    Object.values(UserRole).flatMap((role) => MOBILE_TABS[role].map((id) => TAB_ROUTE_FILE[id])),
  ),
];

/**
 * The five tabs for a role, in order.
 *
 * `AGENTS.md` specifies exactly five per role, and `MOBILE_TABS` is a
 * fixed-length tuple so that count is a compile error rather than a rule
 * somebody remembers. A role with a sixth idea for a tab has to argue for it in
 * the shared package, where web can see the change too.
 *
 * The **titles come from the catalogue**, not from `nav.label`. The navigation
 * package is plain data because Metro imports it and it cannot depend on the
 * catalogue — which meant the five words present on every single screen of this
 * application stayed in English when the language was switched. That reads as
 * the switch being broken rather than as a translation gap, and it is the
 * first thing anybody sees.
 *
 * `t` is optional so a test or a boot path with no provider still gets the
 * English labels rather than five dotted paths.
 */
export function tabsFor(role: UserRole, t?: Translate): MobileTab[] {
  return MOBILE_TABS[role].map((id) => {
    const nav = NAV_BY_ID[id];
    const name = TAB_ROUTE_FILE[id];
    if (!nav || !name) {
      throw new Error(`Tab "${id}" for ${role} has no navigation entry or no screen file.`);
    }
    return { id, name, title: t ? translatedOr(t, `navItem.${id}`, nav.label) : nav.label };
  });
}
