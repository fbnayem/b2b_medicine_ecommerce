import { expect, test } from '@playwright/test';
import { ROLES, type RoleKey, collectConsoleErrors, expectPageRendered, signIn } from './fixtures';

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
