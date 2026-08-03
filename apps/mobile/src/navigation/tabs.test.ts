import { describe, expect, it } from 'vitest';
import { MOBILE_TABS, NAV_BY_ID } from '@medsupply/navigation';
import { UserRole } from '@medsupply/shared-types';
import { ALL_TAB_FILES, TAB_ROUTE_FILE, tabsFor } from './tabs';

/**
 * Expo Router is file-based, so most of what can go wrong with navigation is
 * "the file is not where the router expects it". That is exactly what a test
 * can check without a device — and it is the check that matters most here,
 * because sixteen screens were physically moved into `(tabs)/` and a single
 * one left behind would be a tab that opens nothing.
 *
 * These tests run on a workstation with no emulator, so they are not a
 * substitute for launching the application. They are the part that can be
 * automated, and `docs/PHASE_STATUS.md` says plainly what has not been.
 */

/**
 * The route files, enumerated by the bundler rather than by `node:fs`.
 *
 * This package's tsconfig deliberately excludes Node's type definitions — code
 * that ships to Hermes must not be able to reach the filesystem — and
 * `import.meta.glob` is the right tool anyway: it resolves at build time, so a
 * glob that matches nothing is visible here rather than at run time.
 */
const routeModules = import.meta.glob('../../app/**/*.tsx');

/**
 * Filtered rather than globbed per directory: `(tabs)` is a literal directory
 * name here, but parentheses are grouping syntax to a glob matcher, so
 * `app/(protected)/(tabs)/*.tsx` matches nothing at all — and a glob that
 * matches nothing produces an empty set that agrees with every assertion.
 * Found exactly that way.
 */
function screensDirectlyIn(directory: string): Set<string> {
  const marker = `/${directory}/`;
  return new Set(
    Object.keys(routeModules)
      .filter((file) => {
        const at = file.indexOf(marker);
        if (at === -1) return false;
        // Directly in, not in a group below it.
        return !file.slice(at + marker.length).includes('/');
      })
      .map((file) =>
        file
          .split('/')
          .pop()!
          .replace(/\.tsx$/, ''),
      )
      .filter((name) => name !== '_layout'),
  );
}

const TAB_SCREENS = screensDirectlyIn('(tabs)');
const PROTECTED_SCREENS = screensDirectlyIn('(protected)');

describe('the tab bar', () => {
  it('gives every role exactly five tabs', () => {
    for (const role of Object.values(UserRole)) {
      // The tuple type makes the count a compile error; this catches a tuple
      // that was widened by an edit.
      expect(tabsFor(role), `${role}`).toHaveLength(5);
    }
  });

  it('names a screen file that exists for every tab of every role', () => {
    const missing: string[] = [];
    for (const role of Object.values(UserRole)) {
      for (const tab of tabsFor(role)) {
        if (!TAB_SCREENS.has(tab.name)) {
          missing.push(`${role} → ${tab.id} expects (tabs)/${tab.name}.tsx`);
        }
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('declares every tab file the layout will register', () => {
    for (const name of ALL_TAB_FILES) {
      expect(TAB_SCREENS.has(name), `(tabs)/${name}.tsx is missing`).toBe(true);
    }
  });

  it('does not leave a moved screen behind in the parent directory', () => {
    // A file present in both places is served by whichever the router reaches
    // first, which is a coin toss nobody wants to debug.
    const duplicated = ALL_TAB_FILES.filter((name) => PROTECTED_SCREENS.has(name));
    expect(duplicated, `still in (protected)/: ${duplicated.join(', ')}`).toEqual([]);
  });

  it('maps only ids the shared navigation package knows', () => {
    for (const id of Object.keys(TAB_ROUTE_FILE)) {
      expect(NAV_BY_ID[id], `TAB_ROUTE_FILE has "${id}", navigation does not`).toBeDefined();
    }
  });

  it('never offers a role a tab it is not permitted to open', () => {
    const wrong: string[] = [];
    for (const role of Object.values(UserRole)) {
      for (const id of MOBILE_TABS[role]) {
        if (!NAV_BY_ID[id]?.roles.includes(role)) wrong.push(`${role} → ${id}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('starts every role on a tab, so the app opens somewhere useful', () => {
    for (const role of Object.values(UserRole)) {
      expect(tabsFor(role)[0].id).toBe('dashboard');
    }
  });
});
