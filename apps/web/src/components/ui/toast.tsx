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
    /*
     * The landmark `docs/TESTING.md` froze, finally emitted by something.
     *
     * `TEST_IDS.toast` has been in the browser-test contract since phase 3 and
     * nothing has ever rendered it: sonner draws its own `[data-sonner-toast]`
     * elements and takes no attribute we could put it on, so the first spec to
     * reach for the landmark found nothing and timed out on an action that had
     * in fact succeeded. A wrapper is the whole fix — the toaster itself is
     * fixed-position, so a static element around it changes no layout, and a
     * container that is present but empty fails with "the text is not there"
     * rather than "the element is not there", which is the more useful of the
     * two messages by some distance.
     */
    <div data-test="toast">
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
    </div>
  );
}
