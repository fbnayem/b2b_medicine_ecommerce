import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { NAV_BY_ID } from '@medsupply/navigation';
import { routeIdForPath } from '../app/routes';
import { useBranding } from '../lib/useBranding';

/**
 * Announces the new page, and puts focus somewhere sensible.
 *
 * A single-page application changes the whole screen without a page load, which
 * a browser announces and a router does not. Without this, moving from the
 * approval queue to a review is completely silent to a screen-reader user, and
 * leaves keyboard focus on the link that has just been removed from the
 * document — so the next Tab starts from the top of the page every time.
 *
 * It also sets `document.title`. Every one of the 51 routes shared the title
 * `web`, so every browser history entry, every bookmark and every window in the
 * task bar was identical.
 */
export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const branding = useBranding();
  const announcement = useRef<HTMLParagraphElement>(null);
  const first = useRef(true);

  const routeId = routeIdForPath(pathname);
  const label = routeId ? NAV_BY_ID[routeId]?.label : undefined;

  useEffect(() => {
    const title = label ? `${label} · ${branding.name}` : branding.name;
    document.title = title;

    // Not on the very first render: the browser has just announced the page
    // load itself, and saying it again is noise.
    if (first.current) {
      first.current = false;
      return;
    }

    if (announcement.current) announcement.current.textContent = title;

    // Focus the main region rather than an element inside it, so the next Tab
    // starts from the content the user asked for instead of the top of the
    // navigation. `tabIndex={-1}` makes it focusable without adding it to the
    // tab order.
    const main = document.getElementById('main');
    main?.focus({ preventScroll: false });
  }, [pathname, label, branding.name]);

  return (
    <p
      ref={announcement}
      // `aria-live="polite"` waits for the user to stop typing before speaking,
      // which is right for a navigation: it is information, not an emergency.
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    />
  );
}
