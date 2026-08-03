# Deployment

## Required services

- Node.js 20 or newer for API and web build jobs.
- MongoDB replica set for transactional stock, approval, picking, packing, and invoicing operations.
- Redis for later queue and real-time delivery phases.
- HTTPS reverse proxy or managed ingress.

## Build and release checks

Run package builds, unit tests, web component tests, mobile flow tests, the replica-set integration suite, lint, and the Expo Android export before promotion. Never point integration tests at a production database.

## Runtime configuration

Provide all values documented by `.env.example` through the deployment secret/configuration service. In particular, use a strong `JWT_SECRET`, a production MongoDB replica-set URI, explicit CORS origins, and the invoice identity/tax variables. Secrets must not be committed or embedded into web/mobile bundles.

## Invoice integrity

Issued invoices are rendered from persisted snapshots. Keep database backups and audit records under the organisation's financial retention policy. Do not overwrite an issued invoice; future corrections must create a revision, cancellation, reversal, or adjustment record.

## Health and rollback

Deploy the API before clients when introducing new workflow endpoints. Verify health, MongoDB transaction support, indexes, and one staging fulfilment flow before production traffic. Application rollback is safe only when the deployed database schema remains backward compatible; preserve Invoice, Package, StockMovement, and AuditLog records.

## Delivery deployment

Configure `DELIVERY_REQUIRED_PROOFS` explicitly and deploy approved `OtpDeliveryProvider` and `ProofFileStorage` implementations before production. The database proof adapter is functional locally, but production should use encrypted S3-compatible storage with retention and access logging. Preserve Delivery, ProofFile, Package custody, Notification and AuditLog records during rollback.

Rebuild native mobile binaries after changing camera/location config plugins or permission strings. Validate successful delivery and failure/return/reassignment in staging. A queued mobile completion is not a completed financial result; Phase 8 may post only server-confirmed collection snapshots.

## Phase 8 finance rollout gate

Back up MongoDB, deploy schemas that accept legacy delivery values, run the Phase 8 migration in dry-run mode, resolve unsafe-money/blocker anomalies, then apply canonicalisation. Backfill each reported approved-credit reservation and post legacy opening balances through authenticated Admin actions, then run reconciliation before enabling finance traffic. Never edit a Ledger document to fix history; use an authorised action, adjustment or reversal.

Production must use a MongoDB replica set because Invoice posting, credit reservation, delivery collection, Payment posting and reversal rely on multi-document transactions. Configure HTTPS, private authenticated receipt/proof access, durable encrypted object storage, approved OTP delivery, and monitored backup restoration. Keep delivery verification enabled until operational cash/digital collection controls are approved.

## Phase 9 notification and real-time rollout

Provision Redis before scaling past one API instance. BullMQ gives cross-process job ownership and the Socket.IO Redis adapter gives cross-instance fan-out; without them a second instance would run duplicate scheduled digests and would only reach clients connected to itself. The API logs its queue driver on start-up, so verify it reads `bullmq` in production.

Socket.IO shares the Express HTTP server and port at path `/realtime`. Any reverse proxy or load balancer must forward websocket upgrade headers and, without the Redis adapter, use sticky sessions. Polling remains enabled as a fallback for websocket-hostile networks.

Register real provider webhooks for email, SMS and WhatsApp before enabling those channels in production; the logging adapters are development-only and must not be relied on to reach a customer. Expo push works without credentials, but a development build is required on Android.

Run the Phase 9 migration dry-run against a backup first, resolve any reported uncatalogued notification types, then apply. Deploy the API before the clients: older clients ignore the new socket events, whereas a client emitting to an endpoint that does not exist yet degrades to polling with no notification badge.

Preserve `notifications`, `notificationpreferences`, `notificationdeliveries`, `pushdevices` and `activityevents` during rollback. `activityevents` is append-only; correct a wrong entry by appending a correction, never by editing history.

## Phase 10 settings rollout

Deploy the API before removing any business configuration from the environment. The environment remains the fallback, so an unchanged `.env` produces identical behaviour; nothing has to be migrated before the new release is safe.

Run the Phase 10 migration in dry-run mode against a backup, review which groups it would seed, then apply. Seeding captures the deployment's current environment values as persisted settings so administrators edit real values rather than an empty form. After seeding, changes made in the application take precedence and the corresponding environment variables become inert until that group is reset.

Verify at least one settings change end to end in staging — the settings screen, an invoice issued afterwards carrying the new identity, and the audit record — before enabling administration in production. Confirm that a previously issued invoice still shows its original snapshot; changing business identity must never rewrite an issued document.

Settings are cached in memory with a short TTL. On a multi-instance deployment a change is immediate on the instance that saved it and converges on the others within that TTL. Plan a brief window for any change that must be simultaneous everywhere, or restart the instances.

Keep at least two active Super Admin accounts. The system refuses to demote or deactivate the last one, but that protection is a backstop, not an operating procedure. Preserve `systemsettings` during rollback: reverting the application without it would silently return every group to its environment fallback.

## Phase 11 returns and reporting rollout

Deploy without a migration. The `returns` and `creditnotes` collections start empty and no existing record is rewritten, so the release is safe to roll forward and, if it must be rolled back before any return is raised, safe to roll back.

Once a credit note has been issued, rolling back the application without `creditnotes` would leave a posted `RETURN_CREDIT` in the ledger with no document behind it. Preserve both collections in any rollback plan, exactly as `payments` and `ledgertransactions` are preserved.

Check the reporting aggregations against production-sized data before enabling analytics widely. They read invoices, orders, deliveries, batches and returns directly rather than from a rollup, which keeps the figures honest but means a very wide date range does real work; narrow the default period or add a rollup if a range becomes slow.

Verify one return end to end in staging — request, approve, receive, credit note — and confirm the customer statement shows the credit and the batch shows the restocked units, before enabling returns in production.

## Phase 12 container deployment

`docker-compose.yml` runs the development backing services. `docker-compose.prod.yml` builds and runs the applications themselves, publishes only the web tier, and takes every secret from the environment:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

It requires `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `REDIS_PASSWORD`, `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, `MONGO_APP_USERNAME`, `MONGO_APP_PASSWORD` and `MONGO_KEYFILE`, and fails fast without them. Both images are multi-stage: the API ships only `dist` plus production dependencies, runs as a non-root user under `tini` so SIGTERM reaches the process and the graceful shutdown actually runs, and its healthcheck calls `/health/ready`. The web image builds the bundle and serves it from nginx, which also terminates compression and proxies `/api` and `/realtime` to the API on the same origin — which is what keeps the `SameSite=Strict` refresh cookie working.

`stop_grace_period` is 30 seconds because the default 10 is not enough to drain a long transaction.

## Database authentication

MongoDB runs with `--auth`. Until this was added, the production compose file
started the database with no authentication at all: anything that could reach
the Docker network could read and write the entire ledger, including every
`passwordHash`. Redis was already password-protected in the same file.

Two credentials exist because they do different jobs. **Root** is created on the
first start from `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` and is for
administering the server; the application never uses it. The **application**
account, `MONGO_APP_USERNAME` / `MONGO_APP_PASSWORD`, is created by
`docker/mongodb/init-app-user.js` with `readWrite` and `dbAdmin` on
`medsupply_b2b` and nothing else — enough to serve traffic and to build indexes
during a release, and not enough to read another database or administer users.

`MONGO_KEYFILE` is the shared secret replica-set members use to authenticate to
each other, which MongoDB requires as soon as `--auth` is on. Generate one and
keep it with your other secrets:

```bash
openssl rand -base64 96 | tr -d '\n'
```

**The ordering is the part that bites.** All five variables are read _only while
the data directory is empty_:

1. The keyfile must be present before the first election, because members that
   cannot authenticate to each other never elect a primary and the set never
   comes up.
2. `MONGO_INITDB_ROOT_*` creates the root account only on a fresh volume. On an
   existing volume the entrypoint skips user creation silently.
3. `docker-entrypoint-initdb.d` runs on that same first start, which is when the
   application account is created.

So a database that has already started once will ignore all of it. **Enabling
authentication on an existing deployment is a migration, not a configuration
change**: dump the data, recreate the volume so the first start happens with
these variables set, restore, then confirm. Rotating either password later is
done with `db.changeUserPassword()` against the running server and a matching
update to `MONGODB_URI` — not by editing these variables and restarting.

Confirm authentication is actually on before sending traffic. An anonymous
connection must be refused:

```bash
docker compose -f docker-compose.prod.yml exec mongodb \
  mongosh --quiet --eval 'db.getSiblingDB("medsupply_b2b").shops.countDocuments()'
# MongoServerError: command count requires authentication
```

and the application account must be accepted, and confined:

```bash
docker compose -f docker-compose.prod.yml exec mongodb sh -c \
  'mongosh --quiet -u "$MONGO_APP_USERNAME" -p "$MONGO_APP_PASSWORD" \
     --authenticationDatabase admin \
     --eval "db.getSiblingDB(\"admin\").system.users.countDocuments()"'
# MongoServerError: not authorized on admin to execute command
```

The second check is the one worth keeping: it proves the application is not
quietly running as root.

Note that a _missing_ credential and a _wrong_ one fail differently. A wrong
password fails during the driver handshake, so the API logs
`Could not connect to MongoDB — Authentication failed.` and exits 1. A missing
credential does not: the handshake itself needs no authentication, so the
connection is established, `readyState` reaches 1, and only real queries are
refused. `/health/ready` therefore probes with `listCollections`, which needs
the same authorisation the application needs, rather than `ping`, which MongoDB
answers to anyone. Without that, an unauthenticated deployment would report 200
and every request behind it would fail. Connected-but-unauthorised is reported
as `{"checks":{"database":"unauthorised"}}` with status 503.

## Reverse proxy

Set `TRUST_PROXY_HOPS` to the exact number of proxies in front of the API — 1 for the bundled nginx. Rate limiting and audit records are only as trustworthy as `req.ip`, and a trusted-by-default chain lets any caller forge it. `apps/web/nginx.conf` is the reference configuration and sets the headers for the documents nginx itself serves; the API sets its own.

## Release sequence

1. Check indexes against the target database. This exits non-zero when any are missing, so it is a gate rather than a note:

   ```bash
   docker compose -f docker-compose.prod.yml run --rm api node dist-scripts/scripts/checkIndexes.js
   ```

2. Deploy the API, then apply them before traffic, so the first request after release is not the one that triggers a background index build. In production the application does not build indexes itself (`autoIndex` is off), which is what makes this step load-bearing:

   ```bash
   docker compose -f docker-compose.prod.yml run --rm api node dist-scripts/scripts/checkIndexes.js --apply
   ```

   The migrations ship with the image too, and run the same way — `node dist-scripts/scripts/migratePhase10Settings.js`, and so on.

3. Confirm `/health/ready` returns 200 and `/health/version` reports the commit you expect.
4. Deploy the web bundle. `VITE_API_URL` is compiled in at build time, not read at runtime; the default `/api/v1` is correct when the API is served from the same origin.
5. Confirm one staging flow end to end before production traffic.

## Rollback

Application rollback is safe while the database stays backward compatible. Phase 12 adds no collection and rewrites no document, so rolling back to Phase 11 needs nothing undone: the new indexes are harmless to an older build, and `sessions.revokedReason` and `lastUsedAt` are simply ignored. The one visible effect is that sessions whose refresh hash has rotated to the HMAC format will not verify against a Phase 11 build, so those users sign in again.

## Operational notes

- Logs are structured JSON on stdout with a correlation identifier per request. Ship them as-is; do not reformat into text.
- Without `REDIS_URL`, rate-limit budgets are per instance, the notification queue is in-process and Socket.IO is single-instance. All three are supported single-instance configurations; none of them is correct for a horizontally scaled deployment.
- `/api/v1/admin/runtime` reports what an instance actually resolved — queue driver, realtime driver, rate-limit store, trusted hops, token lifetimes — which is the fastest way to confirm a deployment is configured the way you believe it is.

## First sign-in

A new deployment has no accounts. Create the first Super Admin once, supplying the credential yourself:

```bash
docker compose -f docker-compose.prod.yml run --rm \
  -e BOOTSTRAP_EMAIL=admin@your-domain.example \
  -e BOOTSTRAP_PASSWORD="$(node -e "console.log(require('node:crypto').randomBytes(18).toString('base64url'))")" \
  api node dist-scripts/scripts/bootstrap.js
```

The password is never echoed and a change is forced at first sign-in, because a value passed through an environment variable can survive in a shell history or a process listing. The script is rerunnable and refuses to overwrite an existing Super Admin: every account after the first is created through the application, where the change is attributed and audited.

Note that the refresh cookie is issued with `Secure` in production, so a browser will not send it over plain HTTP. Deploy behind TLS; the stack is otherwise fully functional but sign-in will not survive a page reload.

## Verified deployment

The compose file, both images and the release sequence were run end to end on MongoDB 6.0 and Redis 7: the stack starts healthy, the API reports the Redis rate-limit store, the Redis Socket.IO adapter and the BullMQ queue, nginx serves the application and proxies the API on one origin with compression and security headers, and the index check reports, applies and converges from inside the API image.
