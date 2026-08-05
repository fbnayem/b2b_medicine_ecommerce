import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';

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

/**
 * Refuse to start when something already holds the port.
 *
 * `node --watch` does not exit when the script it runs fails, so a server child
 * that died on `EADDRINUSE` left this supervisor alive and `pnpm dev` looking
 * healthy. Three stacks accumulated that way, and the process actually
 * answering was a `node dist/server.js` started thirty-four hours earlier —
 * serving a build without `/trips`, `/pricing`, `/stocktakes`, `/warehouses`,
 * `/orders/quote` or `/media`. Fourteen screens reported that records had been
 * removed, and nothing anywhere said the word "port".
 *
 * Checking first turns that day and a half into one sentence.
 */
async function portIsFree(port) {
  const probe = createServer();
  return new Promise((resolve) => {
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    /*
     * No host, because that is exactly how `server.ts` binds.
     *
     * This mattered: the first version passed `'0.0.0.0'` and reported the port
     * free while the API was answering on it. Windows treats the IPv4 and IPv6
     * wildcards as distinct addresses, so a probe on `0.0.0.0` does not collide
     * with the server's dual-stack `::` bind — and a check that cannot fail is
     * the same defect as no check at all, which is what this file exists to
     * prevent. Verified: `listen(5000)` and `listen(5000, '::')` both answer
     * EADDRINUSE where `'0.0.0.0'` and `'127.0.0.1'` report free.
     */
    probe.listen(port);
  });
}

/*
 * Resolve the port the way the server will, without importing `env.ts`: this
 * file runs before anything is compiled. `dotenv` is loaded by `server.ts`, so
 * `process.env` does not carry `.env` yet — read it here rather than probing a
 * port nobody is going to use. The default matches `env.ts`'s own, and
 * `server.ts`'s `'error'` handler is the backstop if this resolves wrongly.
 */
function configuredPort() {
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    const file = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const match = /^\s*PORT\s*=\s*(\d+)/m.exec(file);
    if (match) return Number(match[1]);
  } catch {
    // No `.env` — a container, or a first run. The default is right there.
  }
  return 5000;
}

const port = configuredPort();
if (!(await portIsFree(port))) {
  console.error(
    `\nPort ${port} is already in use, so the API was not started.\n` +
      'Something else is answering on it — most likely an API process left over\n' +
      'from an earlier run, which will keep serving whatever build it loaded.\n\n' +
      `  Windows:  netstat -ano | findstr :${port}   then  taskkill /PID <pid> /F\n` +
      `  macOS/Linux:  lsof -ti :${port} | xargs kill\n`,
  );
  process.exit(1);
}

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
