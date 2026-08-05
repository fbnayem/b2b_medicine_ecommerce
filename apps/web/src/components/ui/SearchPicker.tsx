import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Field, Input } from './Field';

/**
 * A picker that searches rather than one that ends.
 *
 * Four pickers in this application could not see every record and said nothing
 * about it: suppliers stopped at 50, price lists at 25, medicines and shops at
 * 100, each a plain `<select>` over one unpaged page. A catalogue with more
 * than a hundred lines simply could not be fully selected from any form that
 * picks one — the list just stopped, and the reader had no reason to doubt it.
 * That is the same defect class as a truncated table with no pager: the screen
 * is not wrong about what it shows, it is silent about what it does not.
 *
 * The interaction is lifted from `OrderEntry`, which is the only searching
 * combobox in forty-three pages: a real `role="combobox"`, a real listbox,
 * arrow keys and Enter. It was worth having in one place rather than one.
 *
 * The search runs against the server, so the answer is not filtered from a
 * page that was already cut short. What this component owns is the term and the
 * keyboard; the caller owns the query, because how a medicine is searched for
 * is not the same question as how a supplier is.
 */

export interface SearchPickerOption {
  value: string;
  label: string;
  /** A second line — a stock code, a reference, whatever tells two apart. */
  note?: string;
}

export interface SearchPickerProps {
  label: ReactNode;
  id?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  help?: ReactNode;
  placeholder?: string;
  /** What the caller is searching for, and the setter it filters on. */
  term: string;
  onTermChange: (term: string) => void;
  options: readonly SearchPickerOption[];
  /** Shown in place of the list when a term found nothing. */
  emptyLabel: string;
  onChoose: (value: string) => void;
  /** The current choice, rendered under the box so it survives the term changing. */
  chosen?: ReactNode;
}

export function SearchPicker({
  label,
  id,
  required,
  hint,
  error,
  help,
  placeholder,
  term,
  onTermChange,
  options,
  emptyLabel,
  onChoose,
  chosen,
}: SearchPickerProps) {
  const listId = `${useId()}-results`;
  const [highlighted, setHighlighted] = useState(0);
  const open = term.trim().length > 0;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      // Otherwise Enter on a suggestion submits the form it sits in, which is
      // the opposite of what somebody choosing from a list means by it.
      event.preventDefault();
      const option = options[highlighted];
      if (option) choose(option.value);
    } else if (event.key === 'Escape') {
      onTermChange('');
    }
  }

  function choose(value: string) {
    onChoose(value);
    onTermChange('');
    setHighlighted(0);
  }

  return (
    <Field label={label} id={id} required={required} hint={hint} error={error} help={help}>
      <Input
        value={term}
        onChange={(event) => {
          onTermChange(event.target.value);
          setHighlighted(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {chosen && <p className="text-sm text-text-muted">{chosen}</p>}
      {open && (
        <ul id={listId} role="listbox" className="flex flex-col rounded-md border border-border">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-muted">{emptyLabel}</li>
          ) : (
            options.map((option, index) => (
              <li key={option.value} role="option" aria-selected={index === highlighted}>
                <button
                  type="button"
                  onClick={() => choose(option.value)}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 px-3 text-start ${
                    index === highlighted ? 'bg-surface-raised' : ''
                  }`}
                >
                  <span className="text-text">{option.label}</span>
                  {option.note && (
                    <span className="text-sm tabular-nums text-text-muted">{option.note}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </Field>
  );
}
