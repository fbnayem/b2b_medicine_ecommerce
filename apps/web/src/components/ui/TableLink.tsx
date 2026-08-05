import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

/**
 * The cell that opens the record.
 *
 * `<Link className="font-medium text-brand underline">` was written out in
 * about thirty list cells, and the copies had begun to drift — some without the
 * weight, some without the underline. It is the one control every list has, so
 * it is worth having once.
 *
 * Underlined rather than coloured alone: a link identified only by hue is not a
 * link to a reader who cannot see the hue, and these sit next to plain text in
 * the same size.
 */
export function TableLink({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        'font-medium text-brand underline underline-offset-2 hover:text-brand-strong',
        className,
      )}
    >
      {children}
    </Link>
  );
}
