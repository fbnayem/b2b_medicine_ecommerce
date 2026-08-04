import test from 'node:test';
import assert from 'node:assert/strict';
import { UserRole } from '@medsupply/shared-types';
import { OPERATIONS, buildOpenApiDocument } from './openapi';
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

/**
 * The fourth reconciliation, and the one the first three could not make.
 *
 * Paths agreeing proves the document names real endpoints. It says nothing
 * about **who may call them**, which is the column a reader of the
 * specification most depends on and the one that has now been wrong twice:
 * order submission stayed documented as `SHOP_OWNER`-only for a whole phase
 * after the route opened to `SALES`, and `GET /shops` claimed every role while
 * the router admitted three. Both were found by reading, not by a test.
 *
 * A route with no `requireRole` restricts by nothing of its own, so the
 * document may say `ALL_ROLES` or say nothing — but it must not name a narrower
 * set than the server enforces, because that is a promise of a refusal that
 * will not happen.
 */
test('the roles in the OpenAPI document are the roles the router enforces', () => {
  const enforced = new Map(routeTable().map((route) => [routeKey(route), route.roles]));
  const everyRole = Object.values(UserRole);
  const sorted = (roles: readonly UserRole[]) => [...roles].sort().join(', ');

  const wrong: string[] = [];
  for (const operation of OPERATIONS) {
    const key = `${operation.method} ${toExpressPath(operation.path)}`;
    // A phantom operation is already reported by the test above; do not report
    // the same defect twice in different words.
    if (!enforced.has(key)) continue;

    const guard = enforced.get(key);
    const documented = operation.roles;

    if (guard) {
      if (!documented || sorted(documented) !== sorted(guard)) {
        wrong.push(
          `${key}\n      document: ${documented ? sorted(documented) : '(none — public)'}` +
            `\n      router:   ${sorted(guard)}`,
        );
      }
    } else if (documented && documented.length < everyRole.length) {
      wrong.push(
        `${key}\n      document: ${sorted(documented)}` +
          `\n      router:   no role guard, so nobody is refused by role`,
      );
    }
  }

  assert.deepEqual(
    wrong,
    [],
    'The permission column of the specification disagrees with the server. A client ' +
      'written against it would either expect a refusal that never comes, or be ' +
      'refused an endpoint the document said was theirs:' +
      describe(wrong, 'Correct `roles` in openapi.ts, or the requireRole call on the route.'),
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
