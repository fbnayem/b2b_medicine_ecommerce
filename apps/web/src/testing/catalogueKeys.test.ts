import { describe, expect, it } from 'vitest';
import { LANGUAGES, catalogueFor, catalogueKeys, en } from '@medsupply/i18n';

/**
 * Every `t('…')` in the application names a key the catalogue actually holds.
 *
 * `t` returns the path when it has no entry, so a mistyped or invented key
 * renders as `warehouses.city` on the screen — visible, wrong, and invisible to
 * every other check in this repository. The typechecker cannot help: the
 * catalogue is a nested object and the call sites pass strings, several of them
 * built by template literal.
 *
 * This was written after exactly that happened: a warehouse form asked for
 * `shops.city` and `shops.district`, neither of which exists, and 181 tests
 * stayed green because a page that renders a dotted path is still a page that
 * renders.
 *
 * Read through Vite rather than `node:fs`, as the other discipline tests do.
 */
const RAW = import.meta.glob(['../pages/*.tsx', '../components/**/*.tsx', '../app/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * `t('a.b')` and `t("a.b")` with a literal path.
 *
 * Template literals — `` t(`orderStatus.${status}`) `` — are deliberately not
 * matched: the key is only known at run time, and those are already guarded by
 * the `Record<Enum, string>` maps in the catalogue, which make a missing member
 * a compile error instead.
 */
const CALL = /\bt\(\s*'([a-zA-Z][\w.-]*)'/g;

function keysUsed(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const [path, code] of Object.entries(RAW)) {
    const file = path.replace(/^\.\.\//, 'src/');
    for (const match of String(code).matchAll(CALL)) {
      const key = match[1]!;
      if (!used.has(key)) used.set(key, new Set());
      used.get(key)!.add(file);
    }
  }
  return used;
}

/** Every leaf path in the English catalogue, which `bn: Catalogue` mirrors. */
const KNOWN = new Set(catalogueKeys(en));

describe('every translation key used actually exists', () => {
  it('found the source to search, so a clean run is not an empty one', () => {
    expect(Object.keys(RAW).length).toBeGreaterThan(40);
    expect(keysUsed().size).toBeGreaterThan(100);
  });

  it('names no key the catalogue does not hold', () => {
    const missing = [...keysUsed().entries()]
      .filter(([key]) => !KNOWN.has(key))
      .map(([key, files]) => `${key} — used in ${[...files].sort().join(', ')}`)
      .sort();

    expect(
      missing,
      'These render as a dotted path on the screen, which is not a failure any ' +
        'other check in this repository can see.',
    ).toEqual([]);
  });

  it('resolves those keys in every language, not only English', () => {
    // `bn: Catalogue` makes a *missing* Bangla key a compile error, so this is
    // the narrower claim that nothing resolves to an object or to the path.
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

  it('detects what it claims to, so a clean run means something', () => {
    // The rule itself, checked against a key that is certainly absent and one
    // that is certainly present.
    expect(KNOWN.has('common.cancel')).toBe(true);
    expect(KNOWN.has('shops.city')).toBe(false);
    expect([..."t('warehouses.city')".matchAll(CALL)][0]?.[1]).toBe('warehouses.city');
    // A template literal is not matched, deliberately.
    expect([...'t(`orderStatus.${status}`)'.matchAll(CALL)]).toHaveLength(0);
  });
});
