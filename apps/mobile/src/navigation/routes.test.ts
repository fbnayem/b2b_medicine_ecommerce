import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, navItemsFor } from '@medsupply/navigation';
import { UserRole } from '@medsupply/shared-types';
import { MOBILE_ROUTE, NO_MOBILE_SCREEN, destinationsFor, reachable } from './routes';

/**
 * **Every destination the shared manifest permits is either on this client or
 * written down as missing.**
 *
 * The defect is the one `callers.test.ts` catches at the endpoint layer, one
 * level up: a screen can exist on the server and on web, be permitted to a
 * role, and simply have no way in on the phone. Nothing failed. The home screen
 * filtered its menu through `TAB_ROUTE_FILE` — the seventeen files that are a
 * *tab* for somebody — so a manager permitted 35 destinations was offered 13,
 * and the other 22 had no file, no route and no mention anywhere.
 *
 * A percentage would not have caught it either. Every test passed, every screen
 * that existed worked, and the missing ones were missing in the way an unwritten
 * screen is missing: silently.
 *
 * So this is a **list that counts down**. `NO_MOBILE_SCREEN` names what is not
 * built, the floor below stops it growing, and each slice of this phase empties
 * some of it.
 */

/** Every file under `app/`, read through Vite rather than `node:fs`. */
const SCREENS = import.meta.glob('../../app/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `/(protected)/stocktakes?kind=x` → `../../app/(protected)/stocktakes.tsx`. */
function fileFor(route: string): string {
  return `../../app${route.replace(/\?.*$/, '')}.tsx`;
}

const FILES = new Set(Object.keys(SCREENS));

/**
 * The size `NO_MOBILE_SCREEN` may not exceed.
 *
 * Lowered by each slice, never raised. A number rather than a comment because a
 * waiver list with no ceiling is a to-do list, and a to-do list in a test file
 * is a place regressions go to be forgotten.
 */
const WAIVER_FLOOR = 28;

describe('every destination a role may reach', () => {
  it('found the screens to search, so a clean run is not an empty one', () => {
    // A glob matching nothing would satisfy the file check below in silence,
    // which is exactly the shape of gate this file exists to replace.
    expect(FILES.size).toBeGreaterThan(30);
    expect(Object.keys(MOBILE_ROUTE).length).toBeGreaterThan(20);
  });

  it('is either reachable on this client or named as missing', () => {
    const unaccounted: string[] = [];
    for (const role of Object.values(UserRole)) {
      for (const item of navItemsFor(role)) {
        if (item.hidden || item.id === 'dashboard') continue;
        if (MOBILE_ROUTE[item.id] || NO_MOBILE_SCREEN.has(item.id)) continue;
        unaccounted.push(`${item.id} (${item.label}) — permitted to ${role}`);
      }
    }

    expect(
      [...new Set(unaccounted)],
      'The shared manifest says these roles may reach these screens, and this client has ' +
        'neither a route for them nor an entry in NO_MOBILE_SCREEN saying so. A destination ' +
        'that is missing without being written down is missing silently:\n  ' +
        unaccounted.join('\n  '),
    ).toEqual([]);
  });

  it('goes somewhere that exists', () => {
    const broken = Object.entries(MOBILE_ROUTE)
      .filter(([id]) => !NO_MOBILE_SCREEN.has(id))
      .filter(([, route]) => !FILES.has(fileFor(route)))
      .map(([id, route]) => `${id} → ${route} (no ${fileFor(route).replace('../../', '')})`);

    expect(
      broken,
      'These routes name a screen file that does not exist. Pushing one is a blank screen ' +
        'with a back button, which reads as the application being broken rather than as a ' +
        'missing feature:\n  ' +
        broken.join('\n  '),
    ).toEqual([]);
  });

  it('names only ids the shared manifest actually has', () => {
    // A typo in either map is otherwise a destination that quietly never
    // appears — the same failure, wearing a spelling mistake.
    const known = new Set(NAV_ITEMS.map((item) => item.id));
    const unknown = [...Object.keys(MOBILE_ROUTE), ...NO_MOBILE_SCREEN].filter(
      (id) => !known.has(id),
    );
    expect(unknown).toEqual([]);
  });

  it('has a waiver list that only ever shrinks', () => {
    expect(
      NO_MOBILE_SCREEN.size,
      `NO_MOBILE_SCREEN has grown to ${NO_MOBILE_SCREEN.size}. It is allowed to shrink as ` +
        'screens are built and never to grow: a new entry means a destination somebody could ' +
        'reach yesterday and cannot today.',
    ).toBeLessThanOrEqual(WAIVER_FLOOR);
  });
});

/**
 * What the home screen offers, which is the half a person actually experiences.
 * The map above can be perfect while the menu still filters it away, and that is
 * precisely what happened.
 */
describe('the menu offers what the role is permitted', () => {
  it('shows a manager everything built, not only the tabs', () => {
    const offered = destinationsFor(UserRole.MANAGER);
    const permitted = navItemsFor(UserRole.MANAGER).filter(
      (item) => !item.hidden && item.id !== 'dashboard',
    );

    /*
     * The original count was 13 of 34 — the thirteen that happened to be a tab
     * for some role. Anything at or near that number means the tab filter is
     * back, however it is spelt.
     */
    expect(offered.length).toBeGreaterThan(13);
    expect(offered.length).toBe(permitted.filter((item) => reachable(item.id)).length);
    // A destination that is not a tab for anybody, so a tab-shaped filter
    // cannot pass this by accident.
    expect(offered.map((item) => item.id)).toContain('collections');
  });

  it('never offers a destination with no screen behind it', () => {
    for (const role of Object.values(UserRole)) {
      for (const item of destinationsFor(role)) {
        expect(NO_MOBILE_SCREEN.has(item.id), `${role} is offered ${item.id}`).toBe(false);
        expect(FILES.has(fileFor(MOBILE_ROUTE[item.id]!)), `${role} → ${item.id}`).toBe(true);
      }
    }
  });

  it('leaves out the screen it is rendered on, and the ones reached from a list', () => {
    const owner = destinationsFor(UserRole.SHOP_OWNER).map((item) => item.id);
    expect(owner).not.toContain('dashboard');
    // `order-detail` is hidden: it belongs under the orders that lead to it, not
    // in a menu offering "Order" with no order in mind.
    expect(owner).not.toContain('order-detail');
  });
});
