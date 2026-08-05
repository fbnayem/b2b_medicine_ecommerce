import { describe, expect, it } from 'vitest';
import specification from '../../../../docs/openapi.json';

/**
 * Every address this application asks for is one the server serves.
 *
 * The API side of this has been gated since phase 2: `routeCoverage.test.ts`
 * reconciles the mounted routes against the OpenAPI document and against the
 * integration suite, and both waiver lists are at their floor. The *client*
 * side was never checked at all — nothing anywhere connected "the web app
 * requests `/trips`" to "the server serves `/trips`".
 *
 * It happens that no path is wrong today; all 131 request sites reconcile. This
 * is prevention, and it is worth having because of how the failure presents: a
 * renamed endpoint does not break a build or a unit test. It produces a 404,
 * which the client renders as "That could not be found. It may have been
 * removed." — so a distributor is told a record was deleted, and the screen
 * looks like a data problem rather than a code one. That is exactly what
 * fourteen screens did for a day and a half.
 *
 * The document is the right thing to reconcile against rather than the route
 * table: `securityRules.test.ts` byte-compares `docs/openapi.json` with what
 * the current build would emit, so it cannot drift from the mounted routes
 * without that test failing first.
 */

/**
 * Per file, not concatenated.
 *
 * The first version joined every source into one string, and the union lookup
 * below then found the wrong `ReportKind`: `FinancialReports.tsx` and
 * `AnalyticsReports.tsx` each declare a type of that name with entirely
 * different members, so the gate reported five reports missing that this call
 * site never asks for. A name is only unique within its module.
 */
const SOURCES: ReadonlyMap<string, string> = new Map(
  Object.entries(
    import.meta.glob(['../pages/*.tsx', '../components/**/*.tsx', '../api/*.ts', '../store/*.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).filter(([path]) => !path.includes('.test.')),
);

/**
 * Six call sites build the last segment from a variable — `/payments/${id}/
 * ${action}` — where the action is a TypeScript union resolved at the call
 * site. This gate cannot see which member is in play, so it checks the thing it
 * can: that the resource has served actions at all.
 *
 * Said plainly because the difference matters. This catches a renamed or
 * removed **resource**, which is the failure that took fourteen screens down.
 * It does not catch a renamed **action** — for that, the union at the call site
 * is the guard, and it is a compile error rather than a runtime 404. Listing
 * plausible action names here instead would have been worse than useless: the
 * first draft did exactly that and asserted five that have never existed.
 */
const ACTION_STEMS = [
  '/approvals/{p}/{p}',
  '/deliveries/{p}/{p}',
  '/fulfilment/picking/{p}/{p}',
  '/payments/{p}/{p}',
  '/returns/{p}/{p}',
];

/**
 * One site is better than that, and worth doing properly: the financial
 * reports build `/finance/reports/${kind}` where `kind` is a union declared as
 * a literal in the same file. The members are read out of the source rather
 * than restated here, so adding a fourth report and forgetting the endpoint
 * fails the build.
 */
const UNION_SEGMENTS: Record<string, string> = {
  '/finance/reports/{p}': 'ReportKind',
};

function unionMembers(name: string, code: string): string[] {
  const declaration = new RegExp(`type ${name} =([^;]+);`).exec(code);
  if (!declaration) return [];
  return [...declaration[1].matchAll(/'([^']+)'/g)].map((member) => member[1]);
}

function servedPaths(): Set<string> {
  return new Set(
    Object.keys((specification as { paths: Record<string, unknown> }).paths).map((path) =>
      path.replace(/^\/api\/v1/, '').replace(/\{[^}]+\}/g, '{p}'),
    ),
  );
}

/**
 * `/orders/${id}/duplicate?x=1` → `/orders/{p}/duplicate`.
 *
 * Two kinds of interpolation appear in these literals and they must not be
 * treated alike. `${id}` is a path parameter and becomes `{p}`. But
 * `` ${status ? `?status=${status}` : ''} `` is an *optional query string*, and
 * turning it into `{p}` produced `/trips{p}` — a path the server has never
 * served, reported as missing while `/trips` was working. An interpolation
 * carrying `?`, `&` or `=` is a query, so it and everything after it is cut.
 */
function normalise(path: string): string {
  let out = '';
  for (let index = 0; index < path.length; index += 1) {
    if (path[index] === '?') break;
    if (path[index] !== '$' || path[index + 1] !== '{') {
      out += path[index];
      continue;
    }
    let depth = 0;
    let end = index + 1;
    for (; end < path.length; end += 1) {
      if (path[end] === '{') depth += 1;
      else if (path[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const inner = path.slice(index + 2, end);
    if (/[?&=]/.test(inner)) return out;
    out += '{p}';
    index = end;
  }
  return out;
}

/**
 * Reads one string or template literal, honouring `${…}` nesting.
 *
 * A plain regex cannot: `` `/trips${status ? `?status=${status}` : ''}` ``
 * holds a nested template *and* two quote characters, and a lazy `[^`']*`
 * stopped at the first of them, yielding the fragment `/trips${status ?`. That
 * fragment is not a path, so the gate reported five endpoints missing that are
 * served perfectly well — a false alarm, which is the one thing a gate must not
 * produce if anybody is to keep believing it.
 */
function readLiteral(code: string, start: number): string | undefined {
  const quote = code[start];
  if (quote !== '`' && quote !== "'" && quote !== '"') return undefined;
  let depth = 0;
  for (let index = start + 1; index < code.length; index += 1) {
    const character = code[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote === '`' && character === '$' && code[index + 1] === '{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (depth > 0) {
      if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
      continue;
    }
    if (character === quote) return code.slice(start + 1, index);
  }
  return undefined;
}

/**
 * Every path literal handed to the request helpers.
 *
 * Anchored on the helper names rather than on "a string starting with a slash",
 * so a route path in `routes.tsx` or an icon name is not mistaken for a request.
 */
interface Request {
  path: string;
  /** The module it was written in, so a union can be resolved in its own scope. */
  file: string;
}

function requestedPaths(): Request[] {
  const found = new Map<string, Request>();
  for (const [file, code] of SOURCES) {
    const openers = [
      ...code.matchAll(/use(?:Api|Paged)(?:Collection|Resource)<[^>]*>\(\s*\[[^\]]*\],\s*/g),
      ...code.matchAll(/apiClient\.(?:get|post|patch|put|delete)\(\s*/g),
    ];
    for (const opener of openers) {
      const path = readLiteral(code, opener.index + opener[0].length);
      if (path?.startsWith('/') && !found.has(path)) found.set(path, { path, file });
    }
  }
  return [...found.values()];
}

describe('the web app only asks for addresses the API serves', () => {
  it('found the request sites, so a clean run is not an empty one', () => {
    // A glob or a regex that matched nothing would satisfy the assertion below
    // in perfect silence, which is the failure mode this whole file is about.
    const paths = requestedPaths().map((request) => request.path);
    expect(paths.length).toBeGreaterThan(60);
    expect(paths).toContain('/orders');
    expect(servedPaths().size).toBeGreaterThan(150);
  });

  it('every requested path is in the published specification', () => {
    const served = servedPaths();
    const missing: string[] = [];

    for (const { path, file } of requestedPaths()) {
      const normalised = normalise(path);
      if (served.has(normalised)) continue;

      // A last segment drawn from a named union: every member must be served.
      const union = UNION_SEGMENTS[normalised];
      if (union) {
        const stem = normalised.slice(0, normalised.lastIndexOf('/'));
        const members = unionMembers(union, SOURCES.get(file) ?? '');
        if (members.length === 0) {
          missing.push(`${path} → the ${union} union could not be read`);
          continue;
        }
        const absent = members.filter((member) => !served.has(`${stem}/${member}`));
        if (absent.length) missing.push(`${path} → no such report: ${absent.join(', ')}`);
        continue;
      }

      // A path whose last segment is a variable action: the resource must at
      // least still have actions. See the note on ACTION_STEMS.
      if (ACTION_STEMS.includes(normalised)) {
        const stem = normalised.slice(0, normalised.lastIndexOf('/'));
        const children = [...served].filter((candidate) => candidate.startsWith(`${stem}/`));
        if (children.length === 0) missing.push(`${path} → ${stem} serves no actions at all`);
        continue;
      }

      missing.push(`${path} → ${normalised} is not served`);
    }

    expect(
      missing,
      'These are requested by the web app and absent from docs/openapi.json. A request to an ' +
        'address the server does not serve renders as "That could not be found. It may have ' +
        'been removed." — a data problem, when it is a code one.',
    ).toEqual([]);
  });

  it('the rule detects what it claims to', () => {
    const served = servedPaths();
    // The two paths from the report, and a name that has never existed.
    expect(served.has('/trips')).toBe(true);
    expect(served.has('/pricing/schemes')).toBe(true);
    expect(served.has('/delivery-rounds')).toBe(false);
    // Parameters normalise rather than being compared literally.
    expect(normalise('/orders/${order._id}/duplicate')).toBe('/orders/{p}/duplicate');
    expect(served.has(normalise('/orders/${id}/duplicate'))).toBe(true);
  });
});
