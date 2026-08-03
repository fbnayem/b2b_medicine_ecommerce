import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { redact } from './logger';

/**
 * Two guards over the same rule: everything the API writes to its output goes
 * through the redacting logger, and the redactor actually redacts.
 *
 * `services/logger.ts` exists precisely to strip credentials from log lines. It
 * was added in a later phase than most of the code around it, so nine call
 * sites were still writing to the console directly and therefore skipping it
 * entirely. The worst was not an error path at all: an unconfigured
 * notification channel printed the whole message body, and for a delivery
 * notification that body is the OTP the receiver is about to be asked for.
 */

const ALLOWED = new Set([
  // Reports an invalid environment and exits. It runs before the logger can be
  // imported, because the logger reads the very configuration being validated.
  'env.ts',
  // The logger's own sink. Something has to call the console eventually.
  'services/logger.ts',
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

test('nothing writes to the console except the logger and startup validation', () => {
  const source = join(apiRoot(), 'src');
  const files = sourcesUnder(source);
  assert.ok(files.length > 0, 'found no sources at all, which means this guard is broken');

  const offenders = files
    .map((file) => ({
      name: relative(source, file).split(sep).join('/'),
      text: readFileSync(file, 'utf8'),
    }))
    .filter(({ name, text }) => !ALLOWED.has(name) && /\bconsole\s*\./.test(text))
    .map(({ name }) => name);

  assert.deepEqual(
    offenders,
    [],
    `These files write to the console directly, so their output skips redaction:\n` +
      offenders.map((name) => `  - src/${name}`).join('\n') +
      `\nUse logger.info/warn/error from services/logger.ts instead.`,
  );
});

test('redaction survives an Error and strips what rides along with it', () => {
  const failure = new Error('delivery notification failed') as Error & Record<string, unknown>;
  failure.data = { phone: '01712345678', otp: '482913', orderReference: 'ORD-2026-000042' };

  const output = redact(failure) as Record<string, unknown>;

  // Object.keys on an Error is empty and JSON.stringify(error) is "{}", so a
  // redactor that treats it as a plain object silently discards the only part
  // anyone reads. That failure mode is why these call sites stayed on the
  // console: the console prints errors correctly and redacts nothing.
  assert.equal(output.name, 'Error');
  assert.equal(output.message, 'delivery notification failed');
  assert.ok(typeof output.stack === 'string' && (output.stack as string).length > 0);

  const attached = output.data as Record<string, unknown>;
  assert.equal(attached.otp, '[redacted]');
  assert.equal(attached.orderReference, 'ORD-2026-000042', 'non-sensitive context must survive');
});

test('redaction reaches a cause set through the constructor option', () => {
  const cause = new Error('upstream refused') as Error & Record<string, unknown>;
  cause.token = 'eyJhbGciOi';
  const output = redact(new Error('send failed', { cause })) as Record<string, unknown>;

  // `cause` is non-enumerable when set this way, so it is invisible to
  // Object.keys and would be dropped without an explicit branch.
  const inner = output.cause as Record<string, unknown>;
  assert.equal(inner.message, 'upstream refused');
  assert.equal(inner.token, '[redacted]');
});
