import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { errorMessage, failureReference } from '../../api/client';
import { useLanguage } from '../../lib/useLanguage';
import { EmptyState, ErrorState, LoadingState } from './Feedback';

/**
 * Loading, error and empty, decided in one place.
 *
 * Twenty-nine pages carried a literal "Loading" string and one used
 * `LoadingState`; two used `ErrorState`; nothing offered a retry. The states
 * existed as primitives from Phase 3 and the pages went on hand-rolling them,
 * so the same wait, the same failure and the same "nothing here" looked
 * different on every screen — and "there is nothing here" was routinely
 * indistinguishable from "this broke".
 *
 * Two behaviours worth stating because they are what users notice.
 *
 * **A refetch does not blank the screen.** The spinner appears only while there
 * is nothing to show. Once a list has rendered, revalidation happens behind it,
 * so returning to a screen shows the data instantly instead of flashing a
 * loading state at somebody who was already reading it.
 *
 * **A failure is recoverable and quotable.** Every error offers "Try again" and
 * surfaces the correlation identifier the backend has emitted on every failure
 * since phase 12 and which reached no user until now — so a support call can
 * name the request rather than the hour.
 */

export interface ResourceProps<T> {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  /** What is being waited for, in the user's words rather than the route's. */
  loadingLabel?: string;
  /**
   * Sentence shown when the request fails, before the server's own message.
   * Defaults to the catalogue's "This could not be loaded."
   */
  errorMessageFallback?: string;
  /** Rendered instead of `children` when the payload has nothing in it. */
  empty?: ReactNode;
  /** Defaults to treating an empty array or an empty `items` list as empty. */
  isEmpty?: (data: T) => boolean;
}

function looksEmpty(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0;
  if (data && typeof data === 'object' && 'items' in data) {
    const items = (data as { items: unknown }).items;
    return Array.isArray(items) && items.length === 0;
  }
  return false;
}

export function Resource<T>({
  query,
  children,
  loadingLabel,
  errorMessageFallback,
  empty,
  isEmpty = looksEmpty,
}: ResourceProps<T>) {
  // The resolved language, so a failure is explained in the language the user
  // is reading. `errorMessage` consults the catalogue before the server's own
  // wording, because the server writes for a developer.
  const { language, t } = useLanguage();

  // `isPending` rather than `isFetching`: the second is true during a
  // background revalidation, and using it here is what makes a screen blink.
  if (query.isPending) return <LoadingState label={loadingLabel} />;

  if (query.isError) {
    return (
      <ErrorState
        message={errorMessage(
          query.error,
          language,
          errorMessageFallback ?? t('lists.couldNotLoad'),
        )}
        reference={failureReference(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (isEmpty(query.data)) {
    return <>{empty ?? <EmptyState title={t('common.nothingHere')} />}</>;
  }

  return <>{children(query.data)}</>;
}
