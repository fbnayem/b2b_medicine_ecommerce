import { useId, useState } from 'react';
import { Link, useSearchParams, type To } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import clsx from 'clsx';
import { formatQuantity } from '@medsupply/utilities';
import { Button, Resource } from './ui';
import type { Collection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';

/**
 * The shelf hierarchy the catalogue can be browsed by.
 *
 * Mirrors what `GET /inventory/categories` serves. Declared here rather than in
 * `@medsupply/shared-types` because this run owns only the web files; if the
 * shape ever grows a second consumer, this is the interface to move.
 */
export interface CategoryNode {
  name: string;
  /** The full trail to here — `["Medicine", "Antimicrobial"]`. */
  path: string[];
  /** Products filed at or under this branch. Rolled up server-side. */
  count: number;
  children: CategoryNode[];
}

/** Whether this branch is, or holds, the name the reader is filtered to. */
function holds(node: CategoryNode, branch: string): boolean {
  return node.name === branch || node.children.some((child) => holds(child, branch));
}

/**
 * One look for every row, chosen once so the "Everything" entry and a
 * fifth-level leaf cannot drift apart in weight or hit area.
 */
function rowClass(current: boolean): string {
  return clsx(
    'flex min-h-11 items-center justify-between gap-2 rounded-md px-2 text-sm no-underline',
    current ? 'bg-brand-subtle font-medium text-brand' : 'text-text hover:bg-surface-hover',
  );
}

interface BranchProps {
  node: CategoryNode;
  branch: string;
  linkFor: (branch?: string) => To;
}

/**
 * A node and, when the reader is inside it, its children.
 *
 * Children render only along the trail that holds the active branch — a
 * drill-down, not an expand/collapse widget. That is a deliberate trade: a full
 * ARIA tree needs roving tabindex and arrow-key handling to be honest about the
 * role it claims, and a separate toggle beside every name needs its own
 * accessible label per node. Plain links need neither — Tab reaches every
 * visible one, and opening a branch is the same act as filtering to it, which
 * is the only reason anybody opens one here. The cost is that you cannot peek
 * inside a branch without visiting it; the counts on every row are what tell
 * you whether the visit is worth making.
 */
function Branch({ node, branch, linkFor }: BranchProps) {
  const current = node.name === branch;
  const open = branch !== '' && node.children.length > 0 && holds(node, branch);
  return (
    <li>
      <Link
        to={linkFor(node.name)}
        aria-current={current ? 'true' : undefined}
        className={rowClass(current)}
      >
        <span>{node.name}</span>
        {/*
          The count is the point of the row: it says whether the branch is
          worth opening before anybody pays for the click. Left in the link's
          accessible name on purpose, so a screen reader hears it too.
        */}
        <span className={clsx('tabular-nums', current ? 'text-brand' : 'text-text-muted')}>
          {formatQuantity(node.count)}
        </span>
      </Link>
      {open && (
        <ul className="m-0 ms-2 mt-1 flex list-none flex-col gap-1 border-s border-border p-0 ps-2">
          {/* Sibling names are unique — the server groups by name per level. */}
          {node.children.map((child) => (
            <Branch key={child.name} node={child} branch={branch} linkFor={linkFor} />
          ))}
        </ul>
      )}
    </li>
  );
}

export interface CategoryTreeProps {
  /** The page owns the fetch, so the cache key stays in the page's family. */
  query: UseQueryResult<Collection<CategoryNode>>;
  className?: string;
}

/**
 * The catalogue's shelves, as links that set `?branch=`.
 *
 * Links rather than buttons, for the same reason `LinkButton` exists: choosing
 * a shelf is navigation — the address changes, the back button undoes it, and a
 * breadcrumb on the detail page lands on the same URL — so it must be a real
 * `<a>` that can be middle-clicked and copied. Everything else about the
 * filter (which page, which sort) is preserved from the current search string,
 * except that `branch` itself is replaced.
 */
export function CategoryTree({ query, className }: CategoryTreeProps) {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const branch = searchParams.get('branch') ?? '';
  /*
   * Collapsed by default below `lg`. On a phone the tree would otherwise sit —
   * twelve roots tall, more once a branch is open — between the search box and
   * the first product, which is the content the visit is for.
   */
  const [openOnSmall, setOpenOnSmall] = useState(false);
  const panelId = useId();

  const linkFor = (name?: string): To => {
    const next = new URLSearchParams(searchParams);
    if (name) next.set('branch', name);
    else next.delete('branch');
    const search = next.toString();
    return { search: search ? `?${search}` : '' };
  };

  return (
    <nav aria-label={t('catalogue.categories')} className={className}>
      <Button
        className="w-full lg:hidden"
        aria-expanded={openOnSmall}
        aria-controls={panelId}
        onClick={() => setOpenOnSmall((open) => !open)}
      >
        {t('catalogue.categories')}
      </Button>
      <div id={panelId} className={clsx(openOnSmall ? 'mt-3 block' : 'hidden', 'lg:mt-0 lg:block')}>
        <Resource
          query={query}
          loadingLabel={t('catalogue.categoriesLoading')}
          /*
            A catalogue with no shelved products has nothing to browse by, and
            a sidebar announcing that would be noise beside a list that already
            says whatever needs saying. `<></>` rather than `null` because
            `Resource` treats null as "use the default EmptyState".
          */
          empty={<></>}
        >
          {(tree) => (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              <li>
                {/*
                  No count on "Everything": the roots' figures sum to the
                  products that carry a trail, which is not the whole
                  catalogue, and a number here would disagree with the
                  "Showing 1–24 of N" line beside the list.
                */}
                <Link
                  to={linkFor()}
                  aria-current={branch ? undefined : 'true'}
                  className={rowClass(!branch)}
                >
                  <span>{t('catalogue.allCategories')}</span>
                </Link>
              </li>
              {tree.items.map((root) => (
                <Branch key={root.name} node={root} branch={branch} linkFor={linkFor} />
              ))}
            </ul>
          )}
        </Resource>
      </div>
    </nav>
  );
}
