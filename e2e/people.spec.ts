import { expect, test } from '@playwright/test';
import { TEST_IDS, expectPageRendered, signIn } from './fixtures';

/**
 * Adding somebody without losing what you were doing.
 *
 * `POST /api/v1/users` has worked, been documented and been covered by an
 * integration test since phase 22, and had never had a caller: no page, no
 * route, no form. Riders, storekeepers and administrators existed because the
 * seed script made them.
 *
 * The first test below is the whole argument for the feature, and its load-
 * bearing assertion is not that the person is created — it is that **the stops
 * already chosen for the round are still there afterwards.** No form in this
 * application persists a draft or warns before discarding one, so "go and
 * create the thing you need, then come back" costs the entire ordered stop
 * list. That is unrecoverable work, not an inconvenience.
 *
 * Each run creates a real account, so the email carries the run's own stamp:
 * a fixed one would pass once and then collide with itself forever.
 */

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

test('a rider can be added from the round-planning form without losing the stops', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await page.goto('/deliveries/trips/new');
  await expectPageRendered(page);

  /*
   * A rider must be chosen first: the plannable list is scoped to one, so
   * there is nothing to add to the round until then. This is the state the
   * screenshot that started this work was taken in.
   */
  const picker = page.getByLabel('Which rider', { exact: false });
  const seeded = picker.locator('option').nth(1);
  await picker.selectOption((await seeded.getAttribute('value')) ?? '');

  /*
   * Work in progress that costs something to lose. The seeded database has no
   * plannable delivery to add as a stop, so the round's other fields stand in
   * for the stop list — they are discarded by exactly the same navigation, and
   * unlike the stops they exist on every run.
   */
  await page.getByRole('textbox', { name: /vehicle/i }).fill('DHA-METRO-KHA-11-2233');
  await page.getByRole('textbox', { name: /notes for the rider/i }).fill('Collect the cold box.');

  await page.getByRole('button', { name: /add a delivery person/i }).click();
  await expect(page.getByTestId(TEST_IDS.dialog)).toBeVisible();

  const mark = stamp();
  await page.getByRole('textbox', { name: 'First name' }).fill('Rana');
  await page.getByRole('textbox', { name: 'Last name' }).fill(`Driver${mark}`);
  await page.getByRole('textbox', { name: 'Email' }).fill(`rana.${mark}@medsupply.local`);
  await page.locator('input[type="password"]').fill('E2ePassw0rd!added');
  await page.getByRole('button', { name: 'Add this person' }).click();

  // The dialog closes, the new person is selected, and the picker knows them —
  // which needs the rider family invalidated and awaited, not just refetched.
  await expect(page.getByTestId(TEST_IDS.dialog)).toHaveCount(0);
  await expect(picker).toHaveValue(/^[a-f0-9]{24}$/);
  await expect(picker.locator('option', { hasText: `Rana Driver${mark}` })).toHaveCount(1);

  /*
   * The assertion the feature exists for.
   *
   * Before this, creating a rider meant leaving — and no form in this
   * application persists a draft or warns before discarding one, so everything
   * typed here was gone. Nothing navigated, and what was typed is still typed.
   */
  await expect(page).toHaveURL(/\/deliveries\/trips\/new/);
  await expect(page.getByRole('textbox', { name: /vehicle/i })).toHaveValue(
    'DHA-METRO-KHA-11-2233',
  );
  await expect(page.getByRole('textbox', { name: /notes for the rider/i })).toHaveValue(
    'Collect the cold box.',
  );
});

test('a manager may staff the warehouse, and the form offers them only that', async ({ page }) => {
  await signIn(page, 'manager');
  await page.goto('/admin/users/new');
  await expectPageRendered(page);

  /*
   * A manager gets exactly the two warehouse-side roles. Anything that could
   * go on to create further accounts is absent — and absent rather than
   * disabled, because an option that is refused on submit tells somebody the
   * product can do something for them that it will not.
   */
  const role = page.getByRole('combobox', { name: 'What they do' });
  await expect(role.locator('option')).toHaveCount(2);
  await expect(role.locator('option', { hasText: 'Delivery person' })).toHaveCount(1);
  await expect(role.locator('option', { hasText: 'Storekeeper' })).toHaveCount(1);
  await expect(role.locator('option', { hasText: 'Administrator' })).toHaveCount(0);
  await expect(role.locator('option', { hasText: 'Manager' })).toHaveCount(0);

  const mark = stamp();
  await page.getByRole('textbox', { name: 'First name' }).fill('Store');
  await page.getByRole('textbox', { name: 'Last name' }).fill(`Keeper${mark}`);
  await page.getByRole('textbox', { name: 'Email' }).fill(`store.${mark}@medsupply.local`);
  await page.locator('input[type="password"]').fill('E2ePassw0rd!added');
  await role.selectOption('STOREKEEPER');
  await page.getByRole('button', { name: 'Add this person' }).click();

  // Straight to the directory, with the new person on it.
  await expect(page).toHaveURL(/\/admin\/users/);
  await expect(page.getByText(`Keeper${mark}`).first()).toBeVisible();
});

test('a storekeeper is never offered a way to add anybody', async ({ page }) => {
  await signIn(page, 'storekeeper');
  // Not on the menu, and refused on the way in — the manifest and the server
  // agree, which is the pair that has disagreed before.
  await page.goto('/admin/users/new');
  await expect(page.getByRole('button', { name: 'Add this person' })).toHaveCount(0);
});
