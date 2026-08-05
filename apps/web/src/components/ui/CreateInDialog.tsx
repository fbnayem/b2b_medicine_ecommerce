import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './Button';
import { Dialog } from './Dialog';

/**
 * The "Add…" half of a picker, shared by `PickOrCreate` and `SearchPicker`.
 *
 * Two picker shapes, one creation behaviour. A bounded list — riders,
 * warehouses — is a `<select>`; an unbounded one — medicines, suppliers,
 * customers — has to search. Both need the same thing beside them, and the
 * order of operations is where this gets subtly wrong if each writes its own:
 * **invalidate, await, then select.** Selecting first names an option the
 * picker has not fetched yet, which a `<select>` renders as blank and a search
 * box renders as nothing at all.
 */

export interface CreateSpec {
  /** The button beside the picker. */
  label: string;
  title: string;
  description?: ReactNode;
  /** The key family to invalidate, from `lib/queryKeys`. */
  invalidates: readonly unknown[];
  /**
   * The hosted form. It draws its own buttons — a submit has to be inside its
   * own `<form>` to be that form's submit.
   */
  render: (done: (id: string) => void, cancel: () => void) => ReactNode;
}

export function CreateInDialog({
  create,
  onCreated,
}: {
  create: CreateSpec;
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  async function created(newId: string) {
    await queryClient.invalidateQueries({ queryKey: create.invalidates });
    onCreated(newId);
    setOpen(false);
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {create.label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={create.title}
        description={create.description}
        footer={null}
      >
        {/*
          Mounted only while open, so a form with its own queries does not fetch
          behind a closed dialog — and, more usefully, so cancelling and
          reopening starts from blank rather than from a half-typed record
          somebody abandoned.
        */}
        {open &&
          create.render(
            (newId) => void created(newId),
            () => setOpen(false),
          )}
      </Dialog>
    </>
  );
}
