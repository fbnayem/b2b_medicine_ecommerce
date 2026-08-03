import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Guards the pipeline against silently not checking a package.
 *
 * `.github/workflows/ci.yml` hand-lists every command per workspace rather than
 * driving them from `turbo run`. That is a deliberate trade — turbo's wrapper
 * fails on the development workstation's Node version — but it has one failure
 * mode, and the project has already been bitten by it: for twelve phases the
 * five `packages/*` were typechecked, linted and tested by nothing at all,
 * because nobody added them to the list. A package can be added, imported by
 * both applications, and shipped without any gate ever reading it.
 *
 * This is `testWiring.test.ts` one level up: that one proves every test file is
 * run by a script, this one proves every script is run by the pipeline.
 */

function repositoryRoot(): string {
  let directory = __dirname;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;
    directory = dirname(directory);
  }
  throw new Error('Could not locate the repository root');
}

interface WorkspacePackage {
  name: string;
  location: string;
  scripts: Record<string, string>;
}

/**
 * Reads the workspace globs rather than hard-coding `apps` and `packages`, so
 * adding a third root to `pnpm-workspace.yaml` does not quietly escape this.
 */
function workspaceRoots(root: string): string[] {
  const manifest = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [...manifest.matchAll(/^\s*-\s*'?([^'\n]+?)'?\s*$/gm)].map((match) => match[1]);
  return globs
    .filter((glob) => glob.endsWith('/*'))
    .map((glob) => glob.slice(0, -2))
    .filter((directory) => existsSync(join(root, directory)));
}

function workspacePackages(root: string): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const directory of workspaceRoots(root)) {
    for (const entry of readdirSync(join(root, directory))) {
      const manifestPath = join(root, directory, entry, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      found.push({
        name: manifest.name,
        location: `${directory}/${entry}`,
        scripts: manifest.scripts ?? {},
      });
    }
  }
  return found;
}

/**
 * Matches `pnpm --filter <name> [run] <script>` while refusing to let `test`
 * match inside `test:integration`, which would report the unit suite as wired
 * when only the integration suite is.
 */
function pipelineRuns(pipeline: string, name: string, script: string): boolean {
  const pattern = new RegExp(
    `--filter\\s+${name.replace(/[/@]/g, '\\$&')}\\s+(?:run\\s+)?${script.replace(/[:]/g, '\\$&')}(?![\\w:-])`,
  );
  return pattern.test(pipeline);
}

/** The scripts that are gates. A package need not define them; if it does, CI must run them. */
const GATED_SCRIPTS = ['build', 'typecheck', 'lint', 'test', 'test:integration'] as const;

/**
 * `build` is a prerequisite of other packages' typechecks rather than a gate of
 * its own, so an application whose build is proven by the container image step
 * does not need a line here. Only the shared packages must be built, because
 * every consumer resolves them through `main`.
 */
const BUILD_EXEMPT = new Set(['@medsupply/mobile']);

test('every workspace package is known to the pipeline', () => {
  const root = repositoryRoot();
  const packages = workspacePackages(root);

  assert.ok(packages.length >= 5, 'found almost no workspace packages, so this guard is broken');

  const unchecked = packages.filter((entry) => !entry.scripts.typecheck);
  assert.deepEqual(
    unchecked.map((entry) => entry.location),
    [],
    'These packages define no `typecheck` script, so no gate can ever read them:\n' +
      unchecked.map((entry) => `  - ${entry.location}`).join('\n'),
  );
});

test('every gated script in every package is run by the pipeline', () => {
  const root = repositoryRoot();
  const pipeline = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const packages = workspacePackages(root);

  const missing: string[] = [];
  for (const entry of packages) {
    for (const script of GATED_SCRIPTS) {
      if (!entry.scripts[script]) continue;
      if (script === 'build' && BUILD_EXEMPT.has(entry.name)) continue;
      if (!pipelineRuns(pipeline, entry.name, script)) {
        missing.push(`  - ${entry.name} defines "${script}" but CI never runs it`);
      }
    }
  }

  assert.deepEqual(
    missing,
    [],
    'The pipeline hand-lists its commands, and these were left off it:\n' +
      missing.join('\n') +
      '\nAdd each to the matching step in .github/workflows/ci.yml.',
  );
});
