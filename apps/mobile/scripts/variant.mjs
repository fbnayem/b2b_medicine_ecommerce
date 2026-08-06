import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * `node scripts/variant.mjs rider start --android` → Expo, with `APP_VARIANT=rider`.
 *
 * There are three applications now, so every `expo` command needs to be told
 * which one. The usual way to write that in a package script is
 * `APP_VARIANT=rider expo start`, which **does not work on Windows** — neither
 * `cmd` nor PowerShell understands a variable assignment prefixing a command,
 * and this project is developed on Windows.
 *
 * `cross-env` is the usual answer and is not a dependency here. Twelve lines of
 * Node do the same thing, cannot go stale, and keep the scripts readable in a
 * file everybody already opens.
 */

const [variant, ...args] = process.argv.slice(2);

const VARIANTS = ['shop', 'staff', 'rider'];
if (!VARIANTS.includes(variant)) {
  console.error(
    `Usage: node scripts/variant.mjs <${VARIANTS.join('|')}> <expo arguments…>\n` +
      `Got "${variant ?? ''}".`,
  );
  process.exit(1);
}

/*
 * Run Expo's own entry point on this Node, rather than going through `npx`.
 *
 * `spawn('npx', …, { shell: true })` warns on Node 24 that the arguments are
 * concatenated rather than escaped, and `spawn('npx.cmd')` without a shell is
 * refused outright — Node 24 blocks spawning a `.cmd` directly, which is the
 * fix for CVE-2024-27980. Resolving the CLI and running it is neither, and it
 * also guarantees the Expo in this workspace rather than whichever one `npx`
 * decides to fetch.
 */
const expoCli = createRequire(import.meta.url).resolve('expo/bin/cli');

const child = spawn(process.execPath, [expoCli, ...args], {
  stdio: 'inherit',
  env: { ...process.env, APP_VARIANT: variant },
});

child.on('exit', (code, signal) => {
  // Pass the failure through, or `pnpm start:rider` reports success on a crash.
  process.exit(signal ? 1 : (code ?? 0));
});
