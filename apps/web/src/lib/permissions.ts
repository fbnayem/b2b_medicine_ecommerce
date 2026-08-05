import { UserRole } from '@medsupply/shared-types';

/**
 * What this browser may show, mirroring what the server will allow.
 *
 * Six predicates, named after the six role sets the API actually enforces. Not
 * a permissions framework — a framework here would be a second source of truth
 * about authorisation, and the only source of truth is `requireRole(...)` in
 * `apps/api/src/routes/*`.
 *
 * These exist because the ad-hoc version was wrong. `MedicineDetail` decided
 * whether to show stock with `role !== SHOP_OWNER`, which is a statement about
 * one role rather than about the set the server checks — and the moment `SALES`
 * was allowed onto that page, the predicate answered `true` for somebody the
 * server's `stockReaders` excludes. A screen asking for something it will be
 * refused is not a permissions bug; it is an error card in front of a user who
 * did nothing wrong.
 *
 * The rule when adding one: copy the server's set, name it after the server's
 * set, and put the route file it came from in the comment.
 */

type Role = UserRole | undefined;

const has = (roles: readonly UserRole[], role: Role): boolean =>
  role !== undefined && roles.includes(role);

/** `catalogueReaders` — `inventoryRoutes.ts`. Everyone but a rider. */
const CATALOGUE_READERS = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STOREKEEPER,
  UserRole.SHOP_OWNER,
  UserRole.SALES,
] as const;

/** `catalogueManagers` — `inventoryRoutes.ts`. Also `COST_ROLES` in its controller. */
const CATALOGUE_MANAGERS = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER] as const;

/** `stockReaders` and `stockOperators` — `inventoryRoutes.ts`. Identical sets. */
const STOCK_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STOREKEEPER,
] as const;

/** `readers` — `pricingRoutes.ts`. A rep quotes, so a rep reads. */
const PRICING_READERS = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.SALES,
] as const;

export const canReadCatalogue = (role: Role) => has(CATALOGUE_READERS, role);

/** Add, amend or delist a catalogue line. */
export const canEditCatalogue = (role: Role) => has(CATALOGUE_MANAGERS, role);

/** See batches, quantities and stock movements. */
export const canSeeStock = (role: Role) => has(STOCK_ROLES, role);

/** Receive stock and record a movement against a batch. */
export const canOperateStock = (role: Role) => has(STOCK_ROLES, role);

/**
 * Correct a count or block a batch.
 *
 * Deliberately narrower than `canOperateStock`, and the server agrees: an
 * ordinary movement is part of a storekeeper's day, while overwriting the
 * counted quantity or taking a batch out of circulation is a decision somebody
 * answers for.
 */
export const canAdjustStock = (role: Role) => has(CATALOGUE_MANAGERS, role);

/** Read price lists and offers. */
export const canSeeCommercial = (role: Role) => has(PRICING_READERS, role);

/** Set a price list or an offer. */
export const canEditCommercial = (role: Role) => has(CATALOGUE_MANAGERS, role);

/**
 * See what a product cost us.
 *
 * `hideCosts` in `inventoryController.ts` strips `costPriceMinor` from every
 * medicine and batch read for anybody outside this set, so a screen that shows
 * the field to somebody else renders an empty value rather than leaking one —
 * but an empty labelled row is still a worse answer than no row.
 */
export const canSeeCost = (role: Role) => has(CATALOGUE_MANAGERS, role);

/**
 * Which accounts this person may bring into existence.
 *
 * `assertAdministrable` in `userAdminService.ts` is the authority; this says
 * the same thing so the form can offer the right options and hide the button
 * entirely when the list is empty. An empty list is a real answer — a
 * storekeeper, a rider, a rep and a shop owner staff nobody.
 *
 * A manager gets exactly the two warehouse-side roles. Never MANAGER, ADMIN or
 * SUPER_ADMIN: those could go on to create further accounts, and that is the
 * limit that makes the widening defensible at all.
 */
export function creatableRoles(role: Role): readonly UserRole[] {
  switch (role) {
    case UserRole.SUPER_ADMIN:
      return Object.values(UserRole);
    case UserRole.ADMIN:
      // Everything but the two the server calls privileged.
      return Object.values(UserRole).filter(
        (candidate) => candidate !== UserRole.SUPER_ADMIN && candidate !== UserRole.ADMIN,
      );
    case UserRole.MANAGER:
      return [UserRole.DELIVERY_PERSON, UserRole.STOREKEEPER];
    default:
      return [];
  }
}

/** Whether to draw an "Add a person" affordance at all. */
export const canAddPeople = (role: Role) => creatableRoles(role).length > 0;
