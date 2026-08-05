import { expect, test } from '@playwright/test';
import {
  ROLES,
  TEST_IDS,
  type RoleKey,
  collectConsoleErrors,
  expectPageRendered,
  signIn,
} from './fixtures';

/**
 * Under a minute, every push. The suite that would have caught the three
 * defects that reached a person before they reached a test:
 *
 *   - a blank white page, which returned 200 with an empty `#root`;
 *   - a dev server that could not start at all;
 *   - a shop owner sent to `/shop`, a route that does not exist, and bounced
 *     back to the login form with no error shown.
 *
 * It asserts what a person would notice, in the order they would notice it.
 */

test.describe('every role can sign in and reach a working screen', () => {
  for (const role of Object.keys(ROLES) as RoleKey[]) {
    test(`${ROLES[role].label} signs in and lands somewhere real`, async ({ page }) => {
      const errors = collectConsoleErrors(page);

      await signIn(page, role);

      // The whole of U1: a role whose landing route does not exist is returned
      // to the login form, looking to the user like a rejected password.
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page).not.toHaveURL(/\/unauthorized/);

      await expectPageRendered(page);

      // A rendered page that threw during render is not a working screen.
      expect(errors, `console errors on ${ROLES[role].label}'s landing page`).toEqual([]);
    });
  }
});

test('the login page renders before anyone has signed in', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/login');
  await expectPageRendered(page);
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  expect(errors).toEqual([]);
});

test('a wrong password is refused with a message rather than a blank screen', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ROLES.owner.email);
  await page.getByLabel(/password/i).fill('definitely-not-the-password');
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await expect(page).toHaveURL(/\/login/);
  // Something must be said. A silent failure is indistinguishable from the
  // routing defect above, which is precisely why that one survived.
  await expect(page.locator('#root')).toContainText(/invalid|incorrect|failed|wrong|denied/i, {
    timeout: 15_000,
  });
});

test('a signed-in session survives a page reload', async ({ page }) => {
  await signIn(page, 'manager');
  const landed = page.url();

  await page.reload();

  // B10: the web app had no session rehydration at all, so every reload,
  // new tab or crash signed the user out — mid-order, on a warehouse terminal.
  await expect(page).toHaveURL(landed);
  await expect(page).not.toHaveURL(/\/login/);
  await expectPageRendered(page);
});

test('a signed-out visitor is sent to the login form, not to a blank page', async ({ page }) => {
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/login/);
  await expectPageRendered(page);
});

/**
 * The front door.
 *
 * `/` had no route. Every one of the paths in the manifest is a sub-path, so
 * the origin itself fell through to the catch-all and said the page did not
 * exist — and it survived because every assertion in this suite types the path
 * it wants. `signIn` goes to `/login`; the screens sweep walks the manifest.
 * Nobody ever knocked on the front door.
 */
test('the bare address of the application opens the application', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/login$/);
  await expectPageRendered(page);
  await expect(page.getByTestId(TEST_IDS.page('not-found'))).toHaveCount(0);
});

test('a signed-in person who types the bare address lands on their own screen', async ({
  page,
}) => {
  await signIn(page, 'owner');

  await page.goto('/');

  /*
   * Waiting for the page to render before counting is load-bearing, not
   * tidiness. `SessionGate` shows "Restoring your session" while the refresh
   * cookie is redeemed, and during that moment the not-found landmark is
   * legitimately absent — so a bare `toHaveCount(0)` is satisfied instantly
   * and the assertion passes against an application that has no `/` route at
   * all. It did, until this comment was written.
   */
  await expectPageRendered(page);
  // Left the front door, rather than sitting on it with nothing behind it.
  await expect(page).not.toHaveURL(/\/$/);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByTestId(TEST_IDS.page('not-found'))).toHaveCount(0);
});

/**
 * The blank page itself, made impossible.
 *
 * Everything this application shows arrives through the module graph rooted at
 * `main.tsx` — the stylesheet and both language catalogues included. When that
 * graph fails to evaluate, `#root` is never touched and the browser paints
 * white with the reason in a console nobody has open. It has happened twice:
 * once on shared packages resolving to their CommonJS build, once on a dev
 * server holding a stale transform of the catalogue.
 *
 * Blocking every script request reproduces that exactly, and reproduces it the
 * same way against the dev server and the built bundle, which is why this sits
 * in the file both projects run.
 */
test('an application that cannot load says so instead of painting white', async ({ page }) => {
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'script' ? route.abort() : route.continue(),
  );

  await page.goto('/login');

  const boot = page.locator('#app-boot');
  await expect(boot).toContainText(/could not start/i);
  await expect(boot.getByRole('button', { name: /try again/i })).toBeVisible();
  // `#root` is still empty — that part is not fixable from here. What is fixed
  // is that the person is no longer looking at nothing.
  await expect(page.locator('#root')).toBeEmpty();
});

test('the boot screen gets out of the way once the application has started', async ({ page }) => {
  await page.goto('/login');
  await expectPageRendered(page);

  // Without this the test above would pass against a fallback that sits on top
  // of a perfectly working application and never yields to it.
  await expect(page.locator('#app-boot')).toHaveCount(0);
});
