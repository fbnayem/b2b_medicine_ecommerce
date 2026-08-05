import { describe, expect, it } from 'vitest';
import { ORPHAN_CLASSES } from './uiWaivers';

/**
 * A class name that no stylesheet defines and Tailwind cannot generate.
 *
 * This is the gate for the defect that produced the screenshots: the
 * notification panel rendering as run-together text over the page, the bar
 * charts drawing nothing, the ledger metrics as bare label/value pairs, the
 * history on three detail screens as an undifferentiated run of paragraphs, and
 * an invoice printing with the sidebar around it.
 *
 * One cause for all of them. `inventory.css` — 1,104 lines — was deleted once
 * the **pages** had been converted, and `uiDiscipline.test.ts` globs
 * `../pages/*.tsx`, so `components/` was never looked at. Thirty-seven class
 * names went on being written for a stylesheet that no longer existed. Nothing
 * failed: a class that resolves to nothing is not an error in CSS, it is
 * silence. The only symptom was on screen, and only to somebody who happened to
 * open those pages.
 *
 * The rule is deliberately the *narrow* one — "this class cannot possibly
 * resolve" — rather than "components must use the primitives". A structural
 * rule about components would be a matter of taste; this is a fact about the
 * build, and a fact is what a gate can hold.
 */

/**
 * Comments describe the old defects on purpose — `Button.tsx` names
 * `primary-button` while explaining why it no longer uses it — so only code is
 * examined. `uiDiscipline.test.ts` strips them for exactly the same reason.
 */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SOURCES: ReadonlyMap<string, string> = new Map(
  Object.entries(
    import.meta.glob(['../pages/*.tsx', '../components/**/*.tsx', '../app/*.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  )
    .filter(([path]) => !path.includes('.test.'))
    .map(([path, code]) => [path.replace(/^\.\.\//, ''), withoutComments(code)] as const),
);

/** The stylesheets that can define a class. Both of them. */
const STYLESHEETS = Object.values(
  import.meta.glob(['../index.css', '../../../../packages/design-tokens/theme.css'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
).join('\n');

function declaredClasses(css: string): Set<string> {
  return new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]));
}

/**
 * Whether Tailwind could emit this token.
 *
 * Not a parser — Tailwind's own would need the build. It recognises the shapes
 * a utility takes: a variant prefix (`hover:`, `lg:`, `max-md:`, `dark:`), an
 * arbitrary value (`w-[13rem]`, `bg-[var(--x)]`), a negative (`-mt-1`), an
 * opacity suffix (`bg-brand/40`), and otherwise a known utility root.
 *
 * The list of roots is long and boring on purpose. A guess that leaned on
 * "looks like kebab-case" would clear `bell-panel` and `chart-bar-group`, which
 * are the exact names this exists to catch.
 */
const UTILITY_ROOTS = [
  'absolute',
  'align',
  'animate',
  'appearance',
  'aspect',
  'backdrop',
  'basis',
  'bg',
  'block',
  'border',
  'bottom',
  'box',
  'break',
  'capitalize',
  'caption',
  'clear',
  'col',
  'collapse',
  'columns',
  'contents',
  'content',
  'cursor',
  'decoration',
  'delay',
  'divide',
  'duration',
  'ease',
  'end',
  'fill',
  'fixed',
  'flex',
  'float',
  'flow',
  'font',
  'gap',
  'grid',
  'grow',
  'h',
  'hidden',
  'indent',
  'inline',
  'inset',
  'invisible',
  'isolate',
  'italic',
  'items',
  'justify',
  'leading',
  'left',
  'line',
  'list',
  'm',
  'max',
  'mb',
  'me',
  'min',
  'mix',
  'ml',
  'mr',
  'ms',
  'mt',
  'mx',
  'my',
  'no',
  'normal',
  'not',
  'object',
  'opacity',
  'order',
  'origin',
  'outline',
  'overflow',
  'overscroll',
  'p',
  'pb',
  'pe',
  'place',
  'pointer',
  'pl',
  'pointer',
  'pr',
  'ps',
  'pt',
  'px',
  'py',
  'relative',
  'resize',
  'right',
  'ring',
  'rotate',
  'rounded',
  'row',
  'scale',
  'scroll',
  'select',
  'self',
  'shadow',
  'shrink',
  'size',
  'skew',
  'snap',
  'space',
  'sr',
  'start',
  'static',
  'sticky',
  'stroke',
  'subpixel',
  'table',
  'text',
  'top',
  'touch',
  'tracking',
  'transform',
  'transition',
  'translate',
  'truncate',
  'underline',
  'uppercase',
  'lowercase',
  'visible',
  'w',
  'whitespace',
  'will',
  'wrap',
  'z',
  'antialiased',
  'tabular',
  'oldstyle',
  'proportional',
  'diagonal',
  'stacked',
  'ordinal',
  'slashed',
  'first',
  'last',
  'odd',
  'even',
  'only',
  'empty',
  'disabled',
  'enabled',
  'checked',
  'indeterminate',
  'default',
  'required',
  'valid',
  'invalid',
  'placeholder',
  'autofill',
  'read',
  'open',
  'before',
  'after',
  'backface',
  'forced',
  'print',
  'portrait',
  'landscape',
  'motion',
  'contrast',
  'rtl',
  'ltr',
  'group',
  'peer',
  'has',
  'aria',
  'data',
  'supports',
  'flex-col',
  'col-span',
  'duration',
];

const VARIANT = /^(?:[a-z0-9-]+|\[[^\]]+\]|@[a-z0-9-]+):/;

function couldBeTailwind(token: string): boolean {
  let rest = token;
  // Strip any number of variant prefixes: `lg:hover:focus-visible:…`
  while (VARIANT.test(rest)) rest = rest.replace(VARIANT, '');
  if (!rest) return false;
  if (rest.startsWith('!')) rest = rest.slice(1);
  if (rest.startsWith('-')) rest = rest.slice(1);
  // `bg-brand/40`, `text-text/80`
  rest = rest.split('/')[0];
  // A bare arbitrary property: `[mask-type:luminance]`
  if (rest.startsWith('[')) return true;
  const root = rest.split('-')[0];
  if (UTILITY_ROOTS.includes(root)) return true;
  // Single-word utilities that are their own root, e.g. `truncate`, `flex`.
  return UTILITY_ROOTS.includes(rest);
}

/**
 * The region of source belonging to one `className`.
 *
 * A first version simply took every kebab-case string literal in the file, and
 * it reported `react-router-dom`, `price-lists` and `admin-users` — an import
 * specifier, a query key and a test id. A gate whose failures are mostly noise
 * is a gate somebody switches off, so this reads only what is actually a class:
 * the literal after `className=`, or, for `className={…}`, the text between the
 * balanced braces, where the `clsx()` and array-`join()` members live.
 */
function classNameRegions(code: string): string[] {
  const regions: string[] = [];
  const attribute = /className\s*=\s*/g;
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(code))) {
    const start = match.index + match[0].length;
    const opener = code[start];
    if (opener === '"' || opener === "'") {
      const end = code.indexOf(opener, start + 1);
      if (end > start) regions.push(code.slice(start + 1, end));
      continue;
    }
    if (opener !== '{') continue;
    let depth = 0;
    let index = start;
    for (; index < code.length; index += 1) {
      if (code[index] === '{') depth += 1;
      else if (code[index] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    regions.push(code.slice(start + 1, index));
  }
  return regions;
}

/**
 * Every class token written as a literal.
 *
 * Template interpolations are skipped rather than guessed at: a
 * `` `text-${tone}` `` cannot be resolved here, and inventing a verdict for it
 * would make the gate lie in one direction or the other.
 */
function literalClassTokens(code: string): string[] {
  const tokens: string[] = [];
  for (const region of classNameRegions(code)) {
    // Inside `{…}` the classes are string literals; a bare region is already one.
    const strings =
      region.includes("'") || region.includes('"') || region.includes('`')
        ? [...region.matchAll(/['"`]([^'"`]*)['"`]/g)].map((found) => found[1])
        : [region];
    for (const value of strings) {
      for (const token of value.split(/\s+/)) {
        if (token && !token.includes('${')) tokens.push(token);
      }
    }
  }
  return tokens;
}

const DECLARED = declaredClasses(STYLESHEETS);

function orphansIn(code: string): string[] {
  return [
    ...new Set(
      literalClassTokens(code).filter(
        (token) =>
          !DECLARED.has(token) &&
          !couldBeTailwind(token) &&
          /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(token),
      ),
    ),
  ];
}

describe('no class name resolves to nothing', () => {
  it('finds the sources, so a clean run is not an empty one', () => {
    // The rule this replaces globbed `pages/` only, which is exactly why the
    // four broken components were never looked at. A glob that silently matched
    // nothing would agree with every assertion below.
    expect(SOURCES.size).toBeGreaterThan(60);
    expect([...SOURCES.keys()].some((path) => path.startsWith('components/'))).toBe(true);
    expect(DECLARED.size).toBeGreaterThan(3);
  });

  it('no unwaived file uses a class no stylesheet defines', () => {
    const offenders: string[] = [];
    for (const [name, code] of SOURCES) {
      const orphans = orphansIn(code);
      if (orphans.length && !ORPHAN_CLASSES.includes(name)) {
        offenders.push(`${name}: ${orphans.join(', ')}`);
      }
    }
    expect(
      offenders,
      'These class names cannot resolve: no stylesheet declares them and Tailwind cannot ' +
        'generate them, so they style nothing at all. Use the primitives in components/ui.',
    ).toEqual([]);
  });

  it('the waiver list has no stale entries', () => {
    const stale = ORPHAN_CLASSES.filter((name) => orphansIn(SOURCES.get(name) ?? '').length === 0);
    expect(
      stale,
      'These files are clean now. Strike them off uiWaivers.ts — the list may only shrink.',
    ).toEqual([]);
  });

  it('the rule detects what it claims to, so a clean run means something', () => {
    // The five names that were actually on screen, and the shapes that must not
    // trip it. Without this, a broken matcher and a clean codebase look alike.
    expect(orphansIn('<div className="bell-panel">')).toEqual(['bell-panel']);
    expect(orphansIn('<div className="chart-bar-group">')).toEqual(['chart-bar-group']);
    expect(orphansIn('<div className="metric-grid finance-metrics">')).toEqual([
      'metric-grid',
      'finance-metrics',
    ]);
    expect(orphansIn('<div className="timeline-summary">')).toEqual(['timeline-summary']);

    // Real utilities, including the awkward ones.
    expect(orphansIn('<div className="flex min-h-11 items-center gap-3 rounded-md">')).toEqual([]);
    expect(orphansIn('<div className="lg:sticky lg:top-[var(--header-h)] max-md:hidden">')).toEqual(
      [],
    );
    expect(orphansIn('<div className="bg-brand-subtle/40 -mt-1 hover:bg-surface-hover">')).toEqual(
      [],
    );
    expect(orphansIn('<div className="grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">')).toEqual(
      [],
    );
    // Declared by hand in index.css, so not orphans.
    expect(orphansIn('<a className="skip-link">')).toEqual([]);
    expect(orphansIn('<span className="sr-only">')).toEqual([]);
    expect(orphansIn('<div className="invoice-print">')).toEqual([]);
  });
});
