import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/**
 * Money and dates on the server go through `@medsupply/utilities`.
 *
 * The package was built in Phase 1 and adopted by both clients, and the server
 * was simply forgotten — so the documents the business actually issues were the
 * last place in the system dividing money in floating point and rendering a UTC
 * calendar date. An invoice read `1250000.00 BDT` with no thousands separator,
 * and its date was the UTC day, which in Dhaka is the previous one for
 * everything before 6 am.
 *
 * Two rules, both enforced by reading the sources rather than by review:
 *
 *   - **No `(minor / 100).toFixed(...)`.** `formatMoneyMinor` does the same job
 *     with integer arithmetic and thousands separators, and honours a tenant
 *     configured for a different currency symbol.
 *   - **No `toISOString().slice(0, 10)`.** That is the UTC calendar date.
 *     `toDateInputValue` asks `Intl` for the date in the configured zone.
 *
 * The rules are enforced on `src/`, not on scripts or tests: a fixture that
 * builds a UTC date on purpose is not a defect, and a migration reading a raw
 * ISO day is doing something different from rendering one to a person.
 */

/** Divides minor units in floating point — `formatMoneyMinor` replaces it. */
const FLOAT_MONEY = /\/\s*100\s*\)\s*\.toFixed\s*\(/;

/** Yields the UTC calendar day — `toDateInputValue` replaces it. */
const UTC_DAY = /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;

const MONEY_ALLOWED = new Set<string>([
  /*
   * Basis points to a percentage, not money: `sharePercentBasisPoints` and
   * `successBasisPoints` are ratios, and dividing them by 100 is exact for
   * every value they can hold. The rule is about financial arithmetic, and a
   * share of deliveries is not an amount of anybody's money.
   */
  'controllers/reportController.ts',
]);

const DATE_ALLOWED = new Set<string>([
  /*
   * The one implementation of "the calendar date in Dhaka". Everything else
   * delegates here, so this is where the rule is satisfied rather than broken.
   */
  'services/ledgerService.ts',
]);

function apiRoot(): string {
  let directory = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === '@medsupply/api') return directory;
    } catch {
      // Keep walking; not every ancestor holds a manifest.
    }
    directory = dirname(directory);
  }
  throw new Error('Could not locate the @medsupply/api package root');
}

function sourcesUnder(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) sourcesUnder(full, found);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

/** Comment bodies describe the old defect on purpose; only code is checked. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function offenders(pattern: RegExp, allowed: Set<string>) {
  const root = join(apiRoot(), 'src');
  return sourcesUnder(root)
    .map((file) => ({ file, name: relative(root, file).split(sep).join('/') }))
    .filter(({ name }) => !allowed.has(name))
    .filter(({ file }) => pattern.test(withoutComments(readFileSync(file, 'utf8'))));
}

test('money is never divided in floating point outside the shared formatter', () => {
  const found = offenders(FLOAT_MONEY, MONEY_ALLOWED);
  assert.deepEqual(
    found.map(({ name }) => name),
    [],
    'Use formatMoneyMinor from @medsupply/utilities instead of (minor / 100).toFixed(2)',
  );
});

test('no source renders the UTC calendar day where the Dhaka one is meant', () => {
  const found = offenders(UTC_DAY, DATE_ALLOWED);
  assert.deepEqual(
    found.map(({ name }) => name),
    [],
    'Use toDateInputValue or dhakaDateString instead of toISOString().slice(0, 10)',
  );
});

test('the guards match the patterns they claim to, so a clean run means something', () => {
  // A rule that cannot fire is indistinguishable from a rule that passes.
  assert.ok(FLOAT_MONEY.test('const x = (minor / 100).toFixed(2);'));
  assert.ok(FLOAT_MONEY.test('`${(row.amountMinor/100).toFixed( 2 )}`'));
  assert.ok(!FLOAT_MONEY.test('formatMoneyMinor(row.amountMinor)'));
  assert.ok(UTC_DAY.test('value.toISOString().slice(0, 10)'));
  assert.ok(UTC_DAY.test('d.toISOString().slice(0,10)'));
  assert.ok(!UTC_DAY.test('toDateInputValue(value)'));
});
