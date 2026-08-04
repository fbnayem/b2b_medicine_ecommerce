import { en } from './en';
import { bn } from './bn';
import type { Catalogue } from './en';

export { en, bn };
export type { Catalogue };

/**
 * Language, resolved once and shared by both clients.
 *
 * `SystemSettings.tsx` declared `LOCALE_OPTIONS = ['en', 'bn']` and
 * `LocalisationSettings` existed in the shared types since phase 10. **Nothing
 * read either.** There was no Bangla anywhere in the product, for operators in
 * Bangladesh.
 *
 * Deliberately not i18next. The catalogue is a plain typed object, so `bn` is
 * `Catalogue` and a missing key is a compile error — an interpolation library
 * would take that guarantee away and give back a runtime fallback to the key
 * name. The one thing i18next offers that is genuinely wanted, `{{value}}`
 * interpolation, is nine lines.
 */

export const LANGUAGES = ['en', 'bn'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABEL: Record<Language, string> = {
  // Each in its own script: somebody who cannot read the current language must
  // still be able to find theirs in the list.
  en: 'English',
  bn: 'বাংলা',
};

const CATALOGUES: Record<Language, Catalogue> = { en, bn };

export function catalogueFor(language: Language): Catalogue {
  return CATALOGUES[language] ?? en;
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Which language to use, in priority order:
 *
 *   1. what this user chose,
 *   2. what the tenant configured in System Settings,
 *   3. what the device asks for, if we have it,
 *   4. English.
 *
 * The tenant sits above the device on purpose. This is a business tool used on
 * shared warehouse terminals and on personal phones; the distributor's choice
 * should beat a handset somebody bought second-hand with its language already
 * set.
 */
export function resolveLanguage(input: {
  chosen?: string | null;
  tenantDefault?: string | null;
  device?: string | null;
}): Language {
  if (isLanguage(input.chosen)) return input.chosen;
  if (isLanguage(input.tenantDefault)) return input.tenantDefault;
  const device = input.device?.slice(0, 2).toLowerCase();
  if (isLanguage(device)) return device;
  return 'en';
}

/**
 * Substitutes `{{name}}` placeholders.
 *
 * An unknown placeholder is left as written rather than replaced with
 * `undefined`, which is how "Use at least undefined characters" reaches a user.
 */
export function interpolate(
  template: string,
  values: Record<string, string | number> = {},
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/** Every leaf path in the catalogue, for the parity test. */
export function catalogueKeys(catalogue: object, prefix = ''): string[] {
  return Object.entries(catalogue).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? catalogueKeys(value, path) : [path];
  });
}

export type Translate = (path: string, values?: Record<string, string | number>) => string;

/**
 * A translator for one language, with no React in it.
 *
 * Both clients wrote the same dotted-path walk beside their provider, and a
 * test or a plain function that needs a sentence had nowhere to get one — which
 * is how the security screen's device names ended up hard-coded in English on
 * both clients while everything around them was translated.
 *
 * A missing key returns the path itself rather than throwing or rendering
 * blank: the caller can then see which key is absent, and `bn: Catalogue` means
 * the only way to reach that state is a key added to neither catalogue.
 */
export function translatorFor(language: Language): Translate {
  const catalogue = catalogueFor(language);
  return (path, values) => {
    const template = path
      .split('.')
      .reduce<unknown>(
        (node, key) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
        catalogue,
      );
    return typeof template === 'string' ? interpolate(template, values) : path;
  };
}

/**
 * A translation, or the fallback the caller already has.
 *
 * For values whose English lives outside the catalogue — navigation labels,
 * which are plain data in `@medsupply/navigation` because a package Metro
 * imports cannot depend on this one. Rendering a dotted path in the sidebar
 * would be worse than rendering English, so a missing key falls back rather
 * than showing itself.
 */
export function translatedOr(t: Translate, path: string, fallback: string): string {
  const value = t(path);
  return value === path ? fallback : value;
}
