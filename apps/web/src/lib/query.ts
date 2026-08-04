import {
  QueryClient,
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient } from '../api/client';

/**
 * One data layer instead of thirty-five.
 *
 * Thirty-five pages hand-rolled a `useEffect` fetch and thirty-two a loading
 * boolean, each with its own error sentence — "Unable to load orders.",
 * "Unable to load payments.", a dozen more — and **not one of them offered a
 * retry**. A failed request was a dead end with a sentence in it, and the same
 * list refetched from scratch, spinner and all, every time somebody navigated
 * back to it.
 *
 * TanStack Query is what `AGENTS.md:106`, `docs/ARCHITECTURE.md:35` and
 * `README.md:8` have specified since the beginning and what none of them ever
 * got. The reason it belongs here rather than in a smaller hand-rolled hook is
 * the thing users actually feel: a cached list renders **immediately** and
 * revalidates behind itself, so moving between screens stops costing a spinner
 * each time.
 */

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /*
         * Long enough that moving between screens is instant, short enough that
         * a warehouse terminal left open does not act on yesterday's stock.
         * Anything genuinely live — queues, availability — arrives over the
         * existing socket and invalidates its key, so this is a floor rather
         * than the freshness guarantee.
         */
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        /*
         * One retry, not the default three. A storekeeper watching a slow
         * screen wants to be told it failed, not to wait through three silent
         * attempts — and `ErrorState` gives them a button, which is a better
         * answer than guessing on their behalf.
         */
        retry: 1,
        refetchOnWindowFocus: true,
        // The interceptor already redirects on a dead session; retrying a 401
        // or a 403 only delays that.
        throwOnError: false,
      },
      mutations: { retry: 0 },
    },
  });
}

/** A single record: the API wraps these as `{ data: … }`. */
export function useApiResource<T>(
  key: readonly unknown[],
  url: string,
  options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>,
): UseQueryResult<T> {
  return useQuery<T>({
    queryKey: key,
    queryFn: async ({ signal }) => (await apiClient.get(url, { signal })).data.data as T,
    ...options,
  });
}

export interface Collection<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * A list, tolerating both response shapes the API actually returns.
 *
 * Paginated endpoints answer `{ items, total, page, limit }` while older ones
 * answer `{ data: [...] }` — `orderController` and `returnController` disagree
 * about this today. Normalising here means a page never has to know which kind
 * it is talking to.
 *
 * This hides an inconsistency rather than fixing it. The real repair is
 * server-side, and it belongs with the API work rather than with a UI phase;
 * recorded so it is not mistaken for the intended design.
 */
export function useApiCollection<T>(
  key: readonly unknown[],
  url: string,
  options?: Omit<UseQueryOptions<Collection<T>>, 'queryKey' | 'queryFn'>,
): UseQueryResult<Collection<T>> {
  return useQuery<Collection<T>>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const payload = (await apiClient.get(url, { signal })).data as Record<string, unknown>;
      const items = Array.isArray(payload.items)
        ? (payload.items as T[])
        : Array.isArray(payload.data)
          ? (payload.data as T[])
          : [];
      return {
        items,
        total: typeof payload.total === 'number' ? payload.total : items.length,
        page: typeof payload.page === 'number' ? payload.page : 1,
        limit: typeof payload.limit === 'number' ? payload.limit : items.length,
      };
    },
    ...options,
  });
}
