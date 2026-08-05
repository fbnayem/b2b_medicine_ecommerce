import { expect, test, type Page, type Response } from '@playwright/test';
import { NAV_ITEMS, type NavItem } from '@medsupply/navigation';
import { ROLES, type RoleKey, TEST_IDS, expectPageRendered, signIn } from './fixtures';

/**
 * Tier 4 — every screen a role is offered actually works.
 *
 * This exists because of what the suite could not see. Four screens were
 * reported broken by hand; the real number was fourteen, and every automated
 * gate in the repository was green throughout:
 *
 *   - `smoke.spec.ts` asserts the page mounted. A page showing "Something went
 *     wrong" has mounted.
 *   - `expectPageRendered` asserts there are words on screen. An error card is
 *     words on screen.
 *   - `collectConsoleErrors` **filters out `Failed to load resource`** — which
 *     is precisely what a 404 API call and a broken image produce. That filter
 *     is right for what it was written for and it is why a 404-ing screen was
 *     invisible.
 *   - `accessibility.spec.ts` scans nine screens. None of the fourteen.
 *
 * So this asserts the two things a person would notice and nothing else did:
 * **no error card**, and **no failed request**. It walks `NAV_ITEMS` rather
 * than a hand-written list, so a screen added next month is covered the day it
 * is added and cannot be forgotten the way these were.
 */

/** Destinations with a path parameter need a real record and belong in a journey. */
const REACHABLE = NAV_ITEMS.filter((item) => !item.hidden && !item.path.includes(':'));

/** One role per item, so the sweep stays a sweep rather than a matrix. */
const ROLE_FOR: Record<string, RoleKey> = {
  SUPER_ADMIN: 'superadmin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  STOREKEEPER: 'storekeeper',
  DELIVERY_PERSON: 'rider',
  SHOP_OWNER: 'owner',
};

function firstRoleFor(item: NavItem): RoleKey | undefined {
  for (const role of item.roles) {
    const key = ROLE_FOR[role];
    if (key) return key;
  }
  return undefined;
}

/**
 * Records failed responses for requests this application made.
 *
 * Deliberately not `collectConsoleErrors`. A 401 is excluded because the
 * session-restore call legitimately fails before the refresh cookie is
 * redeemed, and a 404 from a *record* lookup is a real answer on a detail
 * screen — but these are all list screens reached from the menu, so a 404 here
 * means the address is not served.
 */
function collectFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on('response', (response: Response) => {
    const url = response.url();
    if (!/\/api\/v1\/|\/media\//.test(url)) return;
    const status = response.status();
    if (status < 400 || status === 401) return;
    failures.push(`${status} ${response.request().method()} ${new URL(url).pathname}`);
  });
  return failures;
}

/** Every `<img>` that drew nothing. This is the broken catalogue, exactly. */
async function brokenImages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.images]
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => image.getAttribute('src') ?? '(no src)'),
  );
}

test.describe('every screen on the menu opens', () => {
  for (const item of REACHABLE) {
    const role = firstRoleFor(item);
    if (!role) continue;

    test(`${item.path} as ${ROLES[role].label}`, async ({ page }) => {
      const failures = collectFailures(page);
      await signIn(page, role);
      await page.goto(item.path);
      await expectPageRendered(page);

      /*
       * Wait for the screen to finish loading before asserting anything about
       * it. This is not defensive padding — the first version of this spec went
       * straight to `toHaveCount(0)` and **passed with the defect planted**,
       * because an assertion that something is absent is satisfied instantly
       * while the request that would produce it is still in flight. A gate that
       * cannot fail is the exact problem this file was written about, so it is
       * worth saying twice.
       */
      await page.waitForLoadState('networkidle');

      await expect(page.getByTestId(TEST_IDS.errorState)).toHaveCount(0);

      expect(
        failures,
        `${item.path} made requests the server refused. A 404 here is not a missing record — ` +
          'it is an address this build of the client asks for and this build of the server ' +
          'does not serve.',
      ).toEqual([]);

      expect(
        await brokenImages(page),
        `${item.path} rendered an image that drew nothing — the browser's broken-image glyph.`,
      ).toEqual([]);
    });
  }
});

test('the sweep covers the whole menu, so a clean run is not an empty one', () => {
  // A filter that quietly matched nothing would make every test above vanish
  // and the run would still be green — which is the shape of the problem this
  // file exists to catch.
  expect(REACHABLE.length).toBeGreaterThan(25);
  expect(REACHABLE.map((item) => item.path)).toContain('/deliveries/trips');
  expect(REACHABLE.map((item) => item.path)).toContain('/pricing/schemes');
});
