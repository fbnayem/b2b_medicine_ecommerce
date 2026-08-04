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
