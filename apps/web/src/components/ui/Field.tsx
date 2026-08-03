import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import clsx from 'clsx';

/**
 * One place that wires a label, a hint and an error to a control.
 *
 * The application had around fifteen form controls with no label at all,
 * including the two on the sign-in screen — the very first fields anybody
 * meets. That is not carelessness so much as arithmetic: associating a label
 * correctly takes an id, an `htmlFor`, an `aria-describedby` and an
 * `aria-invalid`, four things to remember at every one of a few hundred call
 * sites. Here it is one thing, done once.
 */

interface FieldContextValue {
  controlId: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function useField(): FieldContextValue {
  const context = useContext(FieldContext);
  if (!context) {
    throw new Error('Input, Select and Textarea must be rendered inside a <Field>.');
  }
  return context;
}

export interface FieldProps {
  label: ReactNode;
  /** Guidance shown before anything goes wrong. */
  hint?: ReactNode;
  /** Shown instead of the hint, and announced. */
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const base = useId();
  const controlId = `${base}-control`;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ controlId, describedBy, invalid: Boolean(error) }}>
      <div className={clsx('flex flex-col gap-1', className)}>
        <label htmlFor={controlId} className="text-sm font-medium text-text">
          {label}
          {required && (
            <span className="text-danger ms-1" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {children}
        {error ? (
          // `role="alert"` so a refusal reaches somebody who cannot see it.
          <p id={errorId} role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : (
          hint && (
            <p id={hintId} className="text-sm text-text-muted">
              {hint}
            </p>
          )
        )}
      </div>
    </FieldContext.Provider>
  );
}

const CONTROL_CLASS =
  'w-full min-h-11 rounded-md border bg-surface px-3 text-base text-text ' +
  'placeholder:text-text-muted disabled:opacity-50 disabled:cursor-not-allowed';

function borderFor(invalid: boolean) {
  return invalid ? 'border-danger' : 'border-border';
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    const { controlId, describedBy, invalid } = useField();
    return (
      <input
        ref={ref}
        id={controlId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={clsx(CONTROL_CLASS, borderFor(invalid), className)}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  const { controlId, describedBy, invalid } = useField();
  return (
    <textarea
      ref={ref}
      id={controlId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={clsx(CONTROL_CLASS, borderFor(invalid), 'py-2 min-h-24', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    const { controlId, describedBy, invalid } = useField();
    return (
      <select
        ref={ref}
        id={controlId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={clsx(CONTROL_CLASS, borderFor(invalid), className)}
        {...rest}
      >
        {children}
      </select>
    );
  },
);
