import { Suspense, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Login } from './pages/Login';
import { Unauthorized } from './pages/Unauthorized';
import { NotFound } from './pages/NotFound';
import { AppShell } from './components/AppShell';
import { RoleGate } from './components/RoleGate';
import { SessionGate } from './components/SessionGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingState } from './components/ui';
import { resolvedRoutes } from './app/routes';
import { LanguageProvider } from './lib/useLanguage';
import { createQueryClient } from './lib/query';

/**
 * Every route, generated from the manifest.
 *
 * This file was 208 lines of nested `<Route>` elements carrying ten inline role
 * arrays. Two other places — `Dashboard.tsx`'s tile grid and mobile's guards —
 * wrote out the same permission matrix again. `@medsupply/navigation` now holds
 * it once and all three read from it.
 *
 * Two orderings here are load-bearing:
 *
 *   - `RoleGate` sits **outside** the lazy boundary, so an unauthorised role is
 *     turned away before their browser fetches the chunk. A shop owner should
 *     not hold the administration bundle on their laptop, refused or not.
 *   - `ErrorBoundary` sits **above** the router, so a render throw shows a
 *     sentence instead of the blank page it used to.
 */
function App() {
  const routes = resolvedRoutes();
  /*
   * Created once per mount rather than at module load. A module-level client is
   * shared by every test in a file, so one case's cached response answers the
   * next one's query and the failure looks like a flaky test rather than
   * leaked state.
   */
  const [queryClient] = useState(createQueryClient);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <BrowserRouter>
            <SessionGate>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/unauthorized" element={<Unauthorized />} />

                <Route element={<AppShell />}>
                  {routes.map((route) => {
                    const Element = route.element;
                    return (
                      <Route key={route.id} element={<RoleGate allowedRoles={route.nav.roles} />}>
                        <Route
                          path={route.nav.path}
                          element={
                            <Suspense
                              fallback={<LoadingState label={`Opening ${route.nav.label}`} />}
                            >
                              <Element {...(route.props ?? {})} />
                            </Suspense>
                          }
                        />
                      </Route>
                    );
                  })}
                </Route>

                {/* A real screen, not a redirect to the sign-in form. */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </SessionGate>
          </BrowserRouter>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
