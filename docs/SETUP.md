# Local Development Setup

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker and Docker Compose

Docker Desktop on Windows requires firmware virtualization and the Windows Virtual Machine Platform/WSL2 features. `docker version` must show both Client and Server before starting the stack.

## Quick Start

1. Clone the repository.
2. Run `pnpm install` at the root.
3. Start backing services: `docker compose up -d`
4. Copy `.env.example` to `.env` in the root and in `apps/api`.
5. Run `pnpm dev` to start all applications (API, Web).
6. To run the mobile app, navigate to `apps/mobile` and run `npm start` (or `npx expo start`).

## Phase 6 invoice configuration

Set `BUSINESS_NAME`, `BUSINESS_ADDRESS`, `BUSINESS_PHONE`, `BUSINESS_EMAIL`, `INVOICE_FOOTER`, and `INVOICE_TAX_BASIS_POINTS` in the API environment. Tax basis points are integers: `750` means 7.50%. System Settings will become the persistent source in Phase 10; environment values are the functional deployment adapter until then.

## Tests without Docker

`pnpm --filter @medsupply/api test:integration` starts an isolated one-node MongoDB replica set through `mongodb-memory-server` when `MONGODB_TEST_URI` is absent. Set `MONGODB_TEST_URI` to a dedicated replica-set database to run the same suite against Docker or another MongoDB deployment. The suite always drops its dedicated test database.

## Phase 7 delivery configuration and mobile permissions

Set `DELIVERY_REQUIRED_PROOFS` to a comma-separated subset of `OTP,SIGNATURE,PHOTOGRAPH,GPS`; the default is `OTP`. The local OTP adapter writes the code to assigned Shop Owners' in-app notifications and must be replaced with an approved external channel for production.

The Expo app uses SDK 57-compatible camera, location, AsyncStorage, SVG and view-capture packages. Camera and foreground-location purpose strings are in `apps/mobile/app.json`. Location is requested only from the proof screen after a visible consent notice.

## Phase 8 finance configuration and upgrade

Set `DELIVERY_COLLECTION_REQUIRES_VERIFICATION`, `CUSTOMER_ADVANCE_ENABLED`, `CREDIT_BLOCK_ON_LIMIT_EXCEEDED`, `CREDIT_BLOCK_OVERDUE_THRESHOLD_MINOR`, and `CREDIT_OVERDUE_GRACE_DAYS` from `.env.example`. Monetary thresholds are integer poisha.

For an existing database, first run a non-mutating scan:

`pnpm --filter @medsupply/api migrate:phase8-finance`

Review every blocker/warning. Canonicalise legacy mobile-banking values with the same command plus `--apply`. For each approved credit Order reported without a reservation, an Admin or Super Admin must call `POST /api/v1/finance/credit-reservations/backfill` with the Order ID, a migration reason and a stable idempotency key. Post any reported legacy opening balance through the authorised adjustment API, then run Shop reconciliation. These authenticated repair actions are audited; the migration deliberately does not fabricate an actor or unaudited financial history.

Copy `apps/mobile/.env.example` and set `EXPO_PUBLIC_API_URL` for the emulator/physical device. Only the public API origin belongs in `EXPO_PUBLIC_*`; never put credentials there.

## Phase 9 notifications, real-time updates and activity

Redis is optional for local development. `docker compose up redis` plus `REDIS_URL` (or the existing `REDIS_HOST`/`REDIS_PORT`) enables BullMQ and the Socket.IO Redis adapter. Without Redis the API runs an in-process queue and a single-instance Socket.IO server: notifications are still queued, retried and recorded, but the deployment cannot be scaled horizontally.

Set `CORS_ORIGINS` to the exact web and Expo origins; it governs both REST and the Socket.IO handshake. Leave the `NOTIFICATION_*_WEBHOOK_URL` variables unset in development — each channel then uses a logging adapter that still produces and records the message. `EXPO_PUSH_API_URL` defaults to Expo's public endpoint and needs no credential.

Mobile push requires a development build; Expo Go on Android cannot receive push notifications from SDK 53 onward. Run the app on a physical device, open Notification preferences and use "Enable push on this device"; a simulator reports an honest unsupported state rather than failing.

For an existing database, first run the non-mutating scan:

`pnpm --filter @medsupply/api migrate:phase9-notifications`

It reports notifications missing Phase 9 fields, any `type` value outside the catalogue, and how many audit records are projectable into the timeline. Re-run with `--apply` to backfill `event`/`category`/`priority` on known notification types and project historical audit records into `activityevents`. Both steps are idempotent: the notification backfill only touches records missing `event`, and each audit record maps to one deterministic timeline key, so re-running changes nothing. Notifications whose `type` is not in the catalogue are reported and left untouched rather than guessed into a category.

## Phase 10 system settings and administration

Business policy now lives in System Settings rather than the environment. Everything in the Phase 10 block of `.env.example` is a fallback: once an administrator saves a group in the web application, the persisted values win, and the environment is used again only if that group is reset. Precedence is persisted, then environment, then built-in default, applied per field.

Infrastructure configuration — `MONGODB_URI`, `JWT_SECRET`, `REDIS_*`, `CORS_ORIGINS` and the notification provider webhooks — deliberately stays in the environment and is not editable through the application.

Sign in as a Super Admin or Admin and open **System settings** from the dashboard. Each group shows where its current values come from: saved here, from the environment, or a built-in default. Saving takes effect immediately across the API; there is no restart and no cache to clear.

For an existing database, first run the non-mutating scan:

`pnpm --filter @medsupply/api migrate:phase10-settings`

It reports, per group, whether a document already exists and whether the environment currently configures it. Re-run with `--apply` to seed a persisted document for each group the environment configures, so the administration screen opens showing the values already in force instead of an empty form. Groups left at built-in defaults are deliberately not seeded: they keep tracking the defaults until someone chooses to override them. The migration is idempotent — a group that already has a document is skipped.

**Users and roles** is available to Super Admin, Admin and Manager; Managers see it read-only. **Audit log** is Admin and Super Admin only. On mobile, administrators get a read-only **System settings** screen showing what is in force; editing remains on the web application, which Super Admins and Admins have full access to.

## Phase 11 returns, reporting and analytics

Returns need no configuration. The two new collections are created on first use and no existing document is rewritten, so an upgraded deployment works immediately.

Two existing settings shape the reports. `inventory.lowStockThreshold` decides which medicines appear in the low-stock list, and `finance.creditOverdueGraceDays` shapes the overdue figures the analytics overview reports. Both are edited in system settings; neither needs a restart.

Report periods use the Asia/Dhaka business calendar, matching the ledger, not the `localisation.timezone` display setting. A report and the statement it summarises therefore always agree on which day a transaction belongs to.

To exercise the flow locally: sign in as a shop owner with a delivered invoice, request a return, approve it as a manager, receive and disposition it as a storekeeper, then issue the credit note as a manager and check the customer statement for the `RETURN_CREDIT` line.

## Phase 12 security, performance and release readiness

Nothing new is required to run locally: every Phase 12 variable has a working default. Two are worth setting deliberately before a real deployment.

`JWT_SECRET` must now be at least 32 characters, and production refuses to start with the example value. Generate one with:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

`TRUST_PROXY_HOPS` must match the number of reverse proxies in front of the API - 0 when it is addressed directly, 1 behind a single nginx. Rate limiting and audit records are only as trustworthy as `req.ip`, and setting this too high lets any caller forge their own address.

The web application's API origin now comes from `VITE_API_URL` at build time instead of being hard-coded. The default `/api/v1` is same-origin, which is what a proxied deployment wants and what keeps the `SameSite=Strict` refresh cookie working. Point it at an absolute URL only when the API lives on a different origin, and add that origin to `CORS_ORIGINS`.

**Security centre** is on the dashboard for every role, at `/account/security` on the web and under **Security and sign-ins** on mobile. It lists where the account is signed in and ends any of them; revocation takes effect on the next request. Administrators additionally see the deployment panel: version, database pool, rate-limit tiers, token lifetimes and which drivers the instance actually resolved.

The **API reference** is served by the API itself at `/api/v1/docs`, with the OpenAPI 3.1 document at `/api/v1/docs/openapi.json`. Write it to a file with `pnpm --filter @medsupply/api openapi`.

Before a release, check indexes against the target database:

```bash
pnpm --filter @medsupply/api indexes              # reports; exits non-zero if any are missing
pnpm --filter @medsupply/api indexes -- --apply   # creates them
```

### Running the operational scripts

Every migration and maintenance script is now compiled before it runs:

```bash
pnpm --filter @medsupply/api scripts:build           # once, or let each script do it
pnpm --filter @medsupply/api migrate:phase10-settings
pnpm --filter @medsupply/api indexes
pnpm --filter @medsupply/api openapi
```

They previously ran through `ts-node-dev`, whose pinned `ts-node` predates TypeScript 7 and refuses to start against the compiler this repository uses — so none of them would run at all. Compiling them is the fix, is closer to how they run in a deployment, and means they are type-checked like the rest of the code.

`pnpm --filter @medsupply/api openapi` needs neither a database nor a signing secret: it reads schemas, not settings.

### Creating the first account

There are no accounts in a fresh database. Create the first Super Admin, supplying the credential yourself:

```bash
cd apps/api
BOOTSTRAP_EMAIL=you@example.com \
BOOTSTRAP_PASSWORD='pick-something-long' \
  pnpm bootstrap
```

The password is checked against `security.passwordMinLength` from System Settings, is never printed, and must be changed at first sign-in. Re-running the script is safe: it will not overwrite an existing Super Admin, because every account after the first should be created through the application where the change is attributed and audited.
