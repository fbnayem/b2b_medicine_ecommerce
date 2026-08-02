import { spawn } from 'node:child_process';
import { once } from 'node:events';

/**
 * The development server.
 *
 * This used to be `ts-node-dev --respawn --transpile-only src/server.ts`, which
 * cannot start at all: ts-node-dev pins ts-node 10, whose configuration reader
 * expects a compiler API that TypeScript 7 no longer exposes, so it throws
 * `Cannot read properties of undefined (reading 'fileExists')` before it
 * compiles a line. The same pin is why the migrations had to be compiled in
 * Phase 12; this is the last thing still running through it.
 *
 * Node 24 can execute TypeScript directly, but only by stripping types — it
 * does not rewrite `import` into `require`, and this package compiles to
 * CommonJS, so `node src/server.ts` fails on the first import.
 *
 * So: `tsc --watch` compiles, `node --watch` restarts on what it emits. Two
 * processes doing exactly what ts-node-dev did, using tools already installed,
 * with no additional dependency to go stale the same way.
 */

const children = [];

// Each command is a single fixed string rather than a command plus an argument
// array: `shell: true` with separate arguments concatenates them unescaped,
// which Node warns about (DEP0190) on every start. Nothing here is derived from
// input, so a literal is both safe and quiet. The shell is needed on Windows,
// where `tsc` resolves through a .cmd shim.
const run = (commandLine) => {
  const child = spawn(commandLine, { stdio: 'inherit', shell: true });
  children.push(child);
  return child;
};

// Compile once before the server starts, so `node --watch` has something to run
// and the first failure a developer sees is a type error rather than
// `Cannot find module './dist/server.js'`.
const build = run('tsc');
const [code] = await once(build, 'exit');
if (code !== 0) {
  console.error('\nInitial compile failed. Fix the errors above and run `pnpm dev` again.');
  process.exit(code ?? 1);
}

run('tsc --watch --preserveWatchOutput');
run('node --watch dist/server.js');

// One Ctrl+C should stop both, and neither should outlive the other: a stale
// compiler writing into dist while the next `pnpm dev` runs is a confusing way
// to spend an afternoon.
const stopAll = () => {
  for (const child of children) child.kill();
};

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
for (const child of children) child.on('exit', () => process.exit());
