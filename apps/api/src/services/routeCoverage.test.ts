import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiDocument } from './openapi';
import { COVERAGE_FILE, recordedRouteKeys, routeKey, routeTable } from './routeTable';
import { UNDOCUMENTED_ROUTES, UNTESTED_ROUTES } from './routeCoverage.waivers';

/**
 * Reconciles three descriptions of the API that are meant to agree:
 *
 *   1. the routes the Express application actually serves,
 *   2. the routes the OpenAPI document promises,
 *   3. the routes any integration test has ever reached.
 *
 * The project shipped a `POST /api/v1/users` that no test called and no client
 * used, and its bug — every created account silently took the creator's own
 * role — survived twelve phases because nothing ever exercised it. A coverage
 * percentage would not have caught that either; it would have read "88%" and
 * said nothing about which endpoint was the missing 12%. So instead of a
 * percentage this holds an explicit list of the routes nothing reaches, and
 * fails when the list is wrong in either direction: a new uncovered route must
 * be added deliberately, and a route that gains coverage must be struck off.
 *
 * The second rule is the one that makes the list shrink. Without it a waiver
 * would outlive the gap it waived and the list would only ever grow.
 */

/** OpenAPI writes `{id}`; Express writes `:id`. Same route, two notations. */
function toExpressPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}

function documentedRouteKeys(): Set<string> {
  const document = buildOpenApiDocument();
  const keys = new Set<string>();
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const method of Object.keys(methods as Record<string, unknown>)) {
      keys.add(`${method} ${toExpressPath(path)}`);
    }
  }
  return keys;
}

function describe(keys: string[], hint: string): string {
  return `\n${keys.map((key) => `  ${key}`).join('\n')}\n${hint}`;
}

test('the route table reflects a real application', () => {
  const routes = routeTable();
  assert.ok(
    routes.length > 100,
    `Reflected only ${routes.length} routes. The application has around 150, so the ` +
      `reflection is broken and every check in this file has become vacuous.`,
  );
});

test('every documented operation exists as a route', () => {
  const real = new Set(routeTable().map(routeKey));
  const phantom = [...documentedRouteKeys()].filter((key) => !real.has(key)).sort();

  assert.deepEqual(
    phantom,
    [],
    'The OpenAPI document promises endpoints that do not exist. A client written ' +
      'against the specification would receive 404s from these:' +
      describe(phantom, 'Correct the path in openapi.ts, or add the missing route.'),
  );
});

test('every route is documented, or explicitly waived', () => {
  const documented = documentedRouteKeys();
  const waived = new Set(UNDOCUMENTED_ROUTES);
  const real = routeTable().map(routeKey);

  const missing = real.filter((key) => !documented.has(key) && !waived.has(key)).sort();
  assert.deepEqual(
    missing,
    [],
    'These routes are served but appear nowhere in the OpenAPI document:' +
      describe(missing, 'Add an entry to OPERATIONS, or waive it in routeCoverage.waivers.ts.'),
  );

  const stale = [...waived].filter((key) => documented.has(key) || !real.includes(key)).sort();
  assert.deepEqual(
    stale,
    [],
    'These waivers are out of date — the route is now documented, or no longer exists:' +
      describe(stale, 'Delete them from UNDOCUMENTED_ROUTES in routeCoverage.waivers.ts.'),
  );
});

test('every route is exercised by an integration test, or explicitly waived', () => {
  const reached = recordedRouteKeys();
  assert.ok(
    reached.size > 0,
    `No route hits were recorded at ${COVERAGE_FILE}. This suite must run after the ` +
      `integration suites in the same working directory, otherwise it silently passes ` +
      `over an application nothing has called.`,
  );

  const waived = new Set(UNTESTED_ROUTES);
  const real = routeTable().map(routeKey);

  const untested = real.filter((key) => !reached.has(key) && !waived.has(key)).sort();
  assert.deepEqual(
    untested,
    [],
    'These routes are served but no integration test reaches them:' +
      describe(untested, 'Cover them, or waive them in routeCoverage.waivers.ts with a reason.'),
  );

  const stale = [...waived].filter((key) => reached.has(key) || !real.includes(key)).sort();
  assert.deepEqual(
    stale,
    [],
    'These waivers are out of date — the route is now covered, or no longer exists. ' +
      'This is the assertion that makes the list shrink:' +
      describe(stale, 'Delete them from UNTESTED_ROUTES in routeCoverage.waivers.ts.'),
  );
});
