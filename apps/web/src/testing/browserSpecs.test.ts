import { describe, expect, it } from 'vitest';

/**
 * Every browser spec belongs to a project that will actually run it.
 *
 * Playwright does not warn about a spec no project matches. It reports
 * `0 tests` for a file nobody selected, prints a green run, and the suite is
 * one file smaller than everybody believes — the same defect class as a gate
 * whose extraction pattern quietly stopped matching, and this repository has
 * now had one of those: the API path reconciliation fell from 121 request sites
 * to 63 and its floor of 60 let it pass.
 *
 * The check is textual because the configuration cannot be imported here — it
 * pulls in `@playwright/test`, which expects to be running inside a Playwright
 * worker. Reading the `testMatch` patterns out of the file is enough; they are
 * literal regular expressions, and a project that stops naming a spec is
 * exactly what this is looking for.
 */

const SPECS = import.meta.glob('../../../../e2e/*.spec.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const CONFIG = import.meta.glob('../../../../playwright.config.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function projectPatterns(): RegExp[] {
  const source = Object.values(CONFIG)[0] ?? '';
  const found = [...source.matchAll(/testMatch:\s*\/(.+?)\/\s*,/g)].map(
    (match) => new RegExp(match[1]!),
  );
  /*
   * Without this the loop below has nothing to compare against, and every spec
   * would read as unmatched — or, had the assertion been written the other way
   * round, as matched. A gate that cannot see its own input is worse than none.
   */
  expect(found.length, 'No testMatch patterns were read from playwright.config.ts').toBeGreaterThan(
    0,
  );
  return found;
}

describe('the browser suite', () => {
  const specs = Object.keys(SPECS).map(fileName);

  it('has specs to read at all', () => {
    expect(specs.length).toBeGreaterThan(4);
  });

  it('runs every spec file it contains', () => {
    const patterns = projectPatterns();
    const orphaned = specs.filter((spec) => !patterns.some((pattern) => pattern.test(spec))).sort();
    expect(
      orphaned,
      'These browser specs are in e2e/ and no Playwright project selects them, so they ' +
        'never run and the suite reports green without them:\n' +
        orphaned.map((name) => `  ${name}`).join('\n'),
    ).toEqual([]);
  });

  it('would report an orphan, so a clean run means something', () => {
    const patterns = projectPatterns();
    expect(patterns.some((pattern) => pattern.test('nobody-runs-this.spec.ts'))).toBe(false);
  });
});
