import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RequestHandler, Router } from 'express';
import { API_MOUNTS, HEALTH_ROUTES } from '../routes';

/** One HTTP method at one Express path pattern, with the mount prefix applied. */
export interface ApiRoute {
  method: string;
  path: string;
}

export function routeKey(route: ApiRoute): string {
  return `${route.method.toLowerCase()} ${route.path}`;
}

function joinPrefix(prefix: string, path: string): string {
  if (path === '/' || path === '') return prefix;
  return `${prefix}${path}`;
}

/**
 * The Express layer shape this module reflects off. Express does not publish
 * these as types; naming them here keeps the casts in one place, and the
 * assertion below fails loudly if the shape ever changes rather than silently
 * reporting an empty route table — an empty table would make every coverage
 * check pass.
 */
interface RouterLayer {
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
  };
  handle?: { stack?: RouterLayer[] };
  name?: string;
}

function routesOfRouter(router: Router, prefix: string): ApiRoute[] {
  const stack = (router as unknown as { stack?: RouterLayer[] }).stack;
  if (!Array.isArray(stack)) {
    throw new Error(
      `Cannot read the stack of the router mounted at ${prefix}. Express internals ` +
        `changed; routeTable() must be updated or every route-coverage check becomes vacuous.`,
    );
  }

  const found: ApiRoute[] = [];
  for (const layer of stack) {
    if (!layer.route) {
      // A nested router would need its own mount prefix, which Express does not
      // retain. None exist today; refuse rather than under-report if one appears.
      if (layer.handle?.stack) {
        throw new Error(
          `The router mounted at ${prefix} nests another router. routeTable() cannot ` +
            `recover a nested mount path, so add the inner router to API_MOUNTS instead.`,
        );
      }
      continue;
    }
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const path of paths) {
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (!enabled || method === '_all') continue;
        found.push({ method, path: joinPrefix(prefix, path) });
      }
    }
  }
  return found;
}

/**
 * Every route the running application actually serves.
 *
 * Reflected off the live routers rather than declared, so it cannot drift: a
 * route added to a router file appears here on the next test run whether or not
 * anyone documented it.
 */
export function routeTable(): ApiRoute[] {
  const routes: ApiRoute[] = HEALTH_ROUTES.map((route) => ({ ...route }));
  for (const mount of API_MOUNTS) routes.push(...routesOfRouter(mount.router, mount.prefix));
  return routes.sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
}

// ─── Coverage recording ──────────────────────────────────────────────────────

/**
 * Where the integration suites record the routes they actually reached.
 *
 * `__dirname` is `dist/services` at run time, so this lands beside the package
 * manifest and is git-ignored. A file rather than a module-level set, because
 * `node --test` runs each suite in its own process; nothing else can aggregate
 * across them.
 */
export const COVERAGE_FILE = resolve(__dirname, '../../.route-coverage.log');

export function resetRouteCoverage(): void {
  rmSync(COVERAGE_FILE, { force: true });
}

export function recordedRouteKeys(): Set<string> {
  if (!existsSync(COVERAGE_FILE)) return new Set();
  return new Set(
    readFileSync(COVERAGE_FILE, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

/**
 * Records which route served each request, for the coverage reconciliation.
 *
 * Only active under `NODE_ENV=test`, so production pays nothing. It reads
 * `req.route` on `finish` — by then Express has matched a route and set it, and
 * `req.baseUrl` still holds the mount prefix, which together reconstruct the
 * same key `routeTable()` produces. A request that matched nothing has no
 * `req.route` and is correctly not counted as coverage of anything.
 */
export function routeCoverageRecorder(): RequestHandler[] {
  if (process.env.NODE_ENV !== 'test') return [];
  return [
    (req, res, next) => {
      res.on('finish', () => {
        const route = (req as unknown as { route?: { path?: string } }).route;
        if (!route || typeof route.path !== 'string') return;
        const key = routeKey({ method: req.method, path: joinPrefix(req.baseUrl, route.path) });
        try {
          appendFileSync(COVERAGE_FILE, `${key}\n`);
        } catch {
          // Coverage recording must never be able to fail a request under test.
        }
      });
      next();
    },
  ];
}
