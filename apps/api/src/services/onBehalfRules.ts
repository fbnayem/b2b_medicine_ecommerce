import { UserRole } from '@medsupply/shared-types';

/**
 * Who may place an order for a shop that is not theirs.
 *
 * `POST /orders/submit` and every draft route were `SHOP_OWNER`-only, so the
 * volume that actually arrives in this trade — by phone, by WhatsApp, through a
 * rep with a paper book — had no path into the system at all. Somebody was
 * signing in as the customer, or typing it in afterwards, and either way the
 * order book could not say who really placed it.
 *
 * Pure, so the rule can be proved without a database. It is the rule that
 * decides whose money moves.
 */

/** Roles that may place an order naming a shop other than their own. */
export const ON_BEHALF_ROLES: readonly UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.SALES,
];

export function canPlaceOnBehalf(role: UserRole): boolean {
  return ON_BEHALF_ROLES.includes(role);
}

/**
 * Whether this actor may act for this shop.
 *
 * **Empty territories means every territory.** Every user in the database has
 * none, and management is not territorial — so the restriction applies to the
 * people it was written for and to nobody else. A rep who has been given
 * territories is confined to them.
 *
 * A shop with no territory recorded is reachable only by somebody unrestricted:
 * "we do not know where this shop is" must not read as "anybody may sell to
 * it", because that is the direction a mistake here goes wrong.
 */
export function territoryPermits(
  actorTerritories: readonly string[] | undefined,
  shopTerritory: string | undefined | null,
): boolean {
  if (!actorTerritories || actorTerritories.length === 0) return true;
  if (!shopTerritory) return false;
  const wanted = shopTerritory.trim().toLowerCase();
  return actorTerritories.some((territory) => territory.trim().toLowerCase() === wanted);
}

export interface OnBehalfActor {
  role: UserRole;
  territories?: readonly string[];
}

/**
 * The single decision, with the reason it went the way it did.
 *
 * Returning a code rather than a boolean means the caller can tell "you are not
 * allowed to do this at all" from "not for that shop" — two refusals a rep
 * needs to distinguish, and two the audit record should not conflate.
 */
export type OnBehalfDecision =
  | { allowed: true }
  | { allowed: false; code: 'ROLE_CANNOT_ORDER_ON_BEHALF' | 'SHOP_OUTSIDE_TERRITORY' };

export function decideOnBehalf(
  actor: OnBehalfActor,
  shop: { territory?: string | null },
): OnBehalfDecision {
  if (!canPlaceOnBehalf(actor.role)) {
    return { allowed: false, code: 'ROLE_CANNOT_ORDER_ON_BEHALF' };
  }
  if (!territoryPermits(actor.territories, shop.territory)) {
    return { allowed: false, code: 'SHOP_OUTSIDE_TERRITORY' };
  }
  return { allowed: true };
}
