import type { FormEvent, ReactNode } from 'react';
import clsx from 'clsx';

/**
 * The row of filters above a list.
 *
 * Every list page wrote this by hand, and they disagreed: `mb-4 … gap-3`,
 * `mb-4 … gap-2`, `mb-6 … gap-2`, one on a bare `<div>` with no submit at all,
 * `role="search"` present on three of them and absent on the fourth. So the
 * same control sat at a different height on each screen, and whether a filter
 * applied on change or on a button was a coin toss for the person using it.
 *
 * Two behaviours, chosen deliberately:
 *
 * **`onApply` decides the interaction.** Give it, and this is a `<form>` with a
 * submit — right when several fields are set together and each intermediate
 * combination would be a wasted request. Leave it out and this is a plain
 * group, for filters that apply as they change.
 *
 * **`role="search"` only when it is one.** The landmark is for finding records,
 * not for narrowing a list that is already on screen; putting it on every
 * toolbar makes the page's landmark map meaningless.
 */
export interface ListToolbarProps {
  children: ReactNode;
  /** Present ⇒ the toolbar is a form and the fields apply together. */
  onApply?: () => void;
  /** Marks this as the search landmark. At most one per page. */
  search?: boolean;
  /** Pushed to the end — a count, a "clear", an export. */
  end?: ReactNode;
  label?: string;
  className?: string;
}

export function ListToolbar({
  children,
  onApply,
  search,
  end,
  label,
  className,
}: ListToolbarProps) {
  const inner = (
    <>
      {children}
      {end && <div className="ms-auto flex flex-wrap items-center gap-2">{end}</div>}
    </>
  );

  const shared = clsx('mb-4 flex flex-wrap items-end gap-3', className);

  if (!onApply) {
    return (
      <div role="group" aria-label={label} className={shared}>
        {inner}
      </div>
    );
  }

  return (
    <form
      {...(search ? { role: 'search' } : {})}
      aria-label={label}
      className={shared}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onApply();
      }}
    >
      {inner}
    </form>
  );
}
