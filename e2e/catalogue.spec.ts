import { expect, test, type Page } from '@playwright/test';
import { TEST_IDS, confirmAction, expectPageRendered, signIn, type RoleKey } from './fixtures';

/**
 * Managing a medicine from the page you look at it on.
 *
 * Four of the endpoints this exercises had never had a caller anywhere in the
 * product: changing a price, taking a line off the catalogue, correcting a
 * counted quantity and blocking a batch. So the value here is not that the
 * buttons render — it is that the round trip works and that **the change is
 * visible everywhere else without a reload**, which is the propagation
 * requirement made testable.
 *
 * The medicine is reached by clicking through from the list rather than by a
 * hard-coded id, so these also prove the link the catalogue draws.
 */

async function openFirstMedicine(page: Page) {
  await page.goto('/medicines');
  await expectPageRendered(page);
  // The product's own heading link. A bare `a[href^="/medicines/"]` picks up
  // "Add a medicine" first for anybody who may create one.
  const first = page.locator('h2 a[href^="/medicines/"]').first();
  const name = (await first.innerText()).trim();
  await first.click();
  await expect(page).toHaveURL(/\/medicines\/[a-f0-9]{24}/);
  await expectPageRendered(page);
  return name;
}

test.describe('a manager runs the catalogue', () => {
  test('changes the trade price, and the list shows the new one without a reload', async ({
    page,
  }) => {
    await signIn(page, 'manager');
    await openFirstMedicine(page);
    const url = page.url();

    /*
     * A price nobody would set by hand, so a stale render cannot coincidentally
     * match. Under the MRP of everything the seed creates.
     */
    const amount = '43.21';
    await page.getByRole('textbox', { name: /new price for a shop/i }).fill(amount);
    await page.getByRole('button', { name: /change the price/i }).click();
    await expect(page.getByTestId(TEST_IDS.toast)).toContainText(/43\.21/);

    // Grouped and stamped by the tenant's own currency, not a bare number.
    await expect(page.getByText(/৳\s?43\.21/).first()).toBeVisible();

    /*
     * The propagation requirement, stated as the user stated it: change it in
     * one place and it is right everywhere. The catalogue list is a different
     * cache entry under the same family prefix, and it is 30 seconds fresh — so
     * before this phase it would have rendered the old figure.
     */
    await page.goBack();
    await expectPageRendered(page);
    await expect(page.getByText(/৳\s?43\.21/).first()).toBeVisible();

    // Put it back, so a later spec reading the same seed row is not surprised.
    await page.goto(url);
    await page.getByRole('textbox', { name: /new price for a shop/i }).fill('95.00');
    await page.getByRole('button', { name: /change the price/i }).click();
    await expect(page.getByTestId(TEST_IDS.toast)).toContainText(/95\.00/);
  });

  test('takes a medicine off the catalogue and puts it back in the same test', async ({ page }) => {
    await signIn(page, 'manager');
    await openFirstMedicine(page);

    await confirmAction(page, async () => {
      await page.getByRole('button', { name: /take off the catalogue/i }).click();
    });
    await expect(page.getByText(/not available/i).first()).toBeVisible();

    // Relisted in the same test rather than in a cleanup hook: a failure
    // between the two would otherwise poison every later spec that reads the
    // catalogue, and a poisoned fixture is far harder to read than one failure.
    await confirmAction(page, async () => {
      await page.getByRole('button', { name: /put back on the catalogue/i }).click();
    });
    await expect(page.getByText(/available to order/i).first()).toBeVisible();
  });

  test('can reach the edit form, which nothing could open before', async ({ page }) => {
    await signIn(page, 'manager');
    await openFirstMedicine(page);
    await page.getByRole('link', { name: /^edit$/i }).click();
    await expect(page).toHaveURL(/\/medicines\/[a-f0-9]{24}\/edit/);
    // Filled from the record, not blank.
    await expect(page.getByRole('textbox', { name: /stock code/i })).not.toBeEmpty();
  });
});

test.describe('what the other roles are shown', () => {
  const cases: Array<{ as: RoleKey; sees: RegExp[]; doesNotSee: RegExp[] }> = [
    {
      as: 'storekeeper',
      sees: [/stock on hand/i, /book in stock/i],
      // Not a pricing reader and not a cost reader.
      doesNotSee: [/^price$/i, /what we pay/i, /change the price/i],
    },
    {
      as: 'owner',
      sees: [/about this medicine/i],
      doesNotSee: [/stock on hand/i, /^price$/i, /what we pay/i, /take off the catalogue/i],
    },
  ];

  for (const { as, sees, doesNotSee } of cases) {
    test(`${as} sees only what the server would serve them`, async ({ page }) => {
      await signIn(page, as);
      await openFirstMedicine(page);
      for (const pattern of sees) {
        await expect(page.getByText(pattern).first()).toBeVisible();
      }
      for (const pattern of doesNotSee) {
        await expect(page.getByText(pattern)).toHaveCount(0);
      }
      // A section that renders for somebody the API refuses shows an error
      // card rather than a section, which is the failure this guards.
      await expect(page.getByTestId(TEST_IDS.errorState)).toHaveCount(0);
    });
  }
});
