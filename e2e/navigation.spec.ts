import { expect, test } from '@playwright/test';
import { ROLES, type RoleKey, TEST_IDS, expectPageRendered, signIn } from './fixtures';

/**
 * Tier 3 — the shell.
 *
 * `docs/TESTING.md` budgets this tier as the one the redesign rewrites, and
 * this is what replaced the version written against the old three-item utility
 * bar. It asserts the two claims the shell exists to make: that every role can
 * reach its own work **without passing through the dashboard**, and that a
 * theme change actually reaches nested elements.
 */

test.describe('role-aware navigation', () => {
  const EXPECTED: Record<RoleKey, string[]> = {
    superadmin: ['Approvals', 'Shops', 'Settings', 'Audit log'],
    admin: ['Approvals', 'Shops', 'Settings'],
    manager: ['Approvals', 'Payments', 'Shops'],
    storekeeper: ['Picking', 'Stock', 'Deliveries'],
    // The whole of U10: this role could reach seven of fifty-one routes and
    // could not open the delivery board — its own job — on the web at all.
    rider: ['Deliveries', 'Returns'],
    owner: ['Orders', 'Cart', 'My account'],
  };

  for (const role of Object.keys(EXPECTED) as RoleKey[]) {
    test(`${ROLES[role].label} sees their own sections in the sidebar`, async ({ page }) => {
      await signIn(page, role);

      const sidebar = page.getByTestId(TEST_IDS.sidebar);
      await expect(sidebar).toBeVisible();

      for (const label of EXPECTED[role]) {
        await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeVisible();
      }
    });
  }

  test('a shop owner is never offered administration', async ({ page }) => {
    await signIn(page, 'owner');
    const sidebar = page.getByTestId(TEST_IDS.sidebar);
    for (const forbidden of ['Settings', 'Audit log', 'Shops', 'People']) {
      await expect(sidebar.getByRole('link', { name: forbidden, exact: true })).toHaveCount(0);
    }
  });

  test('moving between sections does not pass through the dashboard', async ({ page }) => {
    await signIn(page, 'storekeeper');

    const sidebar = page.getByTestId(TEST_IDS.sidebar);
    await sidebar.getByRole('link', { name: 'Picking', exact: true }).click();
    await expect(page).toHaveURL(/\/fulfilment$/);

    await sidebar.getByRole('link', { name: 'Stock', exact: true }).click();
    await expect(page).toHaveURL(/\/inventory$/);

    // Every move used to return to the tile grid first, because the tile grid
    // was the only navigation there was.
    expect(page.url()).not.toContain('/dashboard');
  });

  test('the shell offers a sign-out that works', async ({ page }) => {
    await signIn(page, 'manager');
    await page.getByTestId(TEST_IDS.accountMenu).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('search jumps straight to a section', async ({ page }) => {
    await signIn(page, 'manager');
    await page.getByTestId(TEST_IDS.search).fill('appro');
    await page
      .getByRole('link', { name: /Approvals/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/approvals$/);
  });

  test('a deep page shows where it sits', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/shops');
    const firstShop = page.locator('a[href^="/shops/"]').first();
    await expect(firstShop).toBeVisible({ timeout: 15_000 });
    await firstShop.click();

    /*
     * By test id, not by accessible name. This asserted
     * `{ name: 'Breadcrumb' }` and had been failing since the label began
     * coming from the catalogue — it reads "Where you are" in English, and
     * something else again in Bangla. `docs/TESTING.md` bans `getByText` for
     * translatable strings; an accessible name built from one is the same
     * thing wearing a different hat.
     */
    const crumbs = page.getByTestId(TEST_IDS.breadcrumb);
    await expect(crumbs).toBeVisible();
    await expect(crumbs).toContainText('Shops');
  });

  test('an unknown address says so instead of returning to the login form', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto('/this-page-does-not-exist');

    // The catch-all used to redirect to `/login`, which is exactly how the
    // shop-owner lockout stayed invisible: a wrong address and a rejected
    // password produced the same screen.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('#root')).toContainText(/does not exist/i);
  });
});

test.describe('dark mode', () => {
  test('reaches nested elements, not only the shell', async ({ page }) => {
    await signIn(page, 'manager');

    const readBackground = () =>
      page.evaluate(() => {
        const nested = document.querySelector('#main');
        return nested ? getComputedStyle(nested).color : '';
      });

    const light = await readBackground();

    await page.getByTestId(TEST_IDS.accountMenu).click();
    await page.getByRole('menuitemcheckbox', { name: /dark/i }).click();
    await page.keyboard.press('Escape');

    await expect(page.locator('html')).toHaveClass(/dark/);
    const dark = await readBackground();

    // This is the `@theme inline` trap made into an assertion. Without
    // `inline`, Tailwind resolves each var() once at :root, so the shell turns
    // dark and every nested element keeps the light value — a page that looks
    // half-themed with no obvious cause.
    expect(dark, 'a nested element kept its light colour in dark mode').not.toBe(light);
  });

  test('the choice survives a reload', async ({ page }) => {
    await signIn(page, 'manager');
    await page.getByTestId(TEST_IDS.accountMenu).click();
    await page.getByRole('menuitemcheckbox', { name: /dark/i }).click();
    await page.keyboard.press('Escape');

    await page.reload();
    await expectPageRendered(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});
