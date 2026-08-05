import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { type RoleKey, signIn } from './fixtures';

/**
 * The automated accessibility floor, held at zero.
 *
 * This was written expecting to fail — U12 records three `:focus-visible`
 * rules in the whole application, no `aria-live` regions at all, a dialog with
 * no focus trap and around fifteen unlabelled controls. It passes, and the
 * honest reading is that **axe measures a different thing**: it catches
 * contrast, names, roles, landmarks and duplicate ids, and it cannot see a
 * missing focus trap, a keyboard trap, an absent live region or a 28px tap
 * target. Those remain open and are phase 3 and phase 5 work.
 *
 * What this does buy is a regression gate over the part axe *can* see, held at
 * zero from before the redesign starts — so a Tailwind rebuild that drops a
 * label or lands grey-on-grey fails the build rather than shipping. The one
 * violation it found on its first run was real: the login form's fields had no
 * programmatic label.
 *
 * Every role's landing page is the same dashboard, so scanning six roles is one
 * screen six times. The distinct screens below are scanned as well.
 */

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

async function scan(page: import('@playwright/test').Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags([...RULES]).analyze();
  const summary = results.violations
    .map(
      (violation) =>
        `${violation.id} × ${violation.nodes.length} — ${violation.help}\n` +
        violation.nodes
          .slice(0, 3)
          .map((node) => `      ${node.target.join(' ')}`)
          .join('\n'),
    )
    .join('\n  ');
  expect(results.violations, `${where}\n  ${summary}`).toEqual([]);
}

test('the login page, which every user meets first', async ({ page }) => {
  await page.goto('/login');
  await scan(page, '/login');
});

test.describe('each role reaches its landing page cleanly', () => {
  const roles: RoleKey[] = ['superadmin', 'manager', 'storekeeper', 'rider', 'owner'];
  for (const role of roles) {
    test(`${role} landing`, async ({ page }) => {
      await signIn(page, role);
      await scan(page, `${role} landing page`);
    });
  }
});

test.describe('the screens people spend their day on', () => {
  const screens: Array<{ path: string; as: RoleKey }> = [
    { path: '/orders', as: 'owner' },
    { path: '/account', as: 'owner' },
    { path: '/approvals', as: 'manager' },
    { path: '/shops', as: 'admin' },
    { path: '/inventory', as: 'storekeeper' },
    { path: '/fulfilment', as: 'storekeeper' },
    { path: '/payments', as: 'manager' },
    { path: '/notifications', as: 'manager' },
    { path: '/activity', as: 'manager' },
  ];

  for (const screen of screens) {
    test(`${screen.path} as ${screen.as}`, async ({ page }) => {
      await signIn(page, screen.as);
      await page.goto(screen.path);
      await expect(page.locator('#root')).not.toBeEmpty();
      await scan(page, `${screen.path} as ${screen.as}`);
    });
  }
});

/**
 * The catalogue, which nothing scanned until now.
 *
 * `/medicines/:id` and `/medicines/new` are the most control-dense screens in
 * the product and neither had ever been looked at: the detail page carries a
 * batch table and — from this phase — stock and pricing actions, and the form
 * carries nineteen fields each with a popover beside its label. A popover is
 * exactly the shape axe is good at judging: an icon-only trigger needs a name,
 * its glyph must be hidden from the tree, and content that is not in the
 * document must not be pointed at by `aria-describedby`.
 *
 * The detail page is reached by clicking through from the list rather than by a
 * hard-coded id, so the spec also proves the link the catalogue draws.
 */
test.describe('the catalogue', () => {
  test('the medicine form, with an explanation on every field', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto('/medicines/new');
    await expect(page.locator('#root')).not.toBeEmpty();
    await scan(page, '/medicines/new as manager');

    // Opened, too. A popover's content is only in the document while it is
    // showing, so a closed one is not the thing that needs judging.
    await page
      .getByRole('button', { name: /^About / })
      .first()
      .click();
    await scan(page, '/medicines/new with an explanation open');
  });

  for (const as of ['manager', 'owner'] as RoleKey[]) {
    test(`a medicine as ${as}`, async ({ page }) => {
      await signIn(page, as);
      await page.goto('/medicines');
      // The product's own heading link. A bare `a[href^="/medicines/"]` picks
      // up "Add a medicine" first for anybody who may create one.
      await page.locator('h2 a[href^="/medicines/"]').first().click();
      await expect(page).toHaveURL(/\/medicines\/[a-f0-9]{24}/);
      await expect(page.locator('#root')).not.toBeEmpty();
      // A manager sees the most controls; a shop owner sees a structurally
      // different, read-only page. Both DOMs need judging.
      await scan(page, `a medicine as ${as}`);
    });
  }
});
