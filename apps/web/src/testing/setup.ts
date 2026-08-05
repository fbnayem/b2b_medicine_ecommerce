import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * One test-id attribute across both harnesses.
 *
 * `docs/TESTING.md` freezes `data-test`, and Playwright is configured with it.
 * Testing Library defaults to `data-testid`, so without this the component
 * tests and the browser tests would look for different attributes — and the
 * component tests would silently find nothing, which reads as "the element is
 * not there" rather than "you are looking for the wrong attribute".
 */
configure({ testIdAttribute: 'data-test' });

/**
 * Unmount between tests.
 *
 * Testing Library registers this itself — but only when it can see a global
 * `afterEach`, and this project runs vitest without `globals`, so it never
 * did. Every `render()` in a file therefore stacked another copy of the
 * component into the same document, and the failure that produces is
 * "multiple elements found" on an assertion that looks obviously correct.
 *
 * The existing suites survived by rendering once per file. That is not a
 * property anybody maintains deliberately, and the first file to render twice
 * pays for it, so it is fixed here rather than with an `afterEach` in each new
 * test file.
 */
afterEach(cleanup);

/**
 * Layout APIs jsdom does not implement.
 *
 * jsdom computes no layout, so it ships no `ResizeObserver` and every element
 * measures zero. Radix's floating primitives — the popover behind `HelpTip`,
 * and anything else built on `@floating-ui` — observe their trigger's size to
 * decide where to put the panel, and throw outright without it.
 *
 * A stub that observes nothing is the honest shape here: these tests assert
 * *what* is shown and *when*, never where it lands on screen, and pretending to
 * measure would invite an assertion that only passes because the number is
 * made up. Position is a thing for a real browser, which is what
 * `e2e/accessibility.spec.ts` is.
 */
class NoLayoutResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoLayoutResizeObserver;
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView ??= () => {};
  // Radix guards its own pointer-capture calls; jsdom defines neither.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}
