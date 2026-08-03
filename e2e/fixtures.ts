import { expect, type Page } from '@playwright/test';

/**
 * The credentials the seed creates. `globalSetup` runs the seed with this
 * password so the two cannot drift.
 */
export const E2E_PASSWORD = 'E2ePassw0rd!seeded';

export const ROLES = {
  superadmin: { email: 'superadmin@medsupply.local', label: 'Super Admin' },
  admin: { email: 'admin@medsupply.local', label: 'Admin' },
  manager: { email: 'manager@medsupply.local', label: 'Manager' },
  storekeeper: { email: 'storekeeper@medsupply.local', label: 'Storekeeper' },
  rider: { email: 'rider@medsupply.local', label: 'Delivery person' },
  owner: { email: 'owner@medsupply.local', label: 'Shop owner' },
} as const;

export type RoleKey = keyof typeof ROLES;

/**
 * Signs in through the form, as a person does.
 *
 * Deliberately not a `storageState` shortcut. The access token is held in
 * memory and re-minted from an HTTP-only cookie at boot, so a restored storage
 * state would carry the cookie into an application that must redeem it — which
 * is a behaviour worth exercising every run, not bypassing. It is also the
 * exact behaviour that was missing until phase 1, and the reason a reload used
 * to sign the user out mid-order.
 */
export async function signIn(page: Page, role: RoleKey) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ROLES[role].email);
  await page.getByLabel(/password/i).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  // Landing is role-dependent; what must be true is that we left the form.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

export async function signOut(page: Page) {
  const control = page.getByRole('button', { name: /^sign out$/i });
  if (await control.count()) {
    await control.first().click();
    await expect(page).toHaveURL(/\/login/);
  }
}

/**
 * Confirms a destructive action, whatever it is implemented with today.
 *
 * This exists because of a trap rather than for convenience. Playwright
 * auto-dismisses native dialogs, so a spec written against the 22
 * `window.confirm` sites this project still has would *pass* while silently
 * cancelling the very action it claims to test — and would then start
 * *performing* that action the day those become real dialogs. Routing every
 * confirmation through one helper makes that swap a one-file change instead of
 * a silent change of meaning in twenty-two specs.
 *
 * Today: accept the native dialog. From phase 4: click the AlertDialog's
 * confirm button. The `data-test="dialog-confirm"` branch is already here so
 * the change is a deletion, not a rewrite.
 */
export async function confirmAction(page: Page, trigger: () => Promise<void>) {
  let nativeDialogSeen = false;
  const handler = (dialog: { accept: () => Promise<void> }) => {
    nativeDialogSeen = true;
    void dialog.accept();
  };
  page.on('dialog', handler);
  try {
    await trigger();
    // A real dialog, once phase 4 has replaced the native ones.
    const confirm = page.getByTestId('dialog-confirm');
    if (!nativeDialogSeen && (await confirm.count())) await confirm.click();
  } finally {
    page.off('dialog', handler);
  }
  return { nativeDialogSeen };
}

/**
 * The landmarks every page is expected to expose. Frozen in `docs/TESTING.md`
 * before the primitives that emit them exist, so the redesign is written
 * against a contract rather than the specs being rewritten around it.
 */
export const TEST_IDS = {
  shell: 'app-shell',
  sidebar: 'app-sidebar',
  search: 'app-search',
  accountMenu: 'app-account-menu',
  toast: 'toast',
  dialog: 'dialog',
  dialogConfirm: 'dialog-confirm',
  emptyState: 'empty-state',
  errorState: 'error-state',
  page: (routeId: string) => `page-${routeId}`,
  row: (reference: string) => `row-${reference}`,
} as const;

/**
 * Fails the test on a page that rendered nothing.
 *
 * The blank-page defect produced a 200, a valid HTML shell and an empty
 * `#root`; every network assertion passed. This asserts what a person would
 * notice: that there are words on the screen.
 */
export async function expectPageRendered(page: Page) {
  const root = page.locator('#root');
  await expect(root).toBeAttached();
  await expect
    .poll(async () => (await root.innerText()).trim().length, {
      timeout: 15_000,
      message: 'The application mounted an empty #root — this is the blank-page defect.',
    })
    .toBeGreaterThan(0);
}

/** Console errors a page must not produce. Filters the noise browsers emit anyway. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // A failed request is asserted where it happens; this is for render errors.
    if (/Failed to load resource|net::ERR_|favicon/i.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`Uncaught: ${error.message}`));
  return errors;
}
