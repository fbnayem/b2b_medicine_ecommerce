import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuth';
import { landingRouteFor } from './landing';

/**
 * What the address of this application actually opens.
 *
 * Here rather than in `pages/`, and the design-system gate is the reason it is
 * worth saying so: everything in `pages/` must carry a `PageHeader` and take
 * its words from the catalogue, because everything in `pages/` is a screen a
 * person reads. This renders nothing and is read by nobody. It is routing, so
 * it lives beside the routing.
 *
 * Named `FrontDoor` and not `Landing` because `landing.ts` sits next to it,
 * and Windows resolves `./Landing` to `./landing` — an import that works on
 * CI and hands back `undefined` on the machine this was written on.
 *
 * There was no route for `/`. Fifty-one paths are declared in the manifest and
 * every one of them is a sub-path, so the origin itself — the thing a browser
 * autocompletes to, the thing a bookmark of the site is, the thing a
 * deployment serves at its root — fell through to the catch-all and told the
 * visitor the page did not exist.
 *
 * It survived because every one of the 116 browser assertions types the path
 * it wants. `signIn` goes to `/login`; the screens sweep walks the manifest.
 * Nothing ever asked for the front door.
 *
 * `SessionGate` sits above this in `App.tsx` and holds the render until the
 * refresh cookie has been redeemed, so by the time this runs the answer to
 * "are you signed in" is known. Without that ordering this component would
 * send everybody to the login form on every cold load.
 */
export function FrontDoor() {
  const { isAuthenticated, user } = useAuthStore();

  return <Navigate to={isAuthenticated && user ? landingRouteFor(user.role) : '/login'} replace />;
}
