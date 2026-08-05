import { type ReactNode } from 'react';
import { CreateInDialog, type CreateSpec } from './CreateInDialog';
import { Field, Select } from './Field';

/**
 * Choose one, or make the one that is missing without leaving the form.
 *
 * **Nothing in this application creates a record from inside another form.**
 * Not one picker, not one dialog, no `+` beside any select. Every "create X" is
 * a whole-page navigation — and **no form here persists a draft or warns before
 * discarding one.** So "go and create the thing you need, then come back" costs
 * the ordered stop list on a half-planned round, every line on a purchase order
 * or price list, the file attached to a payment, and the held idempotency key
 * on an order in progress. That is the argument for this component: not
 * convenience, unrecoverable loss.
 *
 * The button is **absent** rather than disabled for somebody who may not
 * create. An affordance that answers 403 is worse than no affordance — it tells
 * a person the product can do something for them that it will not.
 *
 * On success the entity family is invalidated *and awaited* before the new
 * record is selected, so the option exists by the time the value names it.
 * That is the whole reason `lib/queryKeys` is a hierarchy: one prefix reaches
 * the picker's own feed, the list it came from, and every other screen showing
 * the same records.
 *
 * **One level of dialog only.** `Dialog` hard-codes `z-[100]`/`z-[200]` with no
 * depth counter, so a dialog opened from inside a dialog stacks by DOM order
 * and paints two overlays. A `PickOrCreate` on a page is fine; one inside an
 * `ask.confirm` is not.
 */

export interface PickOrCreateOption {
  value: string;
  label: string;
}

export interface PickOrCreateProps {
  label: ReactNode;
  /** A stable id, so a validation notice can carry the reader to the control. */
  id?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  help?: ReactNode;
  /** The empty choice — "Choose a delivery person". */
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly PickOrCreateOption[];
  className?: string;
  /** Omit entirely when the viewer may not create one. */
  create?: CreateSpec;
}

export function PickOrCreate({
  label,
  id,
  required,
  hint,
  error,
  help,
  placeholder,
  value,
  onChange,
  options,
  className,
  create,
}: PickOrCreateProps) {
  return (
    <Field label={label} id={id} required={required} hint={hint} error={error} help={help}>
      <div className={className ?? 'flex flex-wrap items-start gap-2'}>
        <Select
          className="min-w-0 flex-1"
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        {create && <CreateInDialog create={create} onCreated={onChange} />}
      </div>
    </Field>
  );
}
