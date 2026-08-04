import { useCallback, useState } from 'react';

/**
 * A queue filter that survives leaving the page.
 *
 * Every queue in this application resets to "everything" on each visit, and a
 * storekeeper's day is a loop: open the queue, pick the top job, do it, come
 * back. Coming back to an unfiltered list means re-choosing the same filter
 * twenty times a shift, so most people stop filtering and read past the rows
 * that are not theirs instead.
 *
 * Deliberately `localStorage` and not the URL. A shared bookmark or a link
 * pasted into a group chat should show what it says it shows; this is a
 * per-person habit, and it belongs on the person's machine rather than in
 * something they might send to somebody else.
 */

const PREFIX = 'medsupply.filter.';

export function readSavedFilter(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(PREFIX + key) ?? fallback;
  } catch {
    // Private browsing, a full quota, or a locked-down terminal. A remembered
    // filter is a convenience and must never be the reason a queue fails to
    // render.
    return fallback;
  }
}

export function writeSavedFilter(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* See above: losing the preference is acceptable, throwing is not. */
  }
}

export function useSavedFilter(key: string, fallback: string): [string, (next: string) => void] {
  const [value, setValue] = useState(() => readSavedFilter(key, fallback));

  const update = useCallback(
    (next: string) => {
      setValue(next);
      writeSavedFilter(key, next);
    },
    [key],
  );

  return [value, update];
}
