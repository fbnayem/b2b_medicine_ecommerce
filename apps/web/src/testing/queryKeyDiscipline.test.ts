import { describe, expect, it } from 'vitest';
import { keys } from '../lib/queryKeys';
import { UNINVALIDATED_MUTATIONS, RAW_QUERY_KEYS } from './uiWaivers';

/**
 * Two rules about the cache, both of which were broken everywhere.
 *
 * **Every cache key comes from `lib/queryKeys.ts`.** Keys were invented at each
 * use site, so the catalogue alone lived under five shapes and two of them —
 * `['medicines','all']` and `['medicines','for-receipt']` — fetched the
 * *identical URL* into separate entries. Worse, `['delivery-personnel']` was
 * written as a raw array by one page and as a paged collection by another,
 * under one key with five-minute retention: visiting both inside five minutes
 * crashed on `.find is not a function`. A factory makes that a type error.
 *
 * **Every mutation invalidates something.** Nine did not, and did not navigate
 * either — approving an order left it sitting in the queue you had just come
 * from. Fourteen more navigated to a list that then rendered the pre-change row,
 * because two of them return you to the very list they edited and the cache is
 * thirty seconds fresh.
 *
 * The second rule is the weaker of the two and it says so: it asserts that a
 * mutation *invalidates*, not that it invalidates the *right* families. No
 * regex can know that a goods receipt changes the catalogue's availability.
 * What it does catch is the shape every one of those twenty-three defects had —
 * a write with nothing after it.
 */

const SOURCES: ReadonlyMap<string, string> = new Map(
  Object.entries(
    import.meta.glob(['../pages/*.tsx', '../components/**/*.tsx', '../store/*.ts', '../lib/*.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  )
    .filter(([path]) => !path.includes('.test.'))
    // The factory layer itself. `usePagedCollection` composes `[...key, 'page',
    // page]` from a key it was handed, which is the mechanism, not a call site.
    .filter(([path]) => !path.endsWith('lib/query.ts') && !path.endsWith('lib/queryKeys.ts'))
    .map(([path, code]) => [path.replace(/^\.\.\//, ''), code] as const),
);

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The file split at each top-level-ish declaration.
 *
 * Chunks rather than brace-matched function bodies, because the code being
 * examined is written three ways and all three are correct. A page may call
 * `invalidateQueries` beside the write; or funnel every action through a
 * `reload()` declared once at component level — nine do — which is often an
 * arrow function with no braces at all; or wrap the write in `useMutation`,
 * where the request is in `mutationFn` and the refresh is in `onSuccess`, two
 * sibling bodies. A rule that only looked at the innermost body would report
 * all three, and a gate whose failures are mostly correct code is a gate
 * somebody switches off.
 */
function declarations(code: string): { name: string; text: string }[] {
  /*
   * Two spaces of indentation at most — a module-level or component-level
   * declaration. Matching any `const` split `const response = await
   * apiClient.post(…)` out of the `useQuery` that contains it, so the read that
   * fills the cache looked like a write that ignores it.
   */
  const starts = [
    ...code.matchAll(
      /^ {0,2}(?:export\s+)?(?:const|async function|function)\s+([A-Za-z_$][\w$]*)/gm,
    ),
  ];
  return starts.map((match, index) => ({
    name: match[1]!,
    text: code.slice(match.index, starts[index + 1]?.index ?? code.length),
  }));
}

const REFRESHES = /invalidateQueries|refreshNotificationQueries/;
/** Leaving for a screen this one did not change is a complete answer too. */
const LEAVES = /\bnavigate\(|\bsetAuth\(|\bwindow\.location/;

/**
 * Names whose chunk refreshes, following indirection to a fixed point.
 *
 * `Notifications` goes two hops — `markRead` calls `act`, and `act` calls
 * `refreshBoth`, which invalidates. Stopping at one hop would report three
 * correct mutations.
 */
function refreshingNames(chunks: { name: string; text: string }[]): Set<string> {
  const names = new Set(
    chunks.filter((chunk) => REFRESHES.test(chunk.text)).map((chunk) => chunk.name),
  );
  for (let pass = 0; pass < chunks.length; pass += 1) {
    const before = names.size;
    for (const chunk of chunks) {
      if (names.has(chunk.name)) continue;
      if ([...names].some((name) => new RegExp(`\\b${name}\\s*\\(`).test(chunk.text))) {
        names.add(chunk.name);
      }
    }
    if (names.size === before) break;
  }
  return names;
}

/** A write that refreshes nothing and goes nowhere. */
function silentMutations(code: string): string[] {
  const clean = withoutComments(code);
  const chunks = declarations(clean);
  const helpers = [...refreshingNames(chunks)];
  const found: string[] = [];

  for (const chunk of chunks) {
    for (const match of chunk.text.matchAll(
      /apiClient\.(post|patch|put|delete)\(\s*['"`]([^'"`]*)/g,
    )) {
      /*
       * `POST /orders/quote` is a read that needs a request body — it asks the
       * server what a basket would cost and changes nothing. A rule that called
       * every POST a mutation would demand it invalidate the cache it fills.
       */
      if (/queryFn\s*:/.test(chunk.text.slice(0, match.index))) continue;

      const answered =
        REFRESHES.test(chunk.text) ||
        LEAVES.test(chunk.text) ||
        helpers.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(chunk.text));
      if (!answered) found.push(`${match[1]} ${match[2] || '(dynamic)'}`);
    }
  }
  return [...new Set(found)];
}

/** A cache key written as an array literal instead of taken from the factory. */
function rawKeys(code: string): string[] {
  const clean = withoutComments(code);
  const found: string[] = [];
  for (const match of clean.matchAll(
    /(?:queryKey:\s*|use(?:Api|Paged)(?:Collection|Resource)<[^>]*>\(\s*)(\[[^\]]*\])/g,
  )) {
    found.push(match[1]!);
  }
  return [...new Set(found)];
}

describe('the cache has one vocabulary', () => {
  it('found the sources, so a clean run is not an empty one', () => {
    expect(SOURCES.size).toBeGreaterThan(60);
    expect([...SOURCES.keys()]).toContain('pages/MedicineDetail.tsx');
  });

  it('the factory covers every entity the application reads', () => {
    // A factory that lost a family would send its callers back to literals.
    for (const family of Object.values(keys)) {
      expect(Array.isArray((family as { all: readonly string[] }).all)).toBe(true);
    }
    expect(Object.keys(keys).length).toBeGreaterThan(18);
  });

  it('no cache key is written as a literal outside the factory', () => {
    const offenders: string[] = [];
    for (const [name, code] of SOURCES) {
      if (RAW_QUERY_KEYS.includes(name)) continue;
      const raw = rawKeys(code);
      if (raw.length) offenders.push(`${name}: ${raw.join(', ')}`);
    }
    expect(
      offenders,
      'Take these from lib/queryKeys.ts. A key nobody else can name is a key ' +
        'nobody else can invalidate, which is how nine mutations came to ' +
        'refresh nothing.',
    ).toEqual([]);
  });

  it('every mutation refreshes something or leaves the screen', () => {
    const offenders: string[] = [];
    for (const [name, code] of SOURCES) {
      if (UNINVALIDATED_MUTATIONS.includes(name)) continue;
      const silent = silentMutations(code);
      if (silent.length) offenders.push(`${name}: ${silent.join(', ')}`);
    }
    expect(
      offenders,
      'These write to the server and leave every screen showing what was true ' +
        'beforehand. Invalidate the entity family through lib/queryKeys.ts.',
    ).toEqual([]);
  });

  it('the waiver lists have no stale entries', () => {
    expect(RAW_QUERY_KEYS.filter((name) => rawKeys(SOURCES.get(name) ?? '').length === 0)).toEqual(
      [],
    );
    expect(
      UNINVALIDATED_MUTATIONS.filter(
        (name) => silentMutations(SOURCES.get(name) ?? '').length === 0,
      ),
    ).toEqual([]);
  });

  it('detects what it claims to, so a clean run means something', () => {
    // The exact shapes of the two defect families, and the shapes that are fine.
    expect(rawKeys("useApiResource<Medicine>(['medicine', id], '/x')")).toEqual([
      "['medicine', id]",
    ]);
    expect(rawKeys("const q = useQuery({ queryKey: ['orders'], queryFn: f })")).toEqual([
      "['orders']",
    ]);
    expect(rawKeys("useApiResource<Medicine>(keys.medicines.one(id), '/x')")).toEqual([]);
    expect(rawKeys('queryClient.invalidateQueries({ queryKey: keys.orders.all })')).toEqual([]);

    expect(
      silentMutations('async function save() {\n  await apiClient.post("/shops", body);\n}'),
    ).toEqual(['post /shops']);
    expect(
      silentMutations(
        'async function save() {\n  await apiClient.post("/shops", body);\n' +
          '  queryClient.invalidateQueries({ queryKey: keys.shops.all });\n}',
      ),
    ).toEqual([]);
    expect(
      silentMutations(
        'async function save() {\n  await apiClient.post("/shops", body);\n  navigate("/shops");\n}',
      ),
    ).toEqual([]);
    // A comment describing an old defect is not a defect.
    expect(
      silentMutations('// it used to call apiClient.post("/shops") and refresh nothing'),
    ).toEqual([]);
  });
});
