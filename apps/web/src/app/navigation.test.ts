import { UserRole } from '@medsupply/shared-types';
import {
  MOBILE_TABS,
  NAV_BY_ID,
  NAV_ITEMS,
  breadcrumbFor,
  landingRouteFor,
  navItemsFor,
} from '@medsupply/navigation';
import { describe, expect, it } from 'vitest';
import { ROUTES, resolvedRoutes } from './routes';

/**
 * The manifest is now the single description of what exists and who may see
 * it, so these are the assertions that keep it honest. They replace
 * `landing.test.ts`, which parsed `App.tsx` for `path="…"` literals — a
 * reasonable thing to do when the paths were written there, and meaningless
 * now that they are not. `docs/TESTING.md` budgets navigation tests as the tier
 * the shell work rewrites; this is that rewrite.
 */

describe('sign-in landing routes', () => {
  it('sends every role to a route that actually exists', () => {
    const paths = new Set(NAV_ITEMS.map((item) => item.path));
    const broken = Object.values(UserRole)
      .map((role) => ({ role, path: landingRouteFor(role) }))
      .filter(({ path }) => !paths.has(path));

    // `Login.tsx` sent shop owners to `/shop`, which no route ever declared.
    // The catch-all matched it and returned them to the sign-in form, so the
    // entire role was locked out and it looked like a rejected password.
    expect(broken).toEqual([]);
  });

  it('no longer points anyone at the path that did not exist', () => {
    expect(Object.values(UserRole).map(landingRouteFor)).not.toContain('/shop');
  });
});

describe('the route manifest', () => {
  it('gives every route a navigation entry, so nothing is reachable by default', () => {
    // `resolvedRoutes` throws on a route with no entry. A route with no entry
    // has no declared roles, and a route with no declared roles would be open
    // to everybody.
    expect(() => resolvedRoutes()).not.toThrow();
    expect(resolvedRoutes()).toHaveLength(ROUTES.length);
  });

  it('declares a component for every visible navigation item', () => {
    const withComponents = new Set(ROUTES.map((route) => route.id));
    const orphaned = NAV_ITEMS.filter((item) => !item.hidden && !withComponents.has(item.id)).map(
      (item) => item.id,
    );

    // A sidebar entry with no route behind it is a link to nowhere — which is
    // what the dashboard tile grid had been growing.
    expect(orphaned).toEqual([]);
  });

  it('uses each path exactly once', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const route of resolvedRoutes()) {
      const existing = seen.get(route.nav.path);
      if (existing) collisions.push(`${route.nav.path}: ${existing} and ${route.id}`);
      seen.set(route.nav.path, route.id);
    }
    expect(collisions).toEqual([]);
  });

  it('gives every route a unique id', () => {
    const ids = ROUTES.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('role permissions', () => {
  it('gives every role something to do', () => {
    for (const role of Object.values(UserRole)) {
      const items = navItemsFor(role);
      // A delivery person could reach 7 of 51 routes and had one work-related
      // tile on the dashboard — their actual job existed only on mobile.
      expect(items.length, `${role} has ${items.length} navigation items`).toBeGreaterThanOrEqual(
        4,
      );
    }
  });

  it('lets a delivery person open the deliveries they are assigned', () => {
    const paths = navItemsFor(UserRole.DELIVERY_PERSON).map((item) => item.path);
    expect(paths).toContain('/deliveries');
  });

  it('keeps administration away from shop owners and riders', () => {
    for (const role of [UserRole.SHOP_OWNER, UserRole.DELIVERY_PERSON, UserRole.STOREKEEPER]) {
      const paths = navItemsFor(role).map((item) => item.path);
      expect(paths).not.toContain('/admin/settings');
      expect(paths).not.toContain('/admin/audit');
      expect(paths).not.toContain('/shops');
    }
  });

  it('never shows one role two sidebar entries with the same words on them', () => {
    // Found by the browser suite: "Stock" appeared twice for a storekeeper —
    // once for the stock screen and once for the stock report. Two identical
    // labels in a sidebar is a coin toss for somebody who is not going to read
    // the group heading above them.
    const duplicated: string[] = [];
    for (const role of Object.values(UserRole)) {
      const labels = navItemsFor(role).map((item) => item.label);
      const seen = new Set<string>();
      for (const label of labels) {
        if (seen.has(label)) duplicated.push(`${role}: "${label}"`);
        seen.add(label);
      }
    }
    expect(duplicated).toEqual([]);
  });

  it('never shows a shop owner another shop’s ledger', () => {
    const ledger = NAV_BY_ID['shop-ledger'];
    expect(ledger.roles).not.toContain(UserRole.SHOP_OWNER);
  });
});

describe('mobile tabs', () => {
  it('names five real destinations for every role', () => {
    for (const role of Object.values(UserRole)) {
      const tabs = MOBILE_TABS[role];
      // The tuple type makes the count a compile error; this catches a tab
      // pointing at an id that does not exist.
      expect(tabs).toHaveLength(5);
      for (const id of tabs) {
        expect(NAV_BY_ID[id], `${role} has a tab for unknown id "${id}"`).toBeDefined();
      }
    }
  });

  it('only offers a role tabs it is permitted to open', () => {
    const wrong: string[] = [];
    for (const role of Object.values(UserRole)) {
      for (const id of MOBILE_TABS[role]) {
        if (!NAV_BY_ID[id]?.roles.includes(role)) wrong.push(`${role} → ${id}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('breadcrumbs', () => {
  it('walks parents by id rather than by path prefix', () => {
    // `/shops/:shopId/ledger` sits under Shops, which no amount of arithmetic
    // on the path would work out — and `/returns/new` is not under `/returns/:id`.
    const trail = breadcrumbFor('shop-ledger').map((item) => item.id);
    expect(trail).toEqual(['shops', 'shop-ledger']);
  });

  it('terminates on every route, including any that name a missing parent', () => {
    for (const route of ROUTES) {
      const trail = breadcrumbFor(route.id);
      expect(trail.at(-1)?.id).toBe(route.id);
      expect(trail.length).toBeLessThanOrEqual(4);
    }
  });
});
