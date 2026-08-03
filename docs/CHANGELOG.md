# Changelog

## Road to production, phases 2-6

Five phases, delivered in one run. The through-line is unchanged from phase 1:
almost everything corrected here was found by running the system, and the things
that were not were found by a guard written during these phases.

### Phase 2 — The verification harness

- The web application had **never been strict-typechecked**. `tsconfig.app.json`
  carried neither `extends` nor `strict`, so the root config's strictness had
  never reached it, while `AGENTS.md` required it and `PHASE_STATUS.md` claimed
  it passed. The existing code already satisfied it — the finding was the absent
  gate, not wrong code.
- CI hand-lists a command per workspace, and for twelve phases nobody added
  `packages/*`, so five packages were checked by nothing. `pipelineWiring.test.ts`
  now reconciles the workflow against the workspace and found all seven gaps
  immediately.
- Route coverage is reconciled against a route table **reflected off the live
  routers**. It found five documented endpoints that do not exist, so a client
  written against the specification would have received 404s. Of 150 routes, the
  gaps are written out endpoint by endpoint — a percentage would have read "88%"
  and named nothing, and the endpoint that mattered was `POST /users`, whose role
  bug survived twelve phases because nothing called it.
- V5 was a **wrong finding** and is recorded as such: `securityRules.test.ts`
  compares the built document's operation count against the source array, so a
  duplicate declaration fails it. The delivery half was worse than described —
  the transition policy table was imported by no service or controller at all,
  so it was documentation the code could contradict silently.
- Registering the coverage middleware revealed that `app.use([])` throws in
  Express 5, which would have stopped the server booting anywhere except under
  test. Found by running the seed.
- The browser suite found three defects on its first run: a wrong password told
  the user **"No refresh token"**; the login form's fields had **no programmatic
  label**; and two greys shipped at 2.47:1 and 3.62:1 against WCAG AA.

### Phase 3 — Design foundation and app shell

- The specified frontend stack had never been installed, while three pages
  including the sign-in screen were written entirely in Tailwind classes that
  resolved to nothing. `index.css` was the Vite starter template, purple accent
  and `#root { width: 1126px }` included, shipped for twelve phases.
- `@medsupply/design-tokens` replaces roughly 141 hex values and **three brand
  greens in simultaneous use**. Its parity test caught two of my own errors: a
  chart series at 2.22:1 on white, and the fact that one chart palette cannot
  serve both surfaces.
- `@medsupply/navigation` holds the permission matrix that was written out three
  times. `App.tsx` went from 208 lines to 68.
- Routes are lazy: one 546 kB chunk became a 472 kB entry plus 47 route chunks.
  `RoleGate` sits outside the lazy boundary, so an unauthorised role never
  fetches the chunk.
- Mobile gained the per-role tab bar `AGENTS.md` has specified since phase 1 and
  the `metro.config.js` it never had — without one the shared packages resolved
  to a `dist` that only npm lifecycle hooks ever build.

### Phase 4 — Closing the dead ends

- **Order cancellation performs the transition `ORDER_STATE_MACHINE.md` has
  promised since phase 4 of the original build.** Nothing anywhere set that
  status; the endpoint stamped a timestamp, announced that the order had been
  cancelled, and dead-ended — so the shop owner saw a confirmation and the
  warehouse picked the order anyway. Cancelling releases the credit reservation
  and the stock allocation in the same transaction.
- Passwords could not be changed at all. `forcePasswordChange` was set, returned
  and rendered as advisory text, and **checked nowhere**, so an administrator's
  temporary password was permanent. The first version of the guard was
  mount-level middleware that **passed every request**, because it ran before
  `requireAuth` set `req.user`; its own test caught that.
- Credit override: two documents disagreed and the code checked nobody's role.
  Settled as an administrator decision.
- All 22 native browser dialogs are gone, including an administrative password
  reset typed in clear text into a `window.prompt`.

### Phase 5 — Language, errors and accessibility

- English and Bangla, with the Bangla catalogue typed against the English one so
  a missing key is a compile error. Numbers stay in Western digits in both,
  because money here is reconciled against printed invoices and both parsers
  accept only `[0-9]`.
- Mobile had **no guard against retrying `/auth/refresh`** and **no request
  timeout**. Both fixed by the shared policy in `@medsupply/api-client`.
- Server error codes reached users verbatim. There is now a catalogue in both
  languages, and `failureReference` surfaces the correlation identifier the
  backend has emitted on every failure since phase 12 and which reached no user.
- All 51 routes shared the title `web`. Titles are per-route, focus moves to
  `<main>` on navigation, and chart series carry dash patterns.

### Phase 6 — Regulatory traceability

- Suppliers, purchase orders and goods receipts. `receiveStock` created
  inventory from nothing, so the system could say where a batch went and never
  where it came from — the half an inspector asks for first. Ordered-versus-
  received variance is recorded rather than silently accepted, and expired stock
  is refused on arrival rather than booked in for FEFO to be trusted to skip.
- `recallService` answers, for any batch, every shop that received it with a
  telephone number, and the supplier, purchase order and receipt it came from.
  Every fact it needs already existed and **nothing had ever asked for them**.
  `invoices.items.batchId` was indexed by nothing, so a recall would have
  scanned every invoice ever issued.
- A prescription-medicine movement return reads `MedicineClassification`, stored
  since the catalogue phase and read by nothing. It compares its own arithmetic
  against the shelf rather than only adding up its own movements.
- Retention archives the audit log to a file with a SHA-256 digest, **reads it
  back and verifies the digest before deleting anything**, and never prunes
  without one.

Batch provenance is nullable on purpose: making it required would have turned
stock physically sitting on the shelf into a validation error. `recallService`
says plainly when a batch predates purchasing, because "we do not know" and
"this arrived before we recorded suppliers" are different answers to an
inspector.

280 tests became 434: 94 API unit, 101 API integration, 122 web, 60 mobile and 57 in a browser.

## Road to production, phase 1 - Production blockers and money correctness

Everything here was found by running the system or auditing it against real
load, not by the 254 tests, the typechecker or the container build, all of
which were green throughout.

- The production database ran with no authentication at all: no `--auth`, no
  credentials, no keyfile. Anything on the Docker network could read and write
  the entire ledger, including every `passwordHash`. It now starts with a root
  account for administration and a separate application account holding
  `readWrite` and `dbAdmin` on one database and nothing else. The replica-set
  keyfile is written inside the container, because a bind-mounted keyfile
  cannot be given `0400 mongodb:mongodb` from a Windows or macOS host and
  mongod exits before logging anything that names the cause.
- Enabling authentication exposed a readiness probe that could not detect its
  absence. A missing credential does not fail at connect - the driver handshake
  needs none - so `readyState` reached 1 and `admin().ping()`, which MongoDB
  answers to anyone, still succeeded. `/health/ready` returned 200 while every
  query failed. It now probes with `listCollections`, which needs the same
  authorisation the application needs, and reports connected-but-unauthorised
  as its own state.
- Credit notes were invisible to the invoice balance. `getInvoiceBalance`
  summed posted payments alone while `receivablesAgeing` also subtracted credit
  notes, so a customer who returned goods was refused their next order by the
  credit check while the ageing report showed them settled. Settlement is now
  derived once, from accounts-receivable movement in the append-only ledger.
  Payment reversals and invoices settled from advance balance are correct as a
  consequence; neither was before.
- The outstanding report issued roughly 17,500 database operations for 500
  shops, and the overdue report ran the whole thing again purely to filter it.
  Both now share one implementation issuing six aggregations regardless of shop
  count, with the overdue filter inside the pipeline and pagination that keeps
  totals global. The manager dashboard no longer launches eight fanned-out
  report functions at once and caches its assembled result for a minute.
- Shop owners could not sign in to the web application: the sign-in handler
  sent them to a path no route declared, so the catch-all returned them to the
  login form with no error shown. An entire role was locked out.
- Nothing redeemed the refresh cookie at start-up, so every reload, new tab or
  browser restart signed the user out mid-order while a live session sat unused
  in the cookie. There was also no sign-out control anywhere in the chrome.
- Ten money formatters became one. Eighteen call sites rendered amounts with no
  thousands separator; others dropped the paisa. Forty-one date call sites never
  passed a time zone and used the device's - invisible on a machine already in
  Dhaka, wrong everywhere else and in CI. `en-BD`, used at most of those sites,
  is not a locale at all and silently resolves to plain `en`.
- Eight `console.*` calls bypassed the redacting logger. The worst was not an
  error path: an unconfigured notification channel printed the whole message
  body, so a deployment that had not yet configured SMS printed every delivery
  OTP in plaintext on the ordinary success path.
- New guards, each demonstrated to fail when the defect it covers is
  reintroduced: `console.*` is permitted only in the logger and in start-up
  validation; every sign-in destination must be a route that exists; the
  receivables reports must stay within a database-operation ceiling; a credit
  note must unblock the customer's next order.

## Phase 12 - Final Security Hardening, Performance and Release Readiness

- Fixed four vulnerabilities carried by earlier phases, each now covered by a test that fails if the fix is reverted: the sign-in response returned the account's bcrypt hash; shop and directory search terms were interpolated into `$regex` unescaped; query parameters were assigned straight into database filters, so `?status[$ne]=` was an injection; and replaying an already-rotated refresh token was answered with an error while the live session kept working.
- Added the security middleware layer: Helmet headers with a self-contained content security policy, a query parser that cannot produce operator objects, recursive body and parameter sanitisation against operator and prototype keys, per-request correlation identifiers, hop-counted proxy trust and tiered request body limits.
- Added tiered rate limiting - sign-in, writes, reports and a global backstop - keyed by user when authenticated, backed by Redis when configured and an identical in-process store otherwise, with standard `RateLimit-*` and `Retry-After` headers.
- Hardened sessions and tokens: access tokens name their session and revocation is enforced on every request and every realtime handshake, refresh tokens are stored as an HMAC with bcrypt still accepted for existing sessions, the refresh cookie is scoped to the auth routes, sessions expire on a TTL index, and sign-in pays the same cost whatever the outcome.
- Added self-service session management for every role: list your own sign-ins, end one, or end them all, on both web and mobile.
- Added structured JSON logging with credential redaction and bounded depth, and an error handler that keeps actionable messages while refusing to leak exception text in production.
- Added an OpenAPI 3.1 document generated from the Zod schemas the server validates with, plus a self-contained API reference served by the API itself.
- Added the indexes the Phase 11 report aggregations needed, a `maxTimeMS` guard on those aggregations, lean list reads, connection pool tuning and response compression, with an integration test that asserts with `explain()` that an index rather than a collection scan serves each report query.
- Added release readiness: split liveness and readiness probes, a version endpoint, an administrator-only runtime status, ordered graceful shutdown with a hard timer, multi-stage non-root Dockerfiles for the API and web, an nginx reference configuration, a production compose file, a GitHub Actions pipeline on Node 20 LTS, and an index verification script that fails a release when an index is missing.
- Moved the web application's API origin out of the source and into a build argument that defaults to a same-origin path.
- Fixed two defects found by running the containers rather than only validating their configuration: the production image did not contain the operational scripts the documented release sequence depends on, and the bootstrap script created the first Super Admin with a password hard-coded in this repository, printed it, and did not force a change.
- Verified the whole deployment on Docker: both images build, the production stack runs with the Redis rate-limit store, the Redis Socket.IO adapter and the BullMQ queue live, and the full integration suite passes against a real MongoDB 6.0 replica set.
- Repaired the operational scripts: every migration ran through a TypeScript loader incompatible with this repository's compiler and could not start. They are now compiled and run with plain `node`, which also surfaced and fixed two latent type errors in the Phase 9 migration.

## Phase 11 - Returns, Reporting and Analytics

- Added the complete customer-return lifecycle: request against an issued invoice, review with per-line approved quantities, collection, warehouse receipt with per-unit disposition, and an immutable credit note posted to the customer ledger.
- Enforced the invoice ceiling across returns, so open requests hold their claim on a line and rejected or cancelled ones release it.
- Added disposition-controlled restocking through the previously unused `returned` stock bucket and five new stock movement types; an expired batch can be received but never restocked.
- Added refund arithmetic that mirrors the invoice in integer minor units — line discount, then a proportional share of the order discount, then tax — with the delivery charge deliberately not refunded.
- Added credit notes with snapshotted identity, a printable PDF and a balanced RETURN_CREDIT ledger posting keyed on the return, so a retried issue cannot double-credit.
- Added order transitions to RETURN_REQUESTED and RETURNED, restoring the interrupted status when a return is rejected or cancelled.
- Added six return notification events, timeline coverage and a `return:updated` realtime event.
- Added sales, sales-by-dimension, order funnel with cycle times, inventory valuation with expiry and dead stock, delivery performance, returns analytics, receivables ageing and a composed analytics overview.
- Added CSV export on every report with a byte order mark and formula-injection neutralisation, downloaded through the authenticated client.
- Added web returns and analytics screens with dependency-free SVG charts each paired with an accessible data table, and mobile returns and analytics workflows.
- Added return-rule, replica-set integration, web component and mobile coverage.

## Phase 10 - System Settings, Configuration and Administration

- Added seven persisted, versioned and audited settings groups covering business identity, finance and credit, inventory, delivery proof, notification defaults, localisation and security policy.
- Added persisted-then-environment-then-default resolution applied per field, with each group reporting where its effective values came from.
- Migrated every business configuration read off environment variables, from invoice tax and identity to credit blocking, OTP lifetime, near-expiry thresholds and the sign-in lockout policy.
- Added per-group optimistic concurrency, group reset to fallback, a policy-free branding endpoint and a `settings:updated` realtime event.
- Added administrative user management with role, status, temporary password reset and session revocation, guarded so an Admin cannot reach privileged accounts, nobody can demote themselves and the last active Super Admin is protected.
- Added sign-in auditing and a read-only, filterable audit log viewer.
- Added web settings, user administration and audit screens, and a read-only mobile settings view for administrators.
- Added a rerunnable migration that seeds only the groups the environment actually configures.

## Phase 9 - Notifications, Real-Time Updates and Activity Timeline

- Replaced ad-hoc notification writes across ordering, approval, fulfilment, delivery, payment and OTP with one templated dispatcher covering a closed catalogue of 26 events.
- Added per-user channel preferences, per-event overrides, muted events and Asia/Dhaka quiet hours; in-app delivery stays mandatory and every suppression is recorded with a reason.
- Added replaceable email, SMS, WhatsApp and Expo push channel adapters, per-channel delivery records, retries with exponential backoff and a sweeper that recovers lost dispatches.
- Added a BullMQ queue that degrades to an identical in-process driver when Redis is absent, plus daily overdue-invoice and near-expiry-stock digests.
- Added a Socket.IO server with token-authenticated handshakes and user, role and shop rooms, and an optional Redis adapter for multi-instance fan-out.
- Added the append-only activity timeline with per-record visibility, order and shop cross-links, and a migration that projects historical audit records into it.
- Added web notification bell, inbox, preferences, activity feed and embedded timelines; delivery views now refresh on realtime signals with polling retained as a fallback.
- Added mobile notification inbox, preferences, Expo push registration with permission handling, deep-link routing, realtime updates and embedded timelines.
- Added notification rule, queue, replica-set integration, web component and mobile flow coverage.

## Phase 8 - Payments, Customer Due and Ledger

- Added pending/posted/failed/reversed Payments, delivery collection verification, proof attachments, cash handover, receipts and exact idempotency/duplicate protection.
- Added immutable balanced Ledger transactions, live Invoice allocation, customer advances, reversals, adjustments, statements, overdue/outstanding/collection reports and reconciliation.
- Invoice packing now posts its charge; credit approvals atomically reserve per-Shop exposure and packing consumes the reservation.
- Added complete internal/Shop Owner web finance workflows and role-based Shop Owner/Manager/Delivery Person mobile finance workflows.
- Added rerunnable legacy-finance scanning/canonicalisation, authenticated request-bound credit-reservation backfill, and expanded financial, integration, web and mobile test coverage.

## Phase 7 - Delivery Assignment and Delivery Application

- Created transactional Delivery records with packages/invoices and human `DEL` references.
- Added assignment/reassignment, workload, custody handover/acknowledgement, pickup, route, arrival, configurable proof, completion, failure and return state actions.
- Added expiring hashed receiver OTP and replaceable local OTP/proof-storage adapters.
- Added web delivery board/details/assignment/handover/failed queue/POD viewer and Shop Owner tracking.
- Added Expo role-based delivery operations with call/map, camera, drawn signature, foreground GPS consent, payment collection capture and offline idempotent retry.
- Added state-policy, API integration, web component and mobile offline-flow tests.

## Phase 6 - Storekeeper Picking, Packing and Invoice Generation

- Added approved, picking, paused, packing, discrepancy, packed, and ready queues.
- Added transactional picking progress, pause/resume, batch confirmation, manager-visible discrepancy blocking and resolution.
- Added packing limits, expired/blocked validation, shortfall reasons, unused-stock release, audit records and notifications.
- Added immutable packed-quantity Invoice and Package entities with configurable supplier/tax/footer snapshots.
- Added A4 and 80 mm thermal print/PDF layouts plus package labels.
- Added responsive web workflows and Expo Storekeeper queue, camera barcode scanning, manual fallback, packing, discrepancy, and ready screens.
- Added unit, replica-set integration, web component, and mobile flow coverage.

## Phase 5 — Manager Review and Approval

- Added manager approval queues and web/mobile review workflows.
- Added transactional full/partial approval, FEFO reservation, picking-list creation, credit/licence gates and optimistic concurrency.
- Added approval notifications, audit history and Docker-backed rollback/concurrency tests.

## Phase 3–4 verification

- Enabled and verified the local MongoDB replica set.
- Added live inventory concurrency and order API integration tests.
- Verified idempotent order replay and cross-shop access denial.

## Phase 4 — Shop Ordering and Cart

- Added stock-neutral carts and server drafts across web and mobile.
- Added order snapshots, estimates, saved-address checkout and idempotent submission.
- Added isolated order history/details, timelines, repeat order and cancellation requests.
- Added in-app order notifications and audit events.

## Phase 3 — Catalogue and Inventory

- Added medicine catalogue, batches, stock states, movements, FEFO allocation, inventory interfaces and operational tests.
