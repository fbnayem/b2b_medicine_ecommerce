import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Button } from './Button';

/**
 * Loading, empty and error, said once.
 *
 * These three states were hand-rolled in 36, 22 and 37 files respectively, with
 * around twenty different phrasings of "Loading…" — so the same wait looked
 * like a different thing on every screen, and "there is nothing here" was
 * frequently indistinguishable from "this broke". They are different facts and
 * they now look different.
 */

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-test="empty-state"
      className={clsx(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed border-border',
        'bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      <p className="text-lg font-semibold text-text">{title}</p>
      {description && <p className="max-w-prose text-text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  /**
   * The correlation identifier the server attached to the failure. The whole
   * backend has emitted one on every error since phase 12 and it reached no
   * user, so a support call could name the time something failed but never the
   * request.
   */
  reference?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  reference,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      data-test="error-state"
      role="alert"
      className={clsx(
        'flex flex-col items-start gap-2 rounded-lg border border-danger',
        'bg-danger-subtle px-4 py-4',
        className,
      )}
    >
      <p className="font-semibold text-text">{title}</p>
      <p className="text-text">{message}</p>
      {reference && (
        <p className="text-sm text-text-muted">
          Quote this reference if you contact support: <code>{reference}</code>
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export interface LoadingStateProps {
  /** What is being waited for, in the user's terms. */
  label?: string;
  className?: string;
}

export function LoadingState({ label = 'Loading', className }: LoadingStateProps) {
  return (
    <div
      // `aria-live="polite"` and `role="status"`: the application had **zero**
      // live regions, so every asynchronous change was silent to a screen
      // reader — the page simply stopped being what it was.
      role="status"
      aria-live="polite"
      className={clsx('flex items-center gap-3 px-4 py-8 text-text-muted', className)}
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand"
      />
      <span>{label}…</span>
    </div>
  );
}

export interface SkeletonProps {
  className?: string;
  /** How many placeholder rows to draw. */
  rows?: number;
}

export function Skeleton({ className, rows = 3 }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={clsx('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-4 animate-pulse rounded bg-surface-hover" />
      ))}
    </div>
  );
}
