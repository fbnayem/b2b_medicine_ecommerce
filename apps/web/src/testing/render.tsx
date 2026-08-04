import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AskProvider, Toaster } from '../components/ui';

/**
 * Renders a page with the providers `AppShell` gives it in the real
 * application.
 *
 * Component tests mount one leaf page at a time, which is a deliberate and good
 * choice — it keeps them fast and specific — but it means a page reaching for
 * something the shell provides finds nothing. Use this wherever a test clicks
 * an action that asks the user to confirm something, and — since phase 21 —
 * for any page at all, because every page reads its data through TanStack
 * Query and `useQuery` throws without a client above it.
 *
 * **Retries are off and nothing is cached between renders.** A failed request
 * has to surface as an error state on the first attempt rather than after a
 * silent retry the assertion never waits for, and a fresh client per render
 * stops one test being served another's fixture from cache — which is the kind
 * of order-dependent pass that is very hard to read six months later.
 */
function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithUi(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  const client = testQueryClient();
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <AskProvider>
          {children}
          {/*
            `AppShell` renders one of these, and a `toast()` with no toaster
            mounted is silently dropped — so a page whose only feedback is a
            toast would be untestable, and worse, would look tested.
          */}
          <Toaster />
        </AskProvider>
      </QueryClientProvider>
    ),
    ...options,
  });
}
