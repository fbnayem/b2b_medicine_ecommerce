import { useCallback, useState } from 'react';
import type { NavGroup } from '@medsupply/navigation';

/**
 * What the sidebar remembers between visits.
 *
 * A super admin is offered thirty-seven destinations in seven groups, all
 * expanded, which comes to roughly 1,900px of sidebar — so on every laptop the
 * navigation scrolled, and the section somebody wanted was as likely to be
 * below the fold as on it. Collapsing a group they never use is the fix, and a
 * collapse that forgets itself on the next page load is not a fix at all.
 *
 * Stored per browser rather than per account: it is a display preference about
 * this screen, not something worth a round trip or a column on the user.
 */

const COLLAPSED_GROUPS = 'medsupply.sidebar.collapsed';
const RAIL = 'medsupply.sidebar.rail';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // Private browsing, a quota, or a value written by an older build. A
    // preference is never worth failing a render over.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* As above. */
  }
}

export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<NavGroup[]>(() =>
    read<NavGroup[]>(COLLAPSED_GROUPS, []),
  );

  const toggle = useCallback((group: NavGroup) => {
    setCollapsed((current) => {
      const next = current.includes(group)
        ? current.filter((entry) => entry !== group)
        : [...current, group];
      write(COLLAPSED_GROUPS, next);
      return next;
    });
  }, []);

  return { collapsed, toggle };
}

export function useRail() {
  const [rail, setRail] = useState<boolean>(() => read<boolean>(RAIL, false));

  const toggle = useCallback(() => {
    setRail((current) => {
      write(RAIL, !current);
      return !current;
    });
  }, []);

  return { rail, toggle };
}
