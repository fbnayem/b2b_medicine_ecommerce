import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env } from '../src/env';

/**
 * Taking a backup, and proving it is readable.
 *
 * `docs/DEPLOYMENT.md` has asked for "monitored backup restoration" since the
 * hardening phase. There was no script, no schedule and no rehearsed restore —
 * which for a system whose entire value is an append-only financial ledger
 * means the recovery story was a sentence in a document.
 *
 * The discipline here is the one already proven in `retention.ts`: **write,
 * verify by reading back, and only then act.** A `mongodump` that exits 0 and
 * produced a truncated archive is precisely the failure that stays invisible
 * until the night somebody needs it.
 *
 *   node dist-scripts/scripts/backup.js --out /var/backups/medsupply
 *   node dist-scripts/scripts/backup.js --out /var/backups/medsupply --keep 14
 *   node dist-scripts/scripts/backup.js --dry-run
 *
 * The companion `restoreDrill.ts` restores the newest archive into a scratch
 * database and checks the ledger still balances. A backup that has never been
 * restored is not yet evidence of anything.
 */

interface Options {
  dryRun: boolean;
  outDir: string;
  keep: number;
  /** Run the MongoDB tools inside this container instead of on the host. */
  docker?: string;
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const keep = Number(value('--keep') ?? process.env.BACKUP_KEEP ?? 14);
  return {
    dryRun: argv.includes('--dry-run'),
    outDir: resolve(value('--out') ?? process.env.BACKUP_DIR ?? './backups'),
    keep: Number.isInteger(keep) && keep > 0 ? keep : 14,
    docker: value('--docker') ?? process.env.BACKUP_DOCKER_CONTAINER,
  };
}

/** The database the URI points at, which is what gets dumped and restored. */
export function databaseName(uri: string): string {
  const withoutQuery = uri.split('?')[0] ?? '';
  const name = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  if (!name) throw new Error('MONGODB_URI does not name a database');
  return name;
}

/** `medsupply-2026-08-03T18-20-00Z.archive.gz` — sorts chronologically as text. */
export function archiveName(database: string, at: Date): string {
  return `${database}-${at
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/-\d{3}Z$/, 'Z')}.archive.gz`;
}

function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolveDigest(hash.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Runs `mongodump`, writing the archive to `target` on this machine.
 *
 * With `--docker`, the tool runs inside the named container and the archive is
 * streamed back over stdout rather than written inside it. That matters because
 * the compose deployment this repository ships keeps MongoDB in a container
 * that has the tools, while the host running the backup usually does not — and
 * streaming avoids having to mount a writable volume into the database
 * container purely to get a file out of it.
 */
function runDump(options: Options, uri: string, target: string) {
  if (!options.docker) {
    const probe = spawnSync('mongodump', ['--version'], { encoding: 'utf8' });
    if (probe.error) {
      throw new Error(
        'mongodump is not on PATH. Either install the MongoDB Database Tools on the machine ' +
          'that runs backups, or pass --docker <container> to run them inside the database ' +
          'container. The API image deliberately does not carry them: a runtime container ' +
          'should not also hold the means to dump the whole database.',
      );
    }
    const dump = spawnSync('mongodump', [`--uri=${uri}`, `--archive=${target}`, '--gzip'], {
      encoding: 'buffer',
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    if (dump.status !== 0) {
      throw new Error(`mongodump exited ${dump.status}\n${dump.stderr?.toString() ?? ''}`);
    }
    return;
  }

  // `--archive` with no path writes the archive to stdout.
  const dump = spawnSync(
    'docker',
    ['exec', options.docker, 'mongodump', `--uri=${uri}`, '--archive', '--gzip'],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (dump.status !== 0) {
    throw new Error(
      `docker exec mongodump exited ${dump.status}\n${dump.stderr?.toString() ?? ''}`,
    );
  }
  writeFileSync(target, dump.stdout);
}

/** Keeps the newest `keep` archives and removes the rest, digests included. */
function prune(options: Options): string[] {
  const archives = readdirSync(options.outDir)
    .filter((name) => name.endsWith('.archive.gz'))
    .sort()
    .reverse();
  const removed: string[] = [];
  for (const name of archives.slice(options.keep)) {
    if (options.dryRun) {
      removed.push(name);
      continue;
    }
    unlinkSync(join(options.outDir, name));
    const digest = join(options.outDir, `${name}.sha256`);
    if (existsSync(digest)) unlinkSync(digest);
    removed.push(name);
  }
  return removed;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const database = databaseName(env.MONGODB_URI);
  const target = join(options.outDir, archiveName(database, new Date()));

  process.stdout.write(
    `Backing up ${database}${options.dryRun ? ' (dry run)' : ''}\n` +
      `  destination ${options.outDir}\n  keeping ${options.keep} archives\n\n`,
  );

  if (options.dryRun) {
    process.stdout.write(`  would write ${target}\n`);
    for (const name of prune(options)) process.stdout.write(`  would remove ${name}\n`);
    return;
  }

  mkdirSync(options.outDir, { recursive: true });
  runDump(options, env.MONGODB_URI, target);

  if (!existsSync(target) || statSync(target).size === 0) {
    throw new Error(`mongodump reported success but ${target} is missing or empty`);
  }

  /*
   * The digest is computed from the file on disk rather than from anything held
   * in memory, so it attests to what was actually written. `restoreDrill.ts`
   * refuses to restore an archive whose digest does not match.
   */
  const digest = await sha256OfFile(target);
  writeFileSync(`${target}.sha256`, `${digest}  ${target.split(/[\\/]/).pop()}\n`, 'utf8');

  const size = (statSync(target).size / 1_048_576).toFixed(1);
  process.stdout.write(`  wrote ${target}\n  ${size} MB, sha256 ${digest.slice(0, 16)}…\n`);

  const removed = prune(options);
  for (const name of removed) process.stdout.write(`  pruned ${name}\n`);
  process.stdout.write(
    `\nDone. Run the restore drill before trusting this:\n` +
      `  node dist-scripts/scripts/restoreDrill.js --from ${options.outDir}\n`,
  );
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      process.stderr.write(`\nBackup failed: ${(error as Error).message}\n`);
      process.exit(1);
    });
}
