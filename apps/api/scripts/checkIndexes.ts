import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Index verification and synchronisation.
 *
 * Mongoose builds indexes in the background when a model is first used, which
 * is convenient in development and unsafe as a release step: on a collection
 * with real volume the first request after a deployment can be the one that
 * triggers a long build, and until it finishes the query it was meant to serve
 * runs as a collection scan.
 *
 * This makes that an explicit step. Run it in report mode before a release to
 * see what would change, and in apply mode as part of the deployment.
 *
 *   pnpm --filter @medsupply/api indexes            # report only
 *   pnpm --filter @medsupply/api indexes -- --apply # create what is missing
 *   pnpm --filter @medsupply/api indexes -- --apply --prune
 *
 * Pruning drops indexes the models no longer declare. It is opt-in because an
 * index this code does not know about may have been added deliberately by an
 * operator to serve an ad-hoc query.
 */

// Importing the barrel registers every schema with Mongoose.
import '../src/models/ActivityEvent';
import '../src/models/AuditLog';
import '../src/models/Counter';
import '../src/models/CreditNote';
import '../src/models/CreditReservation';
import '../src/models/Delivery';
import '../src/models/Invoice';
import '../src/models/LedgerTransaction';
import '../src/models/Medicine';
import '../src/models/MedicineBatch';
import '../src/models/MigrationRun';
import '../src/models/Notification';
import '../src/models/NotificationDelivery';
import '../src/models/NotificationPreference';
import '../src/models/Order';
import '../src/models/OrderApproval';
import '../src/models/Package';
import '../src/models/Payment';
import '../src/models/PaymentAttachment';
import '../src/models/PickingList';
import '../src/models/ProofFile';
import '../src/models/PushDevice';
import '../src/models/Return';
import '../src/models/Session';
import '../src/models/Shop';
import '../src/models/StockMovement';
import '../src/models/SystemSetting';
import '../src/models/User';

const apply = process.argv.includes('--apply');
const prune = process.argv.includes('--prune');

const keyOf = (key: Record<string, unknown>) =>
  Object.entries(key)
    .map(([field, direction]) => `${field}:${String(direction)}`)
    .join(',');

/**
 * A text index is stored under the generated `_fts`/`_ftsx` key rather than the
 * fields it was declared on, so comparing keys literally would report the same
 * index as both missing and unknown, for ever. MongoDB permits only one text
 * index per collection, so matching them by kind is exact rather than a guess.
 */
const TEXT_DECLARED = ':text';
const TEXT_STORED = '_fts';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  /**
   * The database is inspected through the driver rather than through a Mongoose
   * connection. Mongoose builds declared indexes in the background as soon as a
   * model is used, so a Mongoose connection would create the very indexes this
   * script exists to report on. Mongoose is still the source of what *should*
   * exist: `schema.indexes()` needs no connection at all.
   */
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();
  const database = client.db();
  console.log(`Connected to ${database.databaseName}`);
  console.log(apply ? 'Mode: apply' : 'Mode: report only (pass --apply to create)');

  let missing = 0;
  let extra = 0;

  for (const name of Object.keys(mongoose.models).sort()) {
    const model = mongoose.models[name];
    const collection = database.collection(model.collection.collectionName);
    const declared = new Map(
      model.schema
        .indexes()
        .map(([key, options]) => [keyOf(key as Record<string, unknown>), options]),
    );

    let existing = new Map<string, { name: string }>();
    try {
      const indexes = await collection.indexes();
      existing = new Map(
        indexes.map((index) => [
          keyOf(index.key as Record<string, unknown>),
          { name: String(index.name) },
        ]),
      );
    } catch {
      // The collection has never been written to, so it has no indexes yet.
    }

    const declaredText = [...declared.keys()].some((key) => key.includes(TEXT_DECLARED));
    const existingText = [...existing.keys()].some((key) => key.includes(TEXT_STORED));

    const absent = [...declared.keys()].filter((key) => {
      if (key.includes(TEXT_DECLARED)) return !existingText;
      return !existing.has(key);
    });
    // `_id` is implicit and always present; it is never declared or dropped.
    const unknown = [...existing.keys()].filter((key) => {
      if (key === '_id:1') return false;
      if (key.includes(TEXT_STORED)) return !declaredText;
      return !declared.has(key);
    });

    if (absent.length === 0 && unknown.length === 0) {
      console.log(`  ${name}: ${declared.size} declared index(es), all present`);
      continue;
    }

    console.log(`  ${name}:`);
    for (const key of absent) {
      missing += 1;
      console.log(`    missing  ${key}`);
    }
    for (const key of unknown) {
      extra += 1;
      console.log(`    unknown  ${key}${prune ? ' (will be dropped)' : ''}`);
    }

    if (apply) {
      // The collection is created explicitly rather than implicitly by the
      // first `createIndex`. Implicit creation inside a replica set is a
      // distributed operation per index; doing it once, up front, is both
      // faster and easier to diagnose when it fails.
      if (existing.size === 0) {
        await database.createCollection(model.collection.collectionName).catch(() => undefined);
      }
      // Every missing index for a collection goes in one `createIndexes`
      // command. Issuing them one at a time is a separate round trip and a
      // separate catalogue operation each, which on a replica set turns a
      // seconds-long release step into a minutes-long one.
      const specifications = model.schema
        .indexes()
        .filter(([key]) => absent.includes(keyOf(key as Record<string, unknown>)))
        .map(([key, options]) => ({
          key: key as Record<string, 1 | -1 | 'text'>,
          ...(options as Record<string, unknown>),
        }));
      if (specifications.length) await collection.createIndexes(specifications);
      if (prune) {
        for (const key of unknown) {
          const index = existing.get(key);
          if (index) await collection.dropIndex(index.name);
        }
      }
    }
  }

  console.log(
    apply
      ? `Applied. ${missing} index(es) were missing; ${extra} unknown index(es) ${prune ? 'were dropped' : 'were left in place'}.`
      : `Report complete. ${missing} missing, ${extra} unknown. Nothing was changed.`,
  );

  await client.close();
  // A release step should fail the pipeline when indexes are missing, so an
  // operator finds out before the first slow request does.
  process.exit(!apply && missing > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('Index check failed:', (error as Error).message);
  process.exit(1);
});
