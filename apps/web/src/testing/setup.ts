import { configure } from '@testing-library/react';

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
