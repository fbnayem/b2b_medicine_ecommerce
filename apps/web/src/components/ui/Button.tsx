import { forwardRef, type ButtonHTMLAttributes } from 'react';
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

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong border border-transparent',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-hover',
  ghost: 'bg-transparent text-text border border-transparent hover:bg-surface-hover',
  danger: 'bg-danger text-on-brand hover:brightness-90 border border-transparent',
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
      className={clsx(
        'inline-flex items-center justify-center rounded-md font-medium',
        'transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
