import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import clsx from 'clsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a busy state and disables the control without changing its width. */
  busy?: boolean;
  /** Accessible name when the button shows only an icon. */
  label?: string;
}

/**
 * `shadow-card` on the two solid variants only.
 *
 * A filled button is the one control on a screen that should look pressable,
 * and every surface in this application used to carry exactly the same
 * elevation — so nothing did. `secondary` stays flat against its card on
 * purpose: two raised things side by side is two primary actions.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-on-brand hover:bg-brand-strong active:bg-brand-strong border border-transparent shadow-card',
  secondary:
    'bg-surface text-text border border-border hover:bg-surface-hover hover:border-border-strong',
  ghost: 'bg-transparent text-text border border-transparent hover:bg-surface-hover',
  danger: 'bg-danger text-on-brand hover:brightness-90 border border-transparent shadow-card',
};

/**
 * `min-h` rather than fixed padding alone.
 *
 * In-row action buttons across this application compute to 28–30px tall, and
 * they are used by warehouse pickers and delivery riders, often standing, often
 * in gloves. `sm` is the smallest size that still clears the 44px target on a
 * touch screen; the smaller visual weight comes from type and padding instead.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-base gap-2',
  lg: 'min-h-12 px-5 text-lg gap-2',
};

function buttonClass(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  return clsx(
    'inline-flex items-center justify-center rounded-control font-medium',
    'transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', busy, label, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={label}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/**
 * A navigation that looks like a button, and stays a link.
 *
 * "Create order", "Back to the catalogue", "Track the delivery" — every one of
 * these goes somewhere, so it must be a real `<a>`: middle-click, open in a new
 * tab, copy the address, and a screen reader announcing "link" rather than
 * "button" all depend on it. The pages this replaces used
 * `className="primary-button"` from `inventory.css` and got the styling from a
 * stylesheet that is being deleted; sharing the class computation with `Button`
 * is what stops the two drifting apart once it is gone.
 */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
