import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import mongoose from 'mongoose';
import { env } from '../src/env';
import { databaseName } from './backup';

/**
 * Restoring the newest backup and checking that what came back is intact.
 *
 * An untested backup is a belief, not a control. This restores into a scratch
 * database — never over the live one — and then asks the restored data the one
 * question that matters for a double-entry system: **does every ledger
 * transaction still balance?**
 *
 * That check is deliberately not a row count. A truncated or partially-restored
 * archive can easily produce plausible counts; it cannot produce a collection of
 * transactions whose debits all equal their credits, because the invariant is
 * enforced per document at write time in `LedgerTransaction`'s pre-validate
 * hook. If it holds after a restore, the financial record survived.
 *
 *   node dist-scripts/scripts/restoreDrill.js --from /var/backups/medsupply
 *   node dist-scripts/scripts/restoreDrill.js --from ./backups --keep-scratch
 *
 * Exits non-zero on any failure, so it can be run from cron and alerted on.
 */

interface Options {
  fromDir: string;
  keepScratch: boolean;
  archive?: string;
  /** Run the MongoDB tools inside this container instead of on the host. */
  docker?: string;
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    fromDir: resolve(value('--from') ?? process.env.BACKUP_DIR ?? './backups'),
    keepScratch: argv.includes('--keep-scratch'),
    archive: value('--archive'),
    docker: value('--docker') ?? process.env.BACKUP_DOCKER_CONTAINER,
  };
}

function newestArchive(directory: string): string {
  const archives = readdirSync(directory)
    .filter((name) => name.endsWith('.archive.gz'))
    .sort()
    .reverse();
  const newest = archives[0];
  if (!newest) throw new Error(`No .archive.gz files in ${directory}`);
  return join(directory, newest);
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

/** Swaps the database in a connection string without touching its options. */
export function withDatabase(uri: string, database: string): string {
  const [base, query] = uri.split('?');
  const trimmed = (base ?? '').slice(0, (base ?? '').lastIndexOf('/'));
  return `${trimmed}/${database}${query ? `?${query}` : ''}`;
}

/**
 * The same server with no database named.
 *
 * `mongorestore` treats a database in the URI as `--db`, which silently
 * conflicts with `--nsFrom`/`--nsTo`: the namespace filter then matches nothing
 * and the tool reports **success having restored zero documents**. That is the
 * worst possible failure for a drill, because a green run would mean nothing at
 * all — which is exactly what happened the first time this was run.
 */
export function withoutDatabase(uri: string): string {
  const [base, query] = uri.split('?');
  const trimmed = (base ?? '').slice(0, (base ?? '').lastIndexOf('/'));
  return `${trimmed}/${query ? `?${query}` : ''}`;
}

interface Finding {
  ok: boolean;
  label: string;
  detail: string;
}

/** Document counts per collection, for reconciling a restore against its source. */
async function countsFor(uri: string): Promise<Map<string, number>> {
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    const database = connection.db;
    if (!database) throw new Error(`No database handle for ${uri}`);
    const counts = new Map<string, number>();
    for (const collection of await database.listCollections().toArray()) {
      counts.set(collection.name, await database.collection(collection.name).countDocuments());
    }
    return counts;
  } finally {
    await connection.close();
  }
}

async function checkRestored(uri: string, source: Map<string, number>): Promise<Finding[]> {
  const findings: Finding[] = [];
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    const database = connection.db;
    if (!database) throw new Error('No database handle on the scratch connection');

    const names = (await database.listCollections().toArray()).map((c) => c.name);
    findings.push({
      ok: names.length > 0,
      label: 'collections restored',
      detail: `${names.length} collections`,
    });

    /*
     * Reconcile against the live database rather than merely looking for
     * damage. A truncated archive restores cleanly and produces a perfectly
     * self-consistent — and much smaller — database; only a comparison with the
     * source reveals it.
     */
    const shortfalls: string[] = [];
    for (const [name, expected] of source) {
      if (expected === 0) continue;
      const actual = await database.collection(name).countDocuments();
      if (actual !== expected) shortfalls.push(`${name} ${actual}/${expected}`);
    }
    const totalExpected = [...source.values()].reduce((sum, count) => sum + count, 0);
    findings.push({
      ok: shortfalls.length === 0,
      label: 'document counts match the source',
      detail:
        shortfalls.length === 0
          ? `${totalExpected} documents across ${source.size} collections`
          : `short: ${shortfalls.slice(0, 5).join(', ')}`,
    });

    /*
     * The financial invariant. Every entry array must have equal debits and
     * credits; a single unbalanced document means the restore is not faithful
     * and the archive must not be trusted.
     */
    if (names.includes('ledgertransactions')) {
      const unbalanced = await database
        .collection('ledgertransactions')
        .aggregate([
          {
            $project: {
              reference: 1,
              debit: { $sum: '$entries.debitMinor' },
              credit: { $sum: '$entries.creditMinor' },
            },
          },
          { $match: { $expr: { $ne: ['$debit', '$credit'] } } },
          { $limit: 5 },
        ])
        .toArray();
      const total = await database.collection('ledgertransactions').countDocuments();
      findings.push({
        ok: unbalanced.length === 0,
        label: 'every ledger transaction balances',
        detail:
          unbalanced.length === 0
            ? `${total} transactions, all balanced`
            : `${unbalanced.length}+ unbalanced, e.g. ${unbalanced.map((row) => row.reference).join(', ')}`,
      });
    } else {
      findings.push({
        ok: false,
        label: 'every ledger transaction balances',
        detail: 'ledgertransactions is missing from the archive',
      });
    }

    // An issued invoice with no reference would mean documents came back
    // partially written, which counts alone would not reveal.
    if (names.includes('invoices')) {
      const broken = await database
        .collection('invoices')
        .countDocuments({ $or: [{ reference: { $exists: false } }, { reference: '' }] });
      findings.push({
        ok: broken === 0,
        label: 'every invoice kept its reference',
        detail: broken === 0 ? 'all references present' : `${broken} invoices without a reference`,
      });
    }
  } finally {
    await connection.close();
  }
  return findings;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const archive = options.archive ? resolve(options.archive) : newestArchive(options.fromDir);
  const scratch = `${databaseName(env.MONGODB_URI)}_restoredrill`;

  process.stdout.write(`Restore drill\n  archive ${archive}\n  into    ${scratch}\n\n`);

  // The digest is checked before anything is restored. An archive that does not
  // match what was written is not a backup, and running it would only produce a
  // confident-looking result from corrupt input.
  const digestFile = `${archive}.sha256`;
  if (!existsSync(digestFile)) throw new Error(`No digest beside ${archive}`);
  const expected = readFileSync(digestFile, 'utf8').trim().split(/\s+/)[0];
  const actual = await sha256OfFile(archive);
  if (expected !== actual) {
    throw new Error(
      `Digest mismatch for ${archive}\n  expected ${expected}\n  actual   ${actual}\n` +
        `Nothing was restored. Treat this archive as unusable.`,
    );
  }
  process.stdout.write(`  digest verified ${actual.slice(0, 16)}…\n`);

  const scratchUri = withDatabase(env.MONGODB_URI, scratch);
  const toolArgs = [
    // Deliberately database-less: see `withoutDatabase`. The namespace mapping
    // below is what directs the restore, and it is also what keeps the live
    // database out of reach of the `--drop`.
    `--uri=${withoutDatabase(env.MONGODB_URI)}`,
    '--gzip',
    `--nsFrom=${databaseName(env.MONGODB_URI)}.*`,
    `--nsTo=${scratch}.*`,
    '--drop',
  ];

  // With `--docker` the archive is fed to the tool over stdin, mirroring how
  // `backup.ts` streams it out; without it, the tool reads the file directly.
  const restore = options.docker
    ? spawnSync(
        'docker',
        ['exec', '-i', options.docker, 'mongorestore', '--archive', ...toolArgs],
        {
          input: readFileSync(archive),
          encoding: 'buffer',
          maxBuffer: 1024 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
    : spawnSync('mongorestore', [`--archive=${archive}`, ...toolArgs], {
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  if (restore.status !== 0) {
    throw new Error(`mongorestore exited ${restore.status}\n${restore.stderr?.toString() ?? ''}`);
  }
  process.stdout.write('  restored\n\n');

  // Read the source counts after the restore: the restore only ever writes to
  // the scratch namespace, so the live figures cannot have moved because of it.
  const source = await countsFor(env.MONGODB_URI);
  const findings = await checkRestored(scratchUri, source);
  for (const finding of findings) {
    process.stdout.write(
      `  ${finding.ok ? 'ok  ' : 'FAIL'}  ${finding.label} — ${finding.detail}\n`,
    );
  }

  if (!options.keepScratch) {
    const connection = await mongoose.createConnection(scratchUri).asPromise();
    await connection.db?.dropDatabase();
    await connection.close();
    process.stdout.write(`\n  scratch database dropped\n`);
  }

  const failed = findings.filter((finding) => !finding.ok);
  if (failed.length > 0) {
    throw new Error(`${failed.length} check(s) failed. This backup is not restorable.`);
  }
  process.stdout.write('\nDone. This backup restores and the ledger balances.\n');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      process.stderr.write(`\nRestore drill failed: ${(error as Error).message}\n`);
      process.exit(1);
    });
}
