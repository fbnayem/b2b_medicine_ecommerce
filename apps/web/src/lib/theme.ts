export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'medsupply.theme';

/**
 * Reads the saved choice. Anything unrecognised means "follow the system",
 * which is also the default, so a corrupted value degrades to sensible rather
 * than to a blank screen.
 */
export function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    // Private browsing, or storage disabled by policy on a shared terminal.
    return 'system';
  }
}

export function prefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  return choice === 'system' ? (prefersDark() ? 'dark' : 'light') : choice;
}

/**
 * Stamps the resolved theme onto `<html>`.
 *
 * A class rather than a media query alone, because the choice has to be
 * overridable: a warehouse terminal under fluorescent light and a rider's
 * phone at 10pm want different answers, and the operating system's preference
 * speaks for neither.
 */
export function applyTheme(choice: ThemeChoice): void {
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not being able to remember the choice is not a reason to refuse it now.
  }
  applyTheme(choice);
}

/**
 * Applies the theme before React mounts.
 *
 * Called from `main.tsx` at module scope rather than from an effect: an effect
 * runs after the first paint, so the user would see the light theme flash and
 * then the dark one land — on every navigation that reloads the document.
 */
export function initialiseTheme(): void {
  applyTheme(storedTheme());
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    // Only follow the system while the user has expressed no preference.
    if (storedTheme() === 'system') applyTheme('system');
  });
}
