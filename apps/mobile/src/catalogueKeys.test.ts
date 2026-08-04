import { describe, expect, it } from 'vitest';
import { LANGUAGES, catalogueFor, catalogueKeys, en } from '@medsupply/i18n';

/**
 * Every `t('…')` on this client names a key the catalogue actually holds.
 *
 * The web side has had this since the phase that found `shops.city` on a
 * warehouse form — a key that exists nowhere, rendered as the dotted path
 * `shops.city` on the screen, with 181 tests green because a page that renders
 * a dotted path is still a page that renders.
 *
 * **Mobile never got the same gate**, and is the client where it matters more:
 * a rep sees a screen the size of a hand, one string at a time, with nobody
 * looking over their shoulder to say that a label reads like a variable name.
 * The tab titles were already caught going untranslated once for a related
 * reason — see `navigation/tabs.ts`.
 *
 * Read through Vite rather than `node:fs`, exactly as `tokenDiscipline.test.ts`
 * does and for the same reason: a screen that ships to Hermes must not be able
 * to reach a filesystem.
 */
const RAW = import.meta.glob(['../app/**/*.tsx', './**/*.tsx', './**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * `t('a.b')` and `t("a.b")` with a literal path.
 *
 * Template literals — `` t(`paymentMethod.${method}`) `` — are deliberately not
 * matched: the key is only known at run time, and those are guarded instead by
 * the `Record<Enum, string>` maps in the catalogue, which make a missing member
 * a compile error.
 */
const CALL = /\bt\(\s*'([a-zA-Z][\w.-]*)'/g;

function keysUsed(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const [path, code] of Object.entries(RAW)) {
    const file = path.replace(/^\.\.\//, '').replace(/^\.\//, 'src/');
    if (file.includes('.test.')) continue;
    for (const match of String(code).matchAll(CALL)) {
      const key = match[1]!;
      if (!used.has(key)) used.set(key, new Set());
      used.get(key)!.add(file);
    }
  }
  return used;
}

const KNOWN = new Set(catalogueKeys(en));

describe('every translation key this client asks for exists', () => {
  it('found the source to search, so a clean run is not an empty one', () => {
    // A glob matching nothing would satisfy every rule below in silence.
    expect(Object.keys(RAW).length).toBeGreaterThan(30);
    expect(keysUsed().size).toBeGreaterThan(50);
  });

  it('names no key the catalogue does not hold', () => {
    const missing = [...keysUsed().entries()]
      .filter(([key]) => !KNOWN.has(key))
      .map(([key, files]) => `${key} — used in ${[...files].sort().join(', ')}`)
      .sort();

    expect(
      missing,
      'These render as a dotted path on the screen, which no other check on this client can see.',
    ).toEqual([]);
  });

  it('resolves those keys in Bangla too, not only English', () => {
    // `bn: Catalogue` makes a *missing* key a compile error; this is the
    // narrower claim that nothing resolves to an object or to the path itself.
    const unresolved: string[] = [];
    for (const language of LANGUAGES) {
      const catalogue = catalogueFor(language) as unknown as Record<string, unknown>;
      for (const key of keysUsed().keys()) {
        if (!KNOWN.has(key)) continue;
        const value = key
          .split('.')
          .reduce<unknown>(
            (node, part) =>
              node && typeof node === 'object'
                ? (node as Record<string, unknown>)[part]
                : undefined,
            catalogue,
          );
        if (typeof value !== 'string') unresolved.push(`${language}: ${key}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('the rule detects what it claims to, so a clean run means something', () => {
    expect(KNOWN.has('common.cancel')).toBe(true);
    expect(KNOWN.has('shops.city')).toBe(false);
    expect([..."t('warehouses.city')".matchAll(CALL)][0]?.[1]).toBe('warehouses.city');
    // A template literal is not matched, deliberately.
    expect([...'t(`orderStatus.${status}`)'.matchAll(CALL)]).toHaveLength(0);
  });
});
