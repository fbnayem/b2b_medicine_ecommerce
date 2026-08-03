import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

/**
 * Transient confirmation, said once and announced.
 *
 * Success was previously an inline green box, hand-written in twelve files, of
 * which six announced nothing at all — so half the time a shop owner using a
 * screen reader submitted an order and heard silence. A correct toast needs
 * `aria-live` routing that distinguishes a polite confirmation from an
 * assertive failure, plus a hover-to-pause and a keyboard-reachable dismiss,
 * and the application had zero live regions to build that on.
 *
 * The wrapper exists so call sites never import `sonner` directly: replacing it
 * later, or routing these through the phase 5 translation catalogue, is then a
 * change to this file rather than to twelve.
 */

export const toast = {
  /** Something the user did worked. */
  success(message: string, description?: string) {
    sonnerToast.success(message, { description });
  },
  /** Something failed. `reference` is the correlation id support will ask for. */
  error(message: string, options?: { description?: string; reference?: string }) {
    sonnerToast.error(message, {
      description: options?.reference
        ? `${options.description ? `${options.description} ` : ''}Reference: ${options.reference}`
        : options?.description,
      // Long enough to write the reference down.
      duration: 10_000,
    });
  },
  info(message: string, description?: string) {
    sonnerToast(message, { description });
  },
  dismiss() {
    sonnerToast.dismiss();
  },
};

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      // The tokens rather than sonner's own palette, so a toast is the same
      // green as everything else and follows the theme.
      toastOptions={{
        classNames: {
          toast: 'bg-surface text-text border border-border shadow-lg',
          description: 'text-text-muted',
          actionButton: 'bg-brand text-on-brand',
          error: 'border-danger',
          success: 'border-success',
        },
      }}
      // Long enough to read a sentence in a second language.
      duration={6000}
      closeButton
    />
  );
}
