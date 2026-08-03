import { UserRole } from '@medsupply/shared-types';
import { describe, expect, it } from 'vitest';
// Imported as text, not as a module: `?raw` is Vite's own mechanism, so this
// needs no Node type definitions, which this app's tsconfig does not include.
import appSource from '../App.tsx?raw';
import { landingRouteFor } from './landing';

/**
 * Every post-sign-in destination must be a path the router declares.
 *
 * `Login.tsx` sent shop owners to `/shop`, which no route has ever declared.
 * The catch-all matched it and redirected to `/login`, so the entire role was
 * locked out of the web application — and nothing noticed, because no test
 * signed in, the typechecker cannot know which strings are routes, and the one
 * role affected had no other way in.
 *
 * The router is read as text rather than rendered, because rendering `App.tsx`
 * pulls in all 41 page modules and their API clients. The point here is the
 * narrow one: does this string appear as a declared path.
 */
function declaredRoutes(): Set<string> {
  return new Set([...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]));
}

describe('sign-in landing routes', () => {
  it('sends every role to a route that actually exists', () => {
    const routes = declaredRoutes();
    expect(routes.size).toBeGreaterThan(10);

    const broken = Object.values(UserRole)
      .map((role) => ({ role, path: landingRouteFor(role) }))
      .filter(({ path }) => !routes.has(path));

    expect(broken).toEqual([]);
  });

  it('covers every role in the enum', () => {
    for (const role of Object.values(UserRole)) {
      expect(landingRouteFor(role)).toMatch(/^\//);
    }
  });

  it('no longer points anyone at the path that did not exist', () => {
    const destinations = Object.values(UserRole).map(landingRouteFor);
    expect(destinations).not.toContain('/shop');
  });
});
