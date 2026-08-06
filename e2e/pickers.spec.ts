import { expect, test, type Page } from '@playwright/test';
import { TEST_IDS, expectPageRendered, signIn } from './fixtures';

/**
 * Choosing a record, and making the one that is not there.
 *
 * Every form that picks a medicine, a supplier or a customer read **one
 * unpaged page** and said nothing about the rest — fifty suppliers, a hundred
 * medicines, a hundred shops — so past those counts a record simply could not
 * be chosen. And making the missing one meant leaving a form that neither
 * persists a draft nor warns before discarding one.
 *
 * These drive the two together, because they fail together: the reason you are
 * typing a name that finds nothing is usually that the record does not exist
 * yet, and the answer has to be reachable without losing the lines already
 * typed. That last assertion is the one that matters.
 *
 * Each run creates real records, so names carry the run's own stamp.
 */

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** Types into a `SearchPicker` and clicks the result whose text matches. */
async function search(page: Page, label: RegExp, term: string, choose: RegExp) {
  await page.getByRole('combobox', { name: label }).fill(term);
  await page.getByRole('option', { name: choose }).first().click();
}

test('a purchase order is raised with a supplier that did not exist when it started', async ({
  page,
}) => {
  await signIn(page, 'manager');
  await page.goto('/purchasing/orders/new');
  await expectPageRendered(page);

  /*
   * The line goes on first, deliberately. It is the work that used to be lost:
   * leaving to create a supplier discarded every line already typed, and no
   * form in this application warns before that happens.
   */
  await search(page, /medicine/i, 'Napa', /Napa/);
  await page.getByRole('textbox', { name: /how many/i }).fill('40');
  await page.getByRole('textbox', { name: /cost each/i }).fill('11.50');

  const mark = stamp();
  const supplier = `Padma Traders ${mark}`;

  /*
   * A term that matches nothing, and it has to be built rather than chosen.
   *
   * This used to type "Padma" and rely on the supplier table being empty —
   * true when the seed created no suppliers, and quietly false once it created
   * four and this spec's own earlier runs had left their "Padma Traders …"
   * behind. Worse, it passed either way: the picker rendered "No suppliers yet"
   * while the search was still in flight, so the assertion was reading a
   * message about a request that had not come back.
   *
   * The picker now says which of the two it means, and this asks a question
   * whose answer is genuinely nothing.
   */
  await page.getByRole('combobox', { name: /supplier/i }).fill(`Zzz-${mark}`);
  await expect(page.getByText(/no suppliers yet/i)).toBeVisible();

  await page.getByRole('button', { name: /add a supplier/i }).click();
  await expect(page.getByTestId(TEST_IDS.dialog)).toBeVisible();
  await page.getByRole('textbox', { name: /company name/i }).fill(supplier);
  await page.getByRole('textbox', { name: /^phone$/i }).fill('01711000111');
  await page.getByRole('button', { name: /add this supplier/i }).click();

  await expect(page.getByTestId(TEST_IDS.dialog)).toHaveCount(0);
  // Chosen, and named — the picker holds a term, so the choice has to be shown
  // somewhere that survives the term being cleared.
  await expect(page.getByText(`Chosen: ${supplier}`)).toBeVisible();

  // The assertion the whole feature exists for: the line is still there.
  await expect(page.getByText(/Chosen: Napa/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: /how many/i })).toHaveValue('40');

  await page.getByRole('button', { name: /raise this order/i }).click();
  await expect(page).toHaveURL(/\/purchasing\/orders\/[a-f0-9]{24}/);
  await expect(page.getByText(supplier).first()).toBeVisible();
});

test('a delivery address can be added while taking an order, which nothing could do', async ({
  page,
}) => {
  /*
   * A shop's addresses were written by the seed script and by nothing else —
   * no screen anywhere could append one — and **a customer with no address
   * cannot order at all**, because both order entry and checkout require one.
   *
   * **Signed in as a manager, deliberately.** This test used to sign in as an
   * administrator, and that is the only reason it passed: the form wrote
   * through `PATCH /shops/:id`, which admits administrators only, so every
   * manager and every sales representative — the two roles that actually take
   * orders — filled this in and got a 403. The button worked for exactly the
   * one role that never uses it, and the test proved it.
   */
  await signIn(page, 'manager');
  await page.goto('/orders/new');
  await expectPageRendered(page);

  await search(page, /customer/i, 'Shafin', /Shafin Pharmacy/);
  await expect(page.getByText('Chosen: Shafin Pharmacy')).toBeVisible();

  /*
   * The address the seed created, waited for rather than counted.
   *
   * A count taken here races the customer's own record arriving, and the point
   * of the assertion is not arithmetic — it is that this one is **still there**
   * afterwards, which is what distinguishes adding an address from replacing
   * the list with one.
   */
  const picker = page.getByRole('combobox', { name: /deliver to/i });
  await expect(picker.locator('option', { hasText: /Shafin Pharmacy/ })).toHaveCount(1);

  await page.getByRole('button', { name: /add an address/i }).click();
  await expect(page.getByTestId(TEST_IDS.dialog)).toBeVisible();

  const mark = stamp();
  await page.getByRole('textbox', { name: /what to call it/i }).fill(`Back godown ${mark}`);
  await page.getByRole('textbox', { name: /street address/i }).fill('14/B Bangla Motor');
  await page.getByRole('textbox', { name: /^city$/i }).fill('Dhaka');
  await page.getByRole('textbox', { name: /district/i }).fill('Dhaka');
  await page.getByRole('button', { name: /add this address/i }).click();

  await expect(page.getByTestId(TEST_IDS.dialog)).toHaveCount(0);
  // The new one is there and selected...
  await expect(picker.locator('option', { hasText: `Back godown ${mark}` })).toHaveCount(1);
  await expect(picker).toHaveValue(/^[a-f0-9]{24}$/);
  // ...and the one that was already there survived.
  await expect(picker.locator('option', { hasText: /Shafin Pharmacy/ })).toHaveCount(1);
});

test('a manager is not offered a customer they may not create', async ({ page }) => {
  // `POST /shops` is admins only, and a MANAGER reaches both screens that pick
  // a customer. An affordance that answers 403 is worse than none.
  await signIn(page, 'manager');
  await page.goto('/payments/new');
  await expectPageRendered(page);
  await expect(page.getByRole('combobox', { name: /which shop/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /add a shop/i })).toHaveCount(0);
});
