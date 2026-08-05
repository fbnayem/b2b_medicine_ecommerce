import { useCallback, useRef, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Info } from 'lucide-react';

/**
 * What a field is for, and what it changes.
 *
 * Across ~145 form fields this application carried 22 hints and 10
 * placeholders, seven of the latter being list search boxes. The medicine form
 * — nineteen controls including three prices and two order limits — had none of
 * either. Somebody typing into "Sold as" had nothing anywhere telling them that
 * putting *Tablet* there means a shop ordering five gets five tablets.
 *
 * **A Popover, not a Tooltip, and the difference is the whole design.** Radix
 * Tooltip opens on hover and focus and *does not open on tap*. `AppShell` gets
 * away with one because the collapsed sidebar rail is a desktop affordance;
 * here the readers include storekeepers and delivery riders on phones, for whom
 * a tooltip is an icon that does nothing. A Popover is click-latched, works on
 * touch, and Radix already ships the dismissal and focus behaviour.
 *
 * Hover is layered on top, because the request was "when I hover it will show"
 * and that is the right behaviour with a mouse. So: hovering opens it, moving
 * the pointer away closes it after a beat long enough to travel onto the
 * content, and a click latches it open until dismissed. That combination is
 * also, not coincidentally, what WCAG 2.1 SC 1.4.13 asks of content shown on
 * hover — dismissable without moving the pointer (Escape), hoverable (the
 * delay), and persistent (nothing times out).
 *
 * **This is not a substitute for a hint.** A rule somebody needs *before* they
 * type belongs in `Field`'s `hint`, visible without being asked for. What
 * belongs here is the second layer: how the field works and what it affects
 * downstream. Nobody should have to open a popover to learn a required format.
 */

export interface HelpTipProps {
  /**
   * What this explains, for the trigger's accessible name — "About Sold as".
   * Resolved text, not a catalogue key: calling `t()` in here would hide every
   * key from `catalogueKeys.test.ts`, which only sees literal call sites.
   */
  label: string;
  /** The explanation itself. */
  body: ReactNode;
}

/** Long enough for a pointer to travel from the icon onto the panel. */
const CLOSE_DELAY_MS = 140;

export function HelpTip({ label, body }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const closing = useRef<number | undefined>(undefined);
  /*
   * A tap fires a synthetic `mouseenter` and then a `click`, which would open
   * on the first and close on the second — the icon would appear inert on
   * exactly the devices the Popover was chosen for. Recording the pointer type
   * lets the hover handlers stand aside for that interaction.
   */
  const touch = useRef(false);

  const cancelClose = useCallback(() => {
    if (closing.current !== undefined) {
      window.clearTimeout(closing.current);
      closing.current = undefined;
    }
  }, []);

  const openNow = useCallback(() => {
    if (touch.current) return;
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  const closeSoon = useCallback(() => {
    if (touch.current) return;
    cancelClose();
    closing.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          onPointerDown={(event) => {
            touch.current = event.pointerType === 'touch';
          }}
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
          onFocus={openNow}
          onBlur={closeSoon}
          /*
           * A 44px target, per the shared `minTapTarget`, pulled back with
           * negative margin so it does not push the label's line apart.
           */
          className="-my-2.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-text-muted hover:text-text"
        >
          <Info aria-hidden="true" size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          role="note"
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onMouseEnter={cancelClose}
          onMouseLeave={closeSoon}
          className="z-[200] max-w-72 rounded-md border border-border bg-surface p-3 text-sm text-text shadow-md"
        >
          {body}
          <Popover.Arrow className="fill-surface" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
