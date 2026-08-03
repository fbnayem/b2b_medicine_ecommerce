import { Link } from 'react-router-dom';
import { landingRouteFor } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';

/**
 * A real "not found" screen.
 *
 * The catch-all previously redirected to `/login`, which is how the shop-owner
 * routing defect stayed invisible for twelve phases: a signed-in user reaching
 * a path that did not exist was silently returned to the sign-in form, so a
 * wrong link and a rejected password looked exactly the same.
 */
export function NotFound() {
  const user = useAuthStore((state) => state.user);
  const home = user ? landingRouteFor(user.role as UserRole) : '/login';

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold text-text">That page does not exist</h1>
      <p className="text-text-muted">
        The address may have been mistyped, or the page may have moved. You are still signed in.
      </p>
      <Link
        to={home}
        className="flex min-h-11 w-fit items-center rounded-md bg-brand px-4 text-on-brand"
      >
        Go to the home screen
      </Link>
    </main>
  );
}
