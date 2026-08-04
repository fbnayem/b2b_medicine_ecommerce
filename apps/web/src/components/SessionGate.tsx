import { useEffect, type ReactNode } from 'react';
import { restoreSession } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { LoadingState } from './ui';

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
    /*
     * Deliberately not translated: this renders *above* the language provider,
     * which cannot resolve a language until the session it is waiting on has
     * been restored. `LoadingState` supplies the live region either way.
     */
    return (
      <main className="mx-auto max-w-xl p-6">
        <LoadingState label="Restoring your session" />
      </main>
    );
  }

  return <>{children}</>;
}
