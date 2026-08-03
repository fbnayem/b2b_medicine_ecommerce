import { useEffect, type ReactNode } from 'react';
import { restoreSession } from '../api/client';
import { useAuthStore } from '../store/useAuth';

/**
 * Holds the application back until it knows whether the browser is holding a
 * live session.
 *
 * Nothing did this before, so `isAuthenticated` was false for the first paint
 * of every page load and the route guards read that as signed out. A refresh
 * in the middle of an order, a link opened in a new tab, or a browser restart
 * all dropped the user on the login screen with a live session sitting unused
 * in an HTTP-only cookie.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    void restoreSession();
  }, []);

  if (status === 'restoring') {
    return (
      <main className="inventory-page">
        <section className="state" role="status" aria-live="polite">
          Restoring your session…
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
