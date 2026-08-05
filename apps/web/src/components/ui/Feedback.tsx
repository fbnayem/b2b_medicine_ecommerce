import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { useLanguage } from '../../lib/useLanguage';
import { Button } from './Button';

/**
 * Loading, empty, error and "not ready yet", said once.
 *
 * The first three were hand-rolled in 36, 22 and 37 files respectively, with
 * around twenty different phrasings of "Loading…" — so the same wait looked
 * like a different thing on every screen, and "there is nothing here" was
 * frequently indistinguishable from "this broke". They are different facts and
 * they now look different.
 *
 * **These render in the reader's language.** Every default here was an English
 * string literal — "Something went wrong", "Try again", "Quote this reference
 * if you contact support" — while `packages/i18n` has held Bangla for all three
 * since the localisation phase and `apps/mobile/src/components/Feedback.tsx`
 * has always read them. So the language toggle worked everywhere except on the
 * one surface a confused user actually stops to read: the failure. Nothing was
 * missing but the lookup.
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

export function ErrorState({ title, message, reference, onRetry, className }: ErrorStateProps) {
  const { t } = useLanguage();
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
      <p className="font-semibold text-text">{title ?? t('common.somethingWentWrong')}</p>
      <p className="text-text">{message}</p>
      {reference && (
        <p className="text-sm text-text-muted">
          {t('common.quoteReference')}: <code>{reference}</code>
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

/**
 * The `id` of the control a problem is about, so the notice can take you there.
 */
export interface FormProblem {
  message: string;
  focus?: string;
}

export interface FormNoticeProps {
  /** Defaults to "This is not ready to be saved yet". */
  title?: string;
  /** A bare string is shorthand for a problem with nothing to focus. */
  problems: ReadonlyArray<FormProblem | string>;
  /**
   * Changes to move focus here. Bump it once per submit attempt.
   *
   * Focus deliberately does **not** follow the problem list, because the list
   * is meant to shrink live as the form is filled in — and yanking the cursor
   * out of the field somebody is currently fixing, every time they fix
   * something, would make the notice an obstacle rather than a help.
   */
  focusKey?: number | string;
  className?: string;
}

/**
 * A form that is not finished being filled in.
 *
 * This is **not** `ErrorState`, and the distinction is the whole point. Four
 * hand-rolled forms answered their own validation with the red "Something went
 * wrong" card — so leaving a field blank was reported in the same words, the
 * same colour and the same tone as the database being unreachable. The
 * screenshot that prompted this shows it exactly: a rider chosen, a day chosen,
 * notes typed, and a red alert saying something went wrong. Nothing had gone
 * wrong. The round simply had no stops on it yet.
 *
 * Three things follow from calling it what it is. It is warning-toned rather
 * than danger-toned, because the reader has not broken anything. It lists the
 * problems separately rather than concatenating them into one sentence, because
 * "choose a rider, a day, and at least one stop" does not tell somebody who has
 * already chosen two of the three which one is missing. And each problem can
 * carry you to the control it is about, which on a form tall enough to scroll —
 * this one is two panels deep — is the difference between being told and being
 * helped.
 *
 * `role="alert"` **and** focus, following the GOV.UK error summary: focus alone
 * conveys the heading but not reliably the list, and the alert alone is missed
 * by anybody who has scrolled past.
 */
export function FormNotice({ title, problems, focusKey, className }: FormNoticeProps) {
  const { t } = useLanguage();
  const container = useRef<HTMLDivElement>(null);
  const entries = problems.map((problem) =>
    typeof problem === 'string' ? { message: problem } : problem,
  );

  useEffect(() => {
    container.current?.focus();
  }, [focusKey]);

  if (entries.length === 0) return null;

  return (
    <div
      ref={container}
      data-test="form-notice"
      role="alert"
      tabIndex={-1}
      className={clsx(
        'flex flex-col gap-2 rounded-lg border border-warning bg-warning-subtle px-4 py-4',
        className,
      )}
    >
      <p className="font-semibold text-text">{title ?? t('forms.notReady')}</p>
      <ul className="flex list-none flex-col gap-1 p-0 text-text">
        {entries.map((entry) => (
          <li key={entry.message} className="flex flex-wrap items-baseline gap-x-2">
            <span>{entry.message}</span>
            {entry.focus && (
              <button
                type="button"
                onClick={() => {
                  const target = document.getElementById(entry.focus!);
                  target?.focus();
                  // No `behavior: 'smooth'`, which ignores the reader's
                  // reduced-motion preference on most browsers.
                  target?.scrollIntoView({ block: 'center' });
                }}
                className="min-h-11 font-medium text-brand underline"
              >
                {t('forms.takeMeThere')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface LoadingStateProps {
  /** What is being waited for, in the user's terms. */
  label?: string;
  className?: string;
}

export function LoadingState({ label, className }: LoadingStateProps) {
  const { t } = useLanguage();
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
      <span>{label ?? t('common.loading')}…</span>
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
