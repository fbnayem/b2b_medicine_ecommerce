import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import clsx from 'clsx';

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
      className={clsx('rounded-lg border border-border bg-surface p-4 shadow-sm', className)}
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

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-text-muted border-border',
  brand: 'bg-brand-subtle text-brand border-brand',
  success: 'bg-success-subtle text-success border-success',
  warning: 'bg-warning-subtle text-warning border-warning',
  danger: 'bg-danger-subtle text-danger border-danger',
  info: 'bg-info-subtle text-info border-info',
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
  const pages = Math.max(1, Math.ceil(total / limit));
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      {/*
        Says what is on screen rather than only which page number it is. "51 to
        100 of 384" is answerable; "page 2" is not.
      */}
      <p aria-live="polite" className="text-sm text-text-muted">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="min-h-11 rounded-md border border-border px-3 disabled:opacity-50"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="min-h-11 rounded-md border border-border px-3 disabled:opacity-50"
        >
          Next
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
