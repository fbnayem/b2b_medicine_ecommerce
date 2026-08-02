import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';

/**
 * Guards the test scripts against silently running nothing.
 *
 * `apps/api/package.json` names every compiled suite explicitly, because
 * Node 20 — the documented CI runtime — cannot glob test files (that arrived in
 * Node 21). An explicit list is the correct trade, but it has one failure mode:
 * add a `*.test.ts` and forget to register it, and the file compiles, lints and
 * type-checks while never running. Nothing else would notice, and the suite
 * would report success over code no one had executed.
 *
 * This is the same class of defect as `pnpm --filter X typecheck` exiting zero
 * on a script that does not exist: a gate that silently stopped being a gate.
 */

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

function testSourcesUnder(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) testSourcesUnder(full, found);
    else if (entry.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

test('every test file is registered with a script that actually runs it', () => {
  const root = apiRoot();
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const registered = `${manifest.scripts.test} ${manifest.scripts['test:integration']}`;

  const sources = testSourcesUnder(join(root, 'src'));
  assert.ok(sources.length > 0, 'found no test sources at all, which means this guard is broken');

  const unregistered = sources
    .map((file) => relative(join(root, 'src'), file).split(sep).join('/'))
    .filter((suite) => !registered.includes(suite.replace(/\.ts$/, '.js')));

  assert.deepEqual(
    unregistered,
    [],
    `These suites exist but no script runs them, so they are silently skipped:\n` +
      unregistered.map((suite) => `  - src/${suite}`).join('\n') +
      `\nAdd each to "test" (pure logic) or "test:integration" (needs a database) ` +
      `in apps/api/package.json.`,
  );
});
