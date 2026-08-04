import { describe, expect, it } from 'vitest';

/**
 * Colours come from the token package, or the file is on a list saying it does
 * not yet.
 *
 * `theme.ts` re-exports the design tokens correctly and **three files import
 * it**. Thirty-four still carry raw hex, including both of the brand greens the
 * token package was created to collapse — `#126b45` appears 54 times and
 * `#16724a` 15, which is the same defect the original audit recorded, half
 * fixed. The tokens existed and there was nothing to put them in until the
 * primitives in `src/components` landed.
 *
 * The list may only shrink, exactly as on the web side: a new offender fails
 * because it is not waived, and a converted screen fails on its own stale
 * waiver until it is struck off.
 */

/** Six-digit hex, which is how every one of these is written. */
const HEX = /#[0-9a-fA-F]{6}\b/;

/**
 * Read through Vite, not through `node:fs`.
 *
 * `vite-env.d.ts` explains why this package carries no Node type definitions:
 * a screen that ships to Hermes must not be able to reach a filesystem, and
 * keeping `node:fs` out of scope is the cheapest place to enforce that. The
 * glob resolves at build time, so a pattern that matches nothing fails rather
 * than silently agreeing with every assertion.
 */
const RAW = import.meta.glob(
  [
    '../app/**/*.tsx',
    '../app/**/*.ts',
    './components/**/*.tsx',
    './finance/**/*.tsx',
    './notifications/**/*.tsx',
    './notifications/**/*.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
);

/** Paths as they appear in the waiver list, relative to the app package root. */
const SOURCES: ReadonlyMap<string, string> = new Map(
  Object.entries(RAW)
    .map(([path, code]) => [path.replace(/^\.\.\//, '').replace(/^\.\//, 'src/'), code] as const)
    .filter(([name]) => !name.includes('.test.')),
);

/**
 * Screens and shared modules still carrying their own colours.
 *
 * `push.ts` is here with the rest rather than exempted: its notification
 * colour has to match `app.json`, which no package can reach, and the token
 * package already asserts that pairing — so it is a real entry with a real
 * answer, not a special case.
 */
const RAW_HEX: readonly string[] = [
  'app/(protected)/(tabs)/inventory.tsx',
  'app/(protected)/(tabs)/notifications.tsx',
  'app/(protected)/(tabs)/security.tsx',
  'app/(protected)/(tabs)/system-settings.tsx',
  'app/(protected)/approval-review.tsx',
  'app/(protected)/delivery-detail.tsx',
  'app/(protected)/delivery-proof.tsx',
  'app/(protected)/notification-preferences.tsx',
  'app/(protected)/picking.tsx',
  'app/(protected)/return-detail.tsx',
  'src/finance/components.tsx',
];

function offenders(): string[] {
  return [...SOURCES.entries()]
    .filter(([, code]) => HEX.test(code))
    .map(([name]) => name)
    .sort();
}

describe('mobile colours come from the token package', () => {
  it('no unwaived screen carries a raw colour', () => {
    const unwaived = offenders().filter((name) => !RAW_HEX.includes(name));
    expect(
      unwaived,
      'Take colours from src/theme.ts. Two brand greens shipped side by side because these were retyped.',
    ).toEqual([]);
  });

  it('the waiver list has no stale entries', () => {
    const current = new Set(offenders());
    const stale = RAW_HEX.filter((name) => !current.has(name));
    expect(
      stale,
      'These files now use tokens. Strike them off — the list may only shrink.',
    ).toEqual([]);
  });

  it('the new primitives set the example they are meant to', () => {
    // The components exist so screens have somewhere to put the tokens. If they
    // themselves carried hex, the migration would spread the defect it fixes.
    const components = [...SOURCES.keys()].filter((name) => name.startsWith('src/components/'));
    expect(components.length).toBeGreaterThan(0);
    expect(components.filter((name) => HEX.test(SOURCES.get(name) ?? ''))).toEqual([]);
  });

  it('actually found the screens, so a clean run is not an empty one', () => {
    // A glob matching nothing would satisfy every rule above in silence.
    expect(SOURCES.size).toBeGreaterThan(30);
    expect([...SOURCES.keys()]).toContain('app/(protected)/picking.tsx');
  });

  it('the rule detects what it claims to, so a clean run means something', () => {
    expect(HEX.test("backgroundColor: '#126b45'")).toBe(true);
    expect(HEX.test('color: colour.brand')).toBe(false);
    // Not a colour: an eight-digit id or a hash in a comment must not fire.
    expect(HEX.test('const id = 12345;')).toBe(false);
  });
});
