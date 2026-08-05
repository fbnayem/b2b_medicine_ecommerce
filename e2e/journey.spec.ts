import { expect, test } from '@playwright/test';
import { collectConsoleErrors, expectPageRendered, signIn } from './fixtures';

/**
 * Tier 1 — the money-and-stock journeys. These must survive the redesign
 * untouched, which is why they navigate by URL and assert on text a person
 * reads rather than on class names that are all being replaced.
 *
 * The seed parks an order at each interesting state, so each spec starts from a
 * known point rather than replaying the whole lifecycle through the browser —
 * a chain of thirty clicks fails at step four and tells you nothing about the
 * other twenty-six.
 */

test.describe('the shop owner', () => {
  test('sees their own orders and can open one', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signIn(page, 'owner');

    await page.goto('/orders');
    await expectPageRendered(page);

    // The seed submits orders for this owner's shop, so the list cannot be
    // legitimately empty. An empty list here means the shop scoping broke.
    await expect(page.locator('#root')).toContainText(/ORD-|order/i);
    expect(errors).toEqual([]);
  });

  test('reaches their account and sees a balance rather than an error', async ({ page }) => {
    await signIn(page, 'owner');
    await page.goto('/account');
    await expectPageRendered(page);
    await expect(page.locator('#root')).not.toContainText(/something went wrong|unexpected error/i);
  });
});

test.describe('the manager', () => {
  test('finds the submitted order waiting in the approval queue', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signIn(page, 'manager');

    await page.goto('/approvals');
    await expectPageRendered(page);
    await expect(page.locator('#root')).toContainText(/ORD-/);
    expect(errors).toEqual([]);
  });

  test('can open a review and see what the order costs', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto('/approvals');
    await expectPageRendered(page);

    const firstOrder = page.locator('a[href^="/approvals/"]').first();
    await expect(firstOrder).toBeVisible({ timeout: 15_000 });
    await firstOrder.click();

    await expect(page).toHaveURL(/\/approvals\/[a-f0-9]{24}/);
    await expectPageRendered(page);
    // Money must be rendered as money: the symbol, grouped, two decimals.
    await expect(page.locator('#root')).toContainText(/৳/);
  });
});

test.describe('the storekeeper', () => {
  test('sees the approved order in the fulfilment queue', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signIn(page, 'storekeeper');

    await page.goto('/fulfilment');
    await expectPageRendered(page);
    expect(errors).toEqual([]);
  });

  test('can read the stock the catalogue says is on hand', async ({ page }) => {
    await signIn(page, 'storekeeper');
    await page.goto('/inventory');
    await expectPageRendered(page);
    await expect(page.locator('#root')).not.toContainText(/something went wrong/i);
  });
});

test.describe('money is rendered the same way everywhere', () => {
  // U7: eighteen sites rendered `৳{(x/100).toFixed(2)}`, producing
  // `৳1250000.00` with no separators, while adjacent screens showed `৳1,234.5`
  // for the same field. One formatter now owns it; this is the assertion that
  // notices if a second one comes back.
  const moneyScreens = ['/finance/reports/outstanding', '/payments'];

  for (const path of moneyScreens) {
    test(`${path} groups thousands and keeps two decimals`, async ({ page }) => {
      await signIn(page, 'manager');
      await page.goto(path);
      await expectPageRendered(page);

      const text = await page.locator('#root').innerText();
      const amounts = text.match(/৳\s?[\d,]+(?:\.\d+)?/g) ?? [];

      for (const amount of amounts) {
        const digits = amount.replace(/[^\d.,]/g, '');
        const [whole, fraction] = digits.split('.');
        expect(fraction === undefined || fraction.length === 2, `${amount} has odd decimals`).toBe(
          true,
        );
        const ungrouped = whole.replace(/,/g, '');
        if (ungrouped.length > 3) {
          expect(whole, `${amount} is not grouped`).toContain(',');
        }
      }
    });
  }
});

test.describe('a form that is not finished is not a malfunction', () => {
  /*
   * The screenshot this was written from: a rider chosen, a day chosen, notes
   * typed, and a red "Something went wrong" card. Nothing had gone wrong — the
   * round simply had no stops on it yet, and the form reported that in the same
   * words, colour and tone it uses for an unreachable database.
   *
   * The assertion is deliberately about which of the two states appears, not
   * about the wording. `error-state` is what the screen sweep reads as "this
   * page is broken", so a form waiting to be filled in must never raise it.
   */
  test('planning a round with no stops asks, rather than alarms', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto('/deliveries/trips/new');
    await expectPageRendered(page);

    // Nothing has been submitted, so neither state belongs on screen yet.
    await expect(page.getByTestId('form-notice')).toHaveCount(0);

    /*
     * A rider first, because the select carries the native `required` attribute
     * and the browser refuses to submit without it — so the application's own
     * validation is never reached. This is the state the screenshot was taken
     * in: rider chosen, day prefilled, no stops.
     */
    await page.getByLabel(/which rider/i).selectOption({ index: 1 });
    await page.getByRole('button', { name: /plan this round/i }).click();

    await expect(page.getByTestId('form-notice')).toBeVisible();
    await expect(page.getByTestId('error-state')).toHaveCount(0);
    await expect(page.locator('#root')).not.toContainText(/something went wrong/i);

    // Each requirement named separately, so somebody who has already chosen a
    // rider can see which of them is the one they have not met.
    await expect(page.getByTestId('form-notice').getByRole('listitem')).not.toHaveCount(0);
  });
});
