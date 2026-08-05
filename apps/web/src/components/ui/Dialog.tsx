import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Button, type ButtonVariant } from './Button';

/**
 * Dialogs, on Radix rather than hand-built.
 *
 * The argument for building these by hand is that they look simple. The
 * evidence against it is in this repository: `NotificationBell.tsx` holds the
 * only `role="dialog"` in the application, and it has no focus trap, no
 * `aria-modal` and no Escape handler — so a keyboard user tabs straight out of
 * it into the page behind, which is still scrollable and still clickable.
 * Getting that right means inert backgrounds, focus restoration, scroll lock
 * and a labelled title, and none of it is visible when it is wrong.
 *
 * `AlertDialog` is separate from `Dialog` because the two mean different things
 * to assistive technology: an alert dialog interrupts, takes focus on its
 * safest action, and must be answered. That is the correct shape for the 22
 * `window.confirm` calls this replaces — including administrative password
 * reset and payment reversal.
 */

const OVERLAY = 'fixed inset-0 z-[100] bg-black/40 backdrop-blur-[1px]';
const PANEL =
  'fixed left-1/2 top-1/2 z-[200] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 ' +
  '-translate-y-1/2 rounded-lg border border-border bg-surface p-6 shadow-lg ' +
  'max-h-[calc(100vh-4rem)] overflow-y-auto';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /**
   * The action row. Omit for a Close button; pass `null` for none at all.
   *
   * `null` is for a dialog hosting a form that owns its own actions — the
   * submit has to be inside the `<form>` to be the form's submit, and a second
   * row of buttons under it is furniture.
   */
  footer?: ReactNode | null;
}

export function Dialog({ open, onOpenChange, title, description, children, footer }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY} />
        <DialogPrimitive.Content data-test="dialog" className={PANEL}>
          <DialogPrimitive.Title className="text-xl font-semibold text-text">
            {title}
          </DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="mt-1 text-text-muted">
              {description}
            </DialogPrimitive.Description>
          )}
          <div className="mt-4">{children}</div>
          {footer !== null && (
            <div className="mt-6 flex justify-end gap-2">
              {footer ?? (
                <DialogPrimitive.Close asChild>
                  <Button variant="secondary">Close</Button>
                </DialogPrimitive.Close>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen, in the reader's terms, before they agree to it. */
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for anything that destroys, reverses or cannot be undone. */
  tone?: ButtonVariant;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={OVERLAY} />
        <AlertDialogPrimitive.Content data-test="dialog" className={PANEL}>
          <AlertDialogPrimitive.Title className="text-xl font-semibold text-text">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-1 text-text-muted">
            {description}
          </AlertDialogPrimitive.Description>
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-6 flex justify-end gap-2">
            {/*
              Cancel first in the DOM so it receives initial focus. Return on a
              confirmation dialog should never be the destructive answer.
            */}
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary" data-test="dialog-cancel">
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                variant={tone}
                busy={busy}
                data-test="dialog-confirm"
                onClick={(event) => {
                  // Held open while the request runs, so the user is not
                  // returned to the list unsure whether anything happened.
                  event.preventDefault();
                  void onConfirm();
                }}
              >
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
