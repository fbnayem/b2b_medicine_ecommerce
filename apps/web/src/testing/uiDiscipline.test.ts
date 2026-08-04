import { describe, expect, it } from 'vitest';
import {
  HAND_ROLLED_STATE,
  LEGACY_STYLESHEET,
  NO_PAGE_HEADER,
  RAW_TABLE,
  UNTRANSLATED,
} from './uiWaivers';

/**
 * Pages use the design system, or they are on a list saying they do not yet.
 *
 * Phases 3 to 5 built UI primitives, a token package and a translation
 * catalogue. Then: no page used the table primitive, none called `toast()`,
 * three rendered `PageHeader`, and none called the translation function. The
 * foundations were sound and roughly two thirds of the application ignored
 * them, which is why it does not feel like one product.
 *
 * Nothing failed when a page skipped them. Every other omission of this class
 * in this repository — untested routes, `console.*` past the redacting logger,
 * float money on the server — is caught by a test that reads the sources, and
 * each of those was written after somebody found the omission by hand. This is
 * the same instrument pointed at the same kind of problem.
 *
 * **Each rule fails in both directions.** A new offender fails because it is not
 * waived; a page that has been converted fails because its waiver is now stale.
 * A list that only shrinks is the point — an allow-list that can quietly grow
 * is just a slower way of not having a rule.
 */

/**
 * Read through Vite rather than through `node:fs`.
 *
 * `?raw` is already how the token parity test reads a stylesheet here, and it
 * resolves at build time — so a glob that matches nothing fails loudly instead
 * of producing an empty set that agrees with every assertion. It also keeps
 * this file typechecked by the same project as the application, without adding
 * Node's definitions to a config that must not have them.
 */
const RAW = import.meta.glob('../pages/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Comments describe the old defects on purpose; only code is examined. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SOURCES: ReadonlyMap<string, string> = new Map(
  Object.entries(RAW)
    .map(([path, code]) => [path.split('/').pop() ?? path, withoutComments(code)] as const)
    .filter(([name]) => !name.includes('.test.')),
);

function pages(): string[] {
  return [...SOURCES.keys()].sort();
}

function source(name: string): string {
  return SOURCES.get(name) ?? '';
}

interface Rule {
  name: string;
  /** True when the page still has the problem. */
  offends: (code: string) => boolean;
  waived: readonly string[];
  fix: string;
}

const RULES: Rule[] = [
  {
    name: 'imports the legacy stylesheet',
    offends: (code) => code.includes('inventory.css'),
    waived: LEGACY_STYLESHEET,
    fix: 'Style with the primitives in components/ui; inventory.css is deleted when this list empties.',
  },
  {
    name: 'builds a table by hand',
    offends: (code) => /<table[\s>]/.test(code),
    waived: RAW_TABLE,
    fix: 'Use <DataTable>, which stacks each row into a labelled block on a phone.',
  },
  {
    name: 'hand-rolls a loading, empty or error state',
    /*
     * A page that says "Loading" *through* a primitive is doing the right
     * thing — `<LoadingState label="Loading the packages that are ready" />`
     * is adoption, not an offence, and an earlier version of this rule flagged
     * it. What it catches is the literal with no primitive behind it, of which
     * `ApprovalReview.tsx`'s `{error || 'Loading review...'}` is the sharpest
     * example: it renders the failure and the wait through the same
     * expression, so "this broke" and "this has not arrived yet" are
     * indistinguishable to the person reading it.
     */
    offends: (code) =>
      /['">]Loading|Loading…|Loading\.\.\./.test(code) && !/<LoadingState|<Resource/.test(code),
    waived: HAND_ROLLED_STATE,
    fix: 'Wrap the query in <Resource>, which renders all three states and offers a retry.',
  },
  {
    name: 'renders no PageHeader, so emits no page test id',
    offends: (code) => !code.includes('<PageHeader'),
    waived: NO_PAGE_HEADER,
    fix: 'Render <PageHeader routeId="…">; it emits the data-test contract docs/TESTING.md froze.',
  },
  {
    name: 'is not wired to the translation catalogue',
    offends: (code) => !code.includes('useLanguage'),
    waived: UNTRANSLATED,
    fix: 'Take t() from useLanguage(). A Bangla frame around an English page reads as broken.',
  },
];

describe('page adoption of the design system', () => {
  for (const rule of RULES) {
    it(`no unwaived page ${rule.name}`, () => {
      const offenders = pages().filter((name) => rule.offends(source(name)));
      const unwaived = offenders.filter((name) => !rule.waived.includes(name));
      expect(unwaived, rule.fix).toEqual([]);
    });

    it(`the waiver list for "${rule.name}" has no stale entries`, () => {
      const offenders = new Set(pages().filter((name) => rule.offends(source(name))));
      const stale = rule.waived.filter((name) => !offenders.has(name));
      expect(
        stale,
        'These pages now comply. Strike them off src/testing/uiWaivers.ts — the list may only shrink.',
      ).toEqual([]);
    });
  }

  it('every waived page still exists', () => {
    const known = new Set(pages());
    const ghosts = RULES.flatMap((rule) => rule.waived).filter((name) => !known.has(name));
    expect(
      [...new Set(ghosts)],
      'A waiver naming a deleted page hides nothing and confuses.',
    ).toEqual([]);
  });

  it('the rules detect what they claim to, so a clean run means something', () => {
    // A rule that cannot fire is indistinguishable from a rule that passes.
    const [stylesheet, table, state, header, translation] = RULES;
    expect(stylesheet!.offends("import './inventory.css';")).toBe(true);
    expect(stylesheet!.offends("import { Card } from '../components/ui';")).toBe(false);
    expect(table!.offends('<table className="x">')).toBe(true);
    expect(table!.offends('<DataTable columns={columns} />')).toBe(false);
    expect(state!.offends('<p>Loading…</p>')).toBe(true);
    expect(state!.offends("{error || 'Loading review...'}")).toBe(true);
    // Saying "Loading" through the primitive is the fixed state, not the bug.
    expect(state!.offends('<LoadingState label="Loading orders" />')).toBe(false);
    expect(header!.offends('export function Page() { return <div/> }')).toBe(true);
    expect(header!.offends('<PageHeader routeId="orders" title="Orders" />')).toBe(false);
    expect(translation!.offends('const x = 1;')).toBe(true);
    expect(translation!.offends('const { t } = useLanguage();')).toBe(false);
  });

  it('actually found the pages, so a clean run is not an empty one', () => {
    // A glob that matched nothing would satisfy every rule above in silence.
    // This is the assertion that makes the others mean something.
    expect(pages().length).toBeGreaterThan(40);
    expect(pages()).toContain('OrderList.tsx');
  });
});
