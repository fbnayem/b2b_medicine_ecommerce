import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import clsx from 'clsx';
import { useLanguage } from '../../lib/useLanguage';

/**
 * Cards, tables, badges and page headers.
 *
 * The table styling is the part that matters most. Every cell in this
 * application was `text-align: left` and `white-space: nowrap`, so money
 * columns were ragged — you cannot scan a column of amounts for the large one
 * when the digits do not line up — and no table could ever reflow, which turned
 * each of them into a horizontal scroll strip on a phone. Delivery riders read
 * these on phones.
 */

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('rounded-panel border border-border bg-surface p-4 shadow-card', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface PageHeaderProps {
  /**
   * The stable route id from the manifest. Emitted as `data-test="page-<id>"`
   * so the end-to-end contract is satisfied by construction rather than as a
   * per-page tax somebody forgets on the forty-second page.
   */
  routeId: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ routeId, title, description, actions }: PageHeaderProps) {
  return (
    <header
      data-test={`page-${routeId}`}
      className="mb-6 flex flex-wrap items-start justify-between gap-4"
    >
      <div>
        <h1 className="text-2xl font-semibold text-text">{title}</h1>
        {description && <p className="mt-1 text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** A sentence under the figure — what it is measured against, or since when. */
  note?: ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
  className?: string;
}

/**
 * One figure, labelled.
 *
 * `FinanceSummaryCards` drew these with `metric-grid`, a class from the deleted
 * `inventory.css`, and the analytics dashboard hand-rolls nine bare `Card`s
 * with their own type sizes. A figure somebody reads at a glance should be the
 * largest thing in its box and the label the smallest, and that decision is
 * worth making once.
 */
export function Stat({ label, value, note, tone = 'neutral', className }: StatProps) {
  const emphasis = {
    neutral: 'text-text',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];
  return (
    <div
      className={clsx(
        'flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3',
        className,
      )}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</span>
      <span className={clsx('text-2xl font-semibold tabular-nums', emphasis)}>{value}</span>
      {note && <span className="text-sm text-text-muted">{note}</span>}
    </div>
  );
}

/** The grid these sit in, so four metrics wrap the same way on every screen. */
export function StatGrid({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    // The wrapper scrolls, not the page body. A table wider than the viewport
    // must not drag the whole layout sideways.
    <div className="w-full overflow-x-auto rounded-lg border border-border">
      <table className={clsx('w-full border-collapse bg-surface text-left', className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  className,
  numeric,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      // `scope` on every header, so a screen reader can say which column a cell
      // belongs to instead of reading a flat sequence of numbers.
      scope={rest.scope ?? 'col'}
      className={clsx(
        'sticky top-0 z-10 border-b border-border bg-surface-sunken px-3 py-2',
        'text-sm font-semibold text-text-muted',
        numeric && 'text-right',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  className,
  numeric,
  children,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={clsx(
        'border-b border-border px-3 py-2 align-middle',
        // Money and quantities right-aligned with fixed-width digits, so a
        // column can be scanned rather than read.
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

/**
 * `progress` and `transit` are the two additions, and they exist because a
 * queue of orders could not be scanned: ten of the twenty-two order statuses
 * were rendered in the same `info` blue, so telling "packed" from "submitted"
 * meant reading every pill instead of seeing the shape of the queue.
 */
export type BadgeTone =
  'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'progress' | 'transit';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-text-muted border-border',
  brand: 'bg-brand-subtle text-brand border-brand',
  success: 'bg-success-subtle text-success border-success',
  warning: 'bg-warning-subtle text-warning border-warning',
  danger: 'bg-danger-subtle text-danger border-danger',
  info: 'bg-info-subtle text-info border-info',
  progress: 'bg-progress-subtle text-progress border-progress',
  transit: 'bg-transit-subtle text-transit border-transit',
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}

export function Pagination({ page, limit, total, onPage }: PaginationProps) {
  const { t } = useLanguage();
  const pages = Math.max(1, Math.ceil(total / limit));
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <nav
      aria-label={t('lists.pagination')}
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      {/*
        Says what is on screen rather than only which page number it is. "51 to
        100 of 384" is answerable; "page 2" is not.
      */}
      <p aria-live="polite" className="text-sm text-text-muted">
        {t('lists.showing', { first, last, total })}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="min-h-11 rounded-md border border-border px-3 disabled:opacity-50"
        >
          {t('lists.previous')}
        </button>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="min-h-11 rounded-md border border-border px-3 disabled:opacity-50"
        >
          {t('lists.next')}
        </button>
      </div>
    </nav>
  );
}

export interface FilterTabsProps<T extends string> {
  label: string;
  options: ReadonlyArray<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
}

export function FilterTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: FilterTabsProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          // `aria-pressed` rather than a class alone: four queue screens use
          // these and none of them announced which filter was active.
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors',
            option.value === value
              ? 'border-brand bg-brand-subtle text-brand'
              : 'border-border bg-surface text-text-muted hover:bg-surface-hover',
          )}
        >
          {option.label}
          {option.count !== undefined && (
            <span className="ms-1 tabular-nums opacity-70">({option.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}
