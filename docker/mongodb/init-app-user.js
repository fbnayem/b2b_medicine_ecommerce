// Creates the account the application connects with.
//
// Runs once, from docker-entrypoint-initdb.d, while the data directory is still
// empty and the entrypoint's temporary server is up with the root account
// already created. mongosh arrives here connected and authenticated, so this
// script only has to describe the account it wants.
//
// The application is deliberately not root. It needs to read and write its own
// collections, and it needs index management because production runs with
// `autoIndex: false` and builds indexes from scripts/checkIndexes.ts as a
// release step. It does not need to read other databases, administer users, or
// see the oplog. `readWrite` plus `dbAdmin`, scoped to one database, is exactly
// that and nothing more.
//
// The health endpoint calls `admin().ping()`, which MongoDB permits without any
// authorisation at all, so it needs no grant here.

const username = process.env.MONGO_APP_USERNAME;
const password = process.env.MONGO_APP_PASSWORD;
const database = process.env.MONGO_INITDB_DATABASE || 'medsupply_b2b';

if (!username || !password) {
  throw new Error(
    'MONGO_APP_USERNAME and MONGO_APP_PASSWORD must both be set before the database first starts. ' +
      'Creating them later means recreating the volume — see docs/DEPLOYMENT.md.',
  );
}

// The user record lives in `admin` whatever database it has rights over, which
// is why the connection string carries authSource=admin.
const admin = db.getSiblingDB('admin');

const existing = admin.getUser(username);
if (existing) {
  print(`Application user ${username} already exists; leaving it untouched.`);
} else {
  admin.createUser({
    user: username,
    pwd: password,
    roles: [
      { role: 'readWrite', db: database },
      { role: 'dbAdmin', db: database },
    ],
  });
  print(`Created application user ${username} with readWrite+dbAdmin on ${database}.`);
}
