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

/**
 * The shared formatters carry process-wide state, so exactly one module may
 * set it. Two call sites would mean the last write wins and neither author
 * knows which one that is — and the defect this replaces was the opposite
 * failure, nobody calling it at all, which left every server-rendered document
 * in taka and Dhaka time regardless of what the tenant had configured.
 */
const CONFIGURES_FORMATTING = /\bconfigureFormatting\b/;

/**
 * Reading the package defaults is how a module quietly opts out of the
 * tenant's settings, which is the same bug one level down.
 */
const READS_PACKAGE_DEFAULTS = /\bDEFAULT_FORMAT_SETTINGS\b/;

const FORMATTING_OWNER = new Set<string>(['services/localisation.ts']);

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
   * The one implementation of "today, on the business calendar". Everything
   * else delegates here, so this is where the rule is satisfied rather than
   * broken.
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

/** One offender per line, so the failure names the files rather than counting them. */
function describe(names: readonly string[]): string {
  return names.length === 0 ? '' : `\n${names.map((name) => `  ${name}`).join('\n')}`;
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
    'Use toDateInputValue or businessDateString instead of toISOString().slice(0, 10)',
  );
});

test('one module owns the shared formatter configuration', () => {
  assert.deepEqual(
    offenders(CONFIGURES_FORMATTING, FORMATTING_OWNER).map(({ name }) => name),
    [],
    'configureFormatting belongs in services/localisation.ts, which every settings load goes through',
  );
});

test('nothing falls back to the package defaults instead of the tenant settings', () => {
  assert.deepEqual(
    offenders(READS_PACKAGE_DEFAULTS, FORMATTING_OWNER).map(({ name }) => name),
    [],
    'Read the configured settings; DEFAULT_FORMAT_SETTINGS is taka, Dhaka and en-GB',
  );
});

/**
 * A hundred multiplied into or divided out of a money figure.
 *
 * `100` is the minor-unit exponent for BDT and for most currencies, and for
 * exactly that reason it is the number somebody types when they mean "convert
 * between major and minor". JPY has no minor unit and KWD has three, so the
 * same line is a hundredfold error in one direction and a tenfold error in the
 * other — and it is invisible on a Bangladeshi deployment, which is what makes
 * it worth a gate rather than a review comment.
 *
 * Deliberately narrow: only a literal `100` next to something that reads as
 * money. Percentages, basis points and page sizes use the same number for
 * unrelated reasons and are not this defect.
 */
/*
 * Built with `RegExp` rather than written as a regex literal.
 *
 * A character class holding both a star and a slash is legal by the grammar and
 * was nonetheless read differently by this toolchain: the compiled rule matched
 * nothing at all. A gate that silently stops matching is worse than no gate,
 * and the self-test below is what caught it.
 *
 * The comment cannot show the class either — writing a star next to a slash
 * inside a block comment ends the comment, which is the second way this same
 * pair of characters bit.
 */
const HUNDRED_MONEY = new RegExp(
  '\\b\\w*[Mm]inor\\w*\\s*[*\\/]\\s*100\\b' + '|' + '\\b100\\s*\\*\\s*\\w*[Mm]inor\\w*\\b',
);

const HUNDRED_ALLOWED = new Set<string>([]);

test('no money figure is converted by a hard-coded hundred', () => {
  const found = offenders(HUNDRED_MONEY, HUNDRED_ALLOWED);
  assert.deepEqual(
    found.map(({ name }) => name),
    [],
    'The exponent belongs to the currency, not to the call site. JPY has none ' +
      'and KWD has three, so a literal 100 is a hundredfold error in one ' +
      'direction and a tenfold error in the other:' +
      describe(found.map(({ name }) => name)),
  );
});

test('the guards match the patterns they claim to, so a clean run means something', () => {
  // A rule that cannot fire is indistinguishable from a rule that passes.
  assert.ok(FLOAT_MONEY.test('const x = (minor / 100).toFixed(2);'));
  assert.ok(FLOAT_MONEY.test('`${(row.amountMinor/100).toFixed( 2 )}`'));
  assert.ok(!FLOAT_MONEY.test('formatMoneyMinor(row.amountMinor)'));
  assert.ok(UTC_DAY.test('value.toISOString().slice(0, 10)'));
  assert.ok(HUNDRED_MONEY.test('const major = amountMinor / 100;'));
  assert.ok(HUNDRED_MONEY.test('creditLimitMinor * 100'));
  assert.ok(HUNDRED_MONEY.test('const m = 100 * priceMinor;'));
  // Not this defect: a percentage, a page size, or basis points.
  assert.ok(!HUNDRED_MONEY.test('const percent = (part / total) * 100;'));
  assert.ok(!HUNDRED_MONEY.test('const limit = Math.min(100, Number(query.limit));'));
  assert.ok(!HUNDRED_MONEY.test('basisPoints / 100'));
  assert.ok(UTC_DAY.test('d.toISOString().slice(0,10)'));
  assert.ok(!UTC_DAY.test('toDateInputValue(value)'));
  assert.ok(CONFIGURES_FORMATTING.test('configureFormatting({ timeZone })'));
  assert.ok(!CONFIGURES_FORMATTING.test('formatSettings()'));
  assert.ok(READS_PACKAGE_DEFAULTS.test('{ ...DEFAULT_FORMAT_SETTINGS, timeZone }'));
  assert.ok(!READS_PACKAGE_DEFAULTS.test('formatSettingsFrom(localisation)'));

  // The owner really does configure the formatters, so the allow-list above is
  // naming a live call site rather than an empty exemption.
  const owner = readFileSync(join(apiRoot(), 'src', 'services', 'localisation.ts'), 'utf8');
  assert.ok(CONFIGURES_FORMATTING.test(withoutComments(owner)));
});
