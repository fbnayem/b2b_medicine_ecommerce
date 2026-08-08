import 'dotenv/config';
import mongoose from 'mongoose';
import { UserRole } from '@medsupply/shared-types';
import { env } from '../src/env';
import { AuditLog } from '../src/models/AuditLog';
import { User } from '../src/models/User';

/**
 * Empties the product catalogue and everything downstream of it.
 *
 * **Dry run unless `--apply` is passed.** This deletes more than it is asked to,
 * on purpose, and that is the part worth understanding before running it.
 *
 * A medicine is not a leaf. Thirteen models hold an `ObjectId` pointing at one —
 * order lines, invoice lines, batches, stock movements, picking lists, price
 * lists, schemes — and Mongoose does not enforce referential integrity, so
 * `Medicine.deleteMany({})` succeeds instantly and leaves every one of those
 * documents pointing at nothing. The damage does not show up until somebody
 * opens an order and the line has no product, or runs a stock report over a
 * ledger whose rows no longer name anything. That failure is silent, arrives
 * later, and is indistinguishable from a bug in the screen.
 *
 * So the catalogue and its dependants go together. `--apply` refuses to run
 * unless the dry run has shown exactly what that means.
 *
 * **What survives is who you are and who you sell to**: users, their sessions,
 * devices and notification preferences; shops; suppliers; warehouses; system
 * settings. A reset leaves you able to log in and place the first order against
 * the new catalogue, and nothing else.
 *
 * **Audit records survive too, and the reset adds one.** They are append-only by
 * design — the record that an order existed is not invalidated by the order
 * being deleted, and a reset that erased its own evidence would be the single
 * worst thing in here. `CATALOGUE_RESET` names the operator and carries the
 * counts.
 *
 * **Counters are not rewound.** The next medicine is `MED-2026-000052`, not
 * `MED-2026-000001`. Rewinding would mint references that audit records and
 * printed paperwork already use for something else, which is a worse problem
 * than a gap in a sequence.
 */

/**
 * Everything that is downstream of a product, in the order a person would
 * explain it: the catalogue, then stock, then the order-to-cash chain, then
 * fulfilment, then the things that merely talk about all of it.
 *
 * Named as collections rather than imported models deliberately — this must
 * clear a collection that exists in the database even if its model file has been
 * renamed since, and it must not silently skip one because an import was
 * dropped. `verifyCoverage` below is what stops the list going stale.
 */
const CLEARED: ReadonlyArray<readonly [string, string]> = [
  ['medicines', 'the catalogue itself'],
  ['medicinerelations', 'which products are shown beside which — meaningless without both ends'],
  ['medicinecontents', 'the supplier monograph, which hangs off a medicine by id'],
  /*
   * Cleared rather than kept, which is the less obvious of the two.
   *
   * The archive holds the supplier's own ids, not `medicineId`, so keeping it
   * would strand no dead reference — the usual test this list applies. It is
   * cleared for a different reason: a reset is always followed by an import,
   * an import needs the bundle, and the import rewrites every archived record
   * anyway. Keeping it would mean a reset that loads a *different* supplier's
   * bundle silently leaves the previous one's records behind, describing a
   * catalogue that no longer exists.
   *
   * This does not weaken the archive's purpose. It exists so a mapping
   * decision can be revisited by migrating over stored records instead of
   * re-scraping — and that is the case where nobody resets.
   */
  [
    'cataloguesourcerecords',
    'the archived supplier record behind a catalogue that is being replaced',
  ],
  ['medicinebatches', 'stock, batch by batch'],
  ['stockmovements', 'the stock ledger'],
  ['stocktakes', 'counts against that stock'],
  ['orders', 'orders, which have product lines'],
  ['orderapprovals', 'the decisions taken on them'],
  ['invoices', 'invoices, which have product lines'],
  ['creditnotes', 'credits raised against invoices'],
  ['creditreservations', 'credit held for open orders'],
  ['ledgertransactions', 'the customer ledger, posted from invoices and payments'],
  ['payments', 'payments against invoices'],
  ['paymentattachments', 'their proof'],
  ['pickinglists', 'picking, line by product line'],
  ['packages', 'what was packed'],
  ['deliveries', 'what was delivered'],
  ['trips', 'the rounds those deliveries were on'],
  ['prooffiles', 'delivery proof'],
  ['returns', 'goods sent back'],
  ['purchaseorders', 'what was ordered from suppliers'],
  ['goodsreceipts', 'what arrived'],
  ['pricelists', 'per-customer pricing, keyed by product'],
  ['schemes', 'promotions, keyed by product'],
  ['notifications', 'messages about all of the above'],
  ['notificationdeliveries', 'and their delivery attempts'],
  ['activityevents', 'the activity feed'],
];

/**
 * What a reset is not allowed to touch, and why — checked rather than assumed.
 *
 * Every collection in the database must appear in exactly one of these two
 * lists. A model added later that holds a `medicineId` and is in neither would
 * otherwise survive the reset holding a dead reference, which is the precise
 * failure this whole script exists to prevent.
 */
const KEPT: ReadonlyArray<readonly [string, string]> = [
  ['users', 'who works here and who buys'],
  ['sessions', 'so nobody is signed out by a catalogue change'],
  ['pushdevices', 'their handsets'],
  ['notificationpreferences', 'what they asked to be told about'],
  ['shops', 'the customers'],
  ['suppliers', 'who we buy from'],
  ['warehouses', 'where stock lives'],
  ['systemsettings', 'configuration'],
  ['counters', 'reference series — see the note above on not rewinding'],
  ['auditlogs', 'append-only; the record survives the records'],
  ['migrationruns', 'what has already been migrated'],
];

const APPLY = process.argv.includes('--apply');

function verifyCoverage(present: string[]): string[] {
  const known = new Set([...CLEARED, ...KEPT].map(([name]) => name));
  return present.filter((name) => !known.has(name) && !name.startsWith('system.'));
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db!;

  const present = (await db.listCollections().toArray()).map((c) => c.name);
  const unknown = verifyCoverage(present);
  if (unknown.length) {
    throw new Error(
      `These collections are in neither the clear list nor the keep list, so this ` +
        `script does not know whether they depend on the catalogue: ${unknown.join(', ')}. ` +
        `Add each to CLEARED or KEPT in ${__filename} before running a reset.`,
    );
  }

  const operator =
    (await User.findOne({ email: 'catalogue-import@medsupply.local' })) ??
    (await User.findOne({ role: { $in: [UserRole.SUPER_ADMIN, UserRole.ADMIN] } }));
  if (!operator) {
    throw new Error(
      'No administrator to attribute the reset to. Run `pnpm --filter @medsupply/api bootstrap` first.',
    );
  }

  const counts = new Map<string, number>();
  for (const [name] of CLEARED) {
    counts.set(name, present.includes(name) ? await db.collection(name).countDocuments() : 0);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

  const mode = APPLY ? 'APPLIED' : 'DRY RUN — nothing was deleted';
  console.log(`\n  Catalogue reset — ${mode}`);
  console.log(`  database: ${env.MONGODB_URI.replace(/\/\/[^@]*@/, '//')}`);
  console.log(`  attributed to: ${operator.email}\n`);

  console.log(`  would delete ${total} documents:`);
  for (const [name, why] of CLEARED) {
    const n = counts.get(name) ?? 0;
    if (n === 0) continue;
    console.log(`      - ${String(n).padStart(6)}  ${name.padEnd(24)} ${why}`);
  }
  const empty = CLEARED.filter(([name]) => (counts.get(name) ?? 0) === 0).map(([name]) => name);
  if (empty.length) console.log(`      (already empty: ${empty.join(', ')})`);

  console.log(`\n  keeping:`);
  for (const [name, why] of KEPT) {
    const n = present.includes(name) ? await db.collection(name).countDocuments() : 0;
    console.log(`      = ${String(n).padStart(6)}  ${name.padEnd(24)} ${why}`);
  }

  if (!APPLY) {
    console.log(`\n  Nothing was written. Re-run with --apply to delete the above.\n`);
    await mongoose.disconnect();
    return;
  }

  for (const [name] of CLEARED) {
    if (!present.includes(name)) continue;
    await db.collection(name).deleteMany({});
  }

  /*
   * The reset is itself a sensitive operation, so it leaves the record that it
   * happened. `entityId` is the operator rather than a deleted document: there
   * is no single entity this acted on, and inventing an id for one would put a
   * reference in the audit trail that resolves to nothing.
   */
  await AuditLog.create({
    actorId: operator._id,
    actorRole: operator.role,
    action: 'CATALOGUE_RESET',
    entityType: 'Medicine',
    entityId: operator._id,
    before: Object.fromEntries([...counts].filter(([, n]) => n > 0)),
    after: { deleted: total },
  });

  console.log(`\n  Deleted ${total} documents across ${CLEARED.length} collections.`);
  console.log(`  Recorded as CATALOGUE_RESET in the audit log.\n`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
