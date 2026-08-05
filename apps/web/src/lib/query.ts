import { useState } from 'react';
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

/**
 * The client the application is currently using, for code outside React.
 *
 * `useNotifications` is a zustand store, so it cannot call `useQueryClient()` —
 * and marking a notification read from the bell left the notifications *page*
 * showing it unread, because the store refreshed its own state and the query
 * cache heard nothing.
 *
 * A module-level reference, which is the same shape as the branding cache this
 * phase removes — so the difference is worth stating. That one cached *data*
 * and never expired it, which is why a settings change needed a hard reload.
 * This holds a reference to the live client and caches nothing; every read
 * still goes through the cache's own freshness rules. Tests that build their
 * own client simply register it in turn.
 */
let active: QueryClient | undefined;

export function activeQueryClient(): QueryClient | undefined {
  return active;
}

export function createQueryClient(): QueryClient {
  active = new QueryClient({
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
  return active;
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
 * The API answers a list in four shapes. Some endpoints send
 * `{ items, total, page, limit }`, some send `{ data: [...] }` with nothing
 * else, some send `{ data: [...], meta: { page, limit, total, pages } }`, and
 * the purchasing endpoints send `{ data: { items, total, page, limit } }` —
 * `orderController`, `returnController`, `purchasingController` and
 * `activityService` disagree about this today. Normalising here means a page never has to know which kind it is
 * talking to, and in particular that **a page cannot silently lose its
 * pagination** by reading `total` from the wrong place and getting the length
 * of the current page back.
 *
 * This hides an inconsistency rather than fixing it. The real repair is
 * server-side, and it belongs with the API work rather than with a UI phase;
 * recorded so it is not mistaken for the intended design.
 */
/**
 * Normalises whichever of the four envelopes came back.
 *
 * Exported and pure so it can be tested against each real shape. It was inline,
 * and the shape the purchasing endpoints use fell through every branch and
 * produced an empty list with a total of zero — which renders as a working
 * screen with nothing on it, the hardest kind of failure to notice.
 */
export function normaliseCollection<T>(payload: Record<string, unknown>): Collection<T> {
  const nested =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : undefined;
  const source = nested && Array.isArray(nested.items) ? nested : payload;

  const items = Array.isArray(source.items)
    ? (source.items as T[])
    : Array.isArray(source.data)
      ? (source.data as T[])
      : [];
  const meta = (source.meta ?? source) as Record<string, unknown>;
  const number = (value: unknown, fallback: number) =>
    typeof value === 'number' ? value : fallback;

  return {
    items,
    total: number(meta.total, items.length),
    page: number(meta.page, 1),
    limit: number(meta.limit, items.length),
  };
}

export function useApiCollection<T>(
  key: readonly unknown[],
  url: string,
  options?: Omit<UseQueryOptions<Collection<T>>, 'queryKey' | 'queryFn'>,
): UseQueryResult<Collection<T>> {
  return useQuery<Collection<T>>({
    queryKey: key,
    queryFn: async ({ signal }) =>
      normaliseCollection<T>(
        (await apiClient.get(url, { signal })).data as Record<string, unknown>,
      ),
    ...options,
  });
}

/**
 * A list that can be read past its first page.
 *
 * Only six of the thirty list screens rendered `<Pagination>`. The rest asked
 * for a collection, got the server's default page — twenty rows for orders —
 * and displayed exactly that, with **no indication that anything followed**. A
 * list that silently stops is worse than an error: the reader has no reason to
 * doubt it, so an order placed last week is simply not there, and the screen
 * looks entirely healthy while it happens.
 *
 * The server has always answered with `total`, `page` and `limit`, and
 * `normaliseCollection` has always carried them through. Nothing was missing
 * except somebody asking for page two.
 */
export function usePagedCollection<T>(
  key: readonly unknown[],
  /** The path, with any filters already applied. `page` is appended here. */
  url: string,
  options?: Omit<UseQueryOptions<Collection<T>>, 'queryKey' | 'queryFn'>,
): UseQueryResult<Collection<T>> & { page: number; setPage: (page: number) => void } {
  const [page, setPage] = useState(1);

  /*
   * Changing a filter returns to the first page.
   *
   * Without this, narrowing a list while on page four shows an empty screen —
   * the filter matches nine rows, page four of nine rows is nothing — and it
   * reads as "no results" rather than as "you are past the end".
   */
  const filterKey = JSON.stringify(key);
  const [seenKey, setSeenKey] = useState(filterKey);
  if (filterKey !== seenKey) {
    setSeenKey(filterKey);
    if (page !== 1) setPage(1);
  }

  const query = useApiCollection<T>(
    [...key, 'page', page],
    `${url}${url.includes('?') ? '&' : '?'}page=${page}`,
    options,
  );

  return { ...query, page, setPage } as UseQueryResult<Collection<T>> & {
    page: number;
    setPage: (page: number) => void;
  };
}
