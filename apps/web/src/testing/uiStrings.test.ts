import { describe, expect, it } from 'vitest';
import { UNTRANSLATED_PRIMITIVES } from './uiWaivers';

/**
 * A shared primitive may not put English on the screen.
 *
 * `ErrorState` defaulted its title to the literal `'Something went wrong'`, its
 * retry button to `'Try again'` and its support line to `'Quote this reference
 * if you contact support'`. `LoadingState` said `'Loading'`. `Resource` and
 * `DataTable` said `'Nothing to show yet'`. Every one of those sentences has
 * existed in Bangla in `packages/i18n` since the localisation phase, and
 * `apps/mobile/src/components/Feedback.tsx` has always read them — so the same
 * component, in the same product, was translated on a phone and not in a
 * browser.
 *
 * Nothing caught it. `catalogueKeys.test.ts` checks that every key a component
 * *asks for* exists, which says nothing about a component that never asks.
 * There was no failing test, no type error and no lint warning: the language
 * toggle simply had no effect on the one surface a confused user stops to read.
 *
 * The rule is narrow on purpose. It applies to `components/ui` only — the
 * fifteen files every screen is built from — and it looks for one thing: an
 * English sentence written as a literal where a user will see it. A broader
 * "no English anywhere" rule would drown in `data-test` values, ARIA tokens and
 * class names, and a gate that mostly cries wolf is a gate somebody deletes.
 */

const SOURCES: ReadonlyMap<string, string> = new Map(
  Object.entries(
    import.meta.glob('../components/ui/*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  )
    .filter(([path]) => !path.includes('.test.'))
    .map(([path, code]) => [path.replace(/^\.\.\//, ''), code] as const),
);

/** As `uiDiscipline` and `orphanClasses` do: comments describe old defects. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Attributes whose value is machine-facing, however English it looks.
 *
 * `data-test="empty-state"`, `role="alert"`, `type="button"`, a `className` — a
 * reader never sees any of them, and several are required to be exactly the
 * English word they are.
 */
const MACHINE_ATTRIBUTES =
  /(?:data-[\w-]+|className|class|role|type|id|htmlFor|scope|name|key|href|to|aria-[\w-]+|autoComplete|inputMode|enterKeyHint|preserveAspectRatio|vectorEffect|stopColor|fill|stroke|xmlns|viewBox|variant|tone|size|method|encType|rel|target)\s*=\s*$/;

/**
 * Prose: two or more words, opening with a capital or an article.
 *
 * Single words are excluded deliberately. `'Loading'` is prose and would be
 * caught by this, but so are a hundred harmless identifiers, and the difference
 * cannot be told apart mechanically — so the rule takes the sentences, which is
 * where the wording that matters lives, and accepts that it does not take
 * everything. `common.loading` is covered by the self-test below instead.
 */
function looksLikeProse(value: string): boolean {
  if (!/^[A-Z"']|^(?:a|an|the) /.test(value)) return false;
  const words = value.trim().split(/\s+/);
  if (words.length < 2) return false;
  // `Record<NavIcon, LucideIcon>`, `Pick<Props, 'a' | 'b'>` and similar are
  // type syntax that happens to sit in a string in a few generic helpers.
  if (/[<>{}$]/.test(value)) return false;
  // An interpolation placeholder means it came from the catalogue already.
  if (value.includes('{{')) return false;
  return words.every((word) => /^[A-Za-z0-9'’.,:;!?()—–-]+$/.test(word));
}

/**
 * Every literal a reader could end up seeing.
 *
 * Two shapes: a JSX text node (`>Try again<`) and a string literal that is not
 * the value of a machine-facing attribute. The second is what caught the actual
 * defect, because `title = 'Something went wrong'` is a default parameter and
 * never appears in JSX at all.
 */
function visibleLiterals(code: string): string[] {
  const clean = withoutComments(code);
  const found: string[] = [];

  for (const match of clean.matchAll(/'([^'\\\n]{2,})'|"([^"\\\n]{2,})"/g)) {
    const value = match[1] ?? match[2] ?? '';
    const before = clean.slice(Math.max(0, match.index - 60), match.index);
    if (MACHINE_ATTRIBUTES.test(before)) continue;
    // Inside `clsx(…)` and `import … from '…'`.
    if (/\b(?:clsx|import|from|require)\s*\(?[^)]*$/.test(before.split('\n').pop() ?? '')) continue;
    if (looksLikeProse(value)) found.push(value);
  }

  // A JSX text node: between `>` and `<`, on the same run, with no braces.
  for (const match of clean.matchAll(/>\s*([A-Za-z][^<>{}\n]{3,})\s*</g)) {
    const value = match[1]!.trim();
    if (looksLikeProse(value)) found.push(value);
  }

  return [...new Set(found)];
}

describe('the shared primitives speak the reader’s language', () => {
  it('found the primitives, so a clean run is not an empty one', () => {
    expect(SOURCES.size).toBeGreaterThan(10);
    expect([...SOURCES.keys()]).toContain('components/ui/Feedback.tsx');
  });

  it('no primitive writes an English sentence a user would read', () => {
    const offenders: string[] = [];
    for (const [name, code] of SOURCES) {
      if (UNTRANSLATED_PRIMITIVES.includes(name)) continue;
      const literals = visibleLiterals(code);
      if (literals.length) offenders.push(`${name}: ${literals.map((s) => `"${s}"`).join(', ')}`);
    }
    expect(
      offenders,
      'These reach the screen as English whatever language the reader chose. ' +
        'Take the wording from packages/i18n through useLanguage, as ' +
        'apps/mobile/src/components/Feedback.tsx does.',
    ).toEqual([]);
  });

  it('the waiver list has no stale entries', () => {
    const stale = UNTRANSLATED_PRIMITIVES.filter(
      (name) => visibleLiterals(SOURCES.get(name) ?? '').length === 0,
    );
    expect(stale, 'These are clean now. Strike them off uiWaivers.ts.').toEqual([]);
  });

  it('detects what it claims to, so a clean run means something', () => {
    // The five sentences that were actually shipping, in the shapes they had.
    expect(visibleLiterals("function E({ title = 'Something went wrong' }) {}")).toEqual([
      'Something went wrong',
    ]);
    expect(visibleLiterals('<Button>Try again</Button>')).toEqual(['Try again']);
    expect(visibleLiterals('<p>Quote this reference if you contact support:</p>')).toEqual([
      'Quote this reference if you contact support:',
    ]);
    expect(visibleLiterals('<EmptyState title="Nothing to show yet" />')).toEqual([
      'Nothing to show yet',
    ]);
    expect(visibleLiterals("const fallback = 'This could not be loaded.';")).toEqual([
      'This could not be loaded.',
    ]);

    // And the shapes that must not trip it, or the rule gets switched off.
    expect(visibleLiterals('<div data-test="empty-state" role="alert" />')).toEqual([]);
    expect(visibleLiterals("<div className='flex min-h-11 items-center' />")).toEqual([]);
    expect(visibleLiterals("import { Button } from './Button';")).toEqual([]);
    expect(visibleLiterals("<p>{t('common.retry')}</p>")).toEqual([]);
    expect(visibleLiterals('<span>{label}</span>')).toEqual([]);
    // A comment describing the defect, which is what this file is full of.
    expect(visibleLiterals('// It used to say Something went wrong here.')).toEqual([]);
  });
});
