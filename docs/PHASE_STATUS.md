# Phase Status

## Phase 0: Product Architecture and Repository Planning

**Status:** COMPLETED

Foundation includes the pnpm/Turborepo monorepo, API/web/mobile shells, shared packages, Docker development services, environment validation, baseline architecture and project documents.

## Phase 1: Authentication, Users and Permissions

**Status:** COMPLETED

Authentication, JWT access and rotating refresh sessions, user roles, API permission middleware, web/mobile login and secure mobile token storage were implemented. Existing Phase 1 limitations remain subject to the final security hardening phase.

## Phase 2: Medicine Shops and Customer Accounts

**Status:** COMPLETED

### Scope and completed work

Shop registration, ownership/manager assignment, Bangladesh phone validation, duplicate prevention, status management, searchable API/web management, Shop Owner record isolation, and mobile shop profile.

### Database and API changes

Added the Shop model and `/api/v1/shops` CRUD, assignment and status endpoints.

### Known limitations

CSV import/export and the activity timeline remain deferred.

## Phase 3: Medicine Catalogue, Batches and Inventory

**Status:** COMPLETED

### Scope

Medicine catalogue, batch receipt, nine-state inventory, immutable movements, controlled transitions, FEFO reservation, role-based web/mobile workflows and stock warnings.

### Completed work

- Shared medicine, batch, quantity, movement and validation contracts.
- Indexed Medicine, MedicineBatch, StockMovement, Counter and AuditLog models.
- Transactional receipt, addition, adjustment, damage, expiry, quarantine, reservation, picking, packing and reversal operations.
- Atomic idempotent FEFO allocation with conditional versioned updates; expired, blocked and quarantined batches are excluded.
- Searchable catalogue and inventory APIs with server-side roles and cost-price redaction.
- Web catalogue/detail/create, inventory metrics, warning views, receipt/actions and movement history.
- Mobile Shop Owner catalogue/details and Storekeeper warning/action workflows.

### Files created

- API medicine/inventory models, inventory service/rules/tests, controller and routes.
- Web MedicineList, MedicineForm, MedicineDetail, InventoryDashboard and inventory styles.
- Mobile medicines, medicine-detail and inventory screens.

### Files modified

Shared types/validation, API server/error handling/package scripts, web routing, mobile routing/dashboard, and project documents.

### Database changes

Added `medicines`, `medicinebatches`, `stockmovements`, `counters`, and `auditlogs` collections with uniqueness, FEFO, search and history indexes.

### API changes

Added `/api/v1/inventory` catalogue, batch, operation, allocation and movement endpoints documented in `docs/API.md`.

### Web changes

Responsive catalogue, medicine creation/detail, inventory dashboard, stock receipt, warnings, actions and movement history with loading, empty, error, retry and success states.

### Mobile changes

Role-linked medicine browsing/detail and inventory views. Storekeepers can submit validated stock additions, damage, expiry and quarantine actions.

### Tests added and results

- Five tests cover validation, expired batches, FEFO eligibility/order/shortfall and negative/committed-stock adjustment rules.
- API build, strict type-check and Node tests: passed.
- Web production build: passed.
- Mobile strict TypeScript check and Android Expo export: passed.
- Repository lint scan: passed with non-blocking warnings inherited from Phase 1–2 code.
- Docker Compose configuration validation: passed.

### Known limitations

- Live MongoDB replica-set testing proves two simultaneous FEFO reservations cannot oversell; one transaction succeeds and the conflicting transaction rolls back without partial allocation.
- Near-expiry defaults to 90 days until Phase 10 persists system settings.
- Product images use validated provider URLs until the managed file-storage module.

### Next phase dependencies

Phase 3 transactional verification is complete. Cart creation does not reserve stock; manager approval in Phase 5 should call the FEFO reservation service.

## Phase 4: Shop Ordering and Cart System

**Status:** COMPLETED

### Scope and completed work

- Stock-neutral web/mobile carts with MOQ/maximum quantity controls and integer-minor-unit estimates.
- Server drafts with create, update, delete, duplicate/reorder and Shop Owner isolation.
- Submission gates for shop status, saved delivery address, valid/non-empty cart and at least one available product.
- Immutable submitted orders with medicine, price, availability, address and contact snapshots.
- Unique idempotency keys prevent duplicate persisted submissions.
- Order history/details, success state, timeline, repeat action and eligible cancellation request.
- In-app notifications for assigned Manager, relevant Admins and Shop Owner through a replaceable provider interface.
- Append-only audit events for draft/submission/duplication/cancellation operations.

### Files created

Order and Notification models; pricing/order/notification services and rule tests; order controller/routes; web cart/checkout/order pages and store; mobile cart/checkout/order screens and store; changelog.

### Database and API changes

Added `orders` and `notifications` collections and `/api/v1/orders` endpoints documented in `docs/API.md`.

### Tests and quality results

- Added five Phase 4 tests for cart calculations, integer discounts, price snapshot isolation, shop restrictions, draft immutability and cancellation eligibility.
- All 10 Phase 3–4 tests passed.
- API, web and mobile strict TypeScript checks passed.
- API and web production builds passed.
- Android Expo export passed.
- Repository lint scan passed with non-blocking warnings, primarily inherited from Phase 1–2.

### Known limitations

- Live API integration testing verifies idempotent repeated submission creates one order and cross-shop order access returns `403`.
- Automated browser/device interaction remains deferred to the consolidated E2E harness; production web and Android bundles compile successfully.
- Mobile server-draft recovery is available through the Orders list, but automatic restoration after process termination awaits persistent non-sensitive app storage.
- External push/email/SMS/WhatsApp delivery remains behind the notification provider boundary until credentials and later notification phases.

### Exact next phase

Execute **Phase 5 — Manager Order Review and Approval**.

## Phase 5: Manager Review and Approval

**Status:** COMPLETED

### Completed backend foundation

- Manager review queues and detailed review context.
- Optimistic start-review, hold and rejection transitions with audit records.
- Full and partial approval validation with editable quantities, prices, discounts and delivery charge.
- Whole-order MongoDB transaction covering FEFO reservation, immutable stock movements, OrderApproval, PickingList and order state/history.
- Credit-limit enforcement, restricted exceptional override, stale-version detection and duplicate-approval constraints.
- Shop Owner approval notification foundation.

### Web and mobile changes

- Web approval dashboard with status queues, detailed shop/credit/licence/stock context, editable quantities and prices, discounts, delivery charges, notes, hold/reject controls and approval history.
- Mobile Manager approval queue and review screen with pull-to-refresh and approve/partial approve/hold/reject actions.

### Tests and quality results

- Docker-backed integration tests verify full approval, one-winner simultaneous approval, stale-version rejection, unique approval/picking records, Storekeeper notification creation, insufficient-stock rollback and unchanged order/stock on failure.
- Existing unit suites verify FEFO, financial calculations, shop restrictions and state rules; all 10 unit tests pass.
- API, web and mobile strict TypeScript checks pass.
- API and web production builds pass; Android Expo export passes.
- Repository lint passes with existing non-blocking warnings.

### Known limitations

- Previous payment-behaviour detail remains limited to available order history because the payment and ledger domains arrive in Phase 8.
- Exceptional credit override is restricted to Admin and Super Admin until granular permission records are introduced.

### Exact next phase

Execute **Phase 6 — Picking, Packing and Invoice Generation**.

## Phase 6: Picking, Packing and Invoice Generation

**Status:** COMPLETED

### Scope

Storekeeper queues, FEFO batch confirmation, picking progress/pause/completion, discrepancies and management resolution, actual-quantity packing, stock release, Package creation, immutable final invoices, print/PDF layouts, web/mobile workflows, and operational tests.

### Completed work

- Added separate approved/waiting, picking, paused, packing, discrepancy, packed, and ready queues.
- Starting picking atomically moves approved allocations from reserved to picking with optimistic concurrency and immutable movements.
- Storekeepers confirm every allocated batch and picked quantity, save progress, pause/resume, and complete picking through controlled actions.
- Seven discrepancy categories block the list, notify management, record audit events, and support reasoned Manager/Admin resolution.
- Packing validates every line exactly once, cannot exceed confirmed/approved quantities, rejects blocked/expired batches, and requires a reason for reductions.
- Actual quantities move to packed; unused allocation returns to available with a `PICKING_RETURN` movement and manager shortfall notification.
- One Invoice and Package are created per order in the same transaction, using actual packed batches and integer minor units.
- Invoice snapshots include supplier/shop/order/address details, item batch/expiry/pricing details, configured tax, balances, terms/dates, signature space, and footer.
- Added authenticated deterministic A4 and 80 mm thermal PDFs, browser print layouts, and package labels.
- Shop Owner invoice JSON/PDF access is isolated to owned shops.

### Files created

- API: Invoice, Package, and expanded PickingList models; fulfilment controller/routes/service; invoice math/PDF services and tests.
- Web: FulfilmentQueue, FulfilmentWork, ReadyQueue, and fulfilment queue component tests.
- Mobile: fulfilment, picking/packing, ready screens; camera barcode support; tested flow-payload helpers.
- Documentation: `docs/DEPLOYMENT.md` and Phase 6 updates across all maintained project documents.

### Files modified

Shared Zod contracts; API app/environment/package scripts; web/mobile routing, dashboard, styles and package manifests; lockfile; README and project documentation.

### Database changes

- Added `invoices` with unique reference/order indexes and immutable issued snapshots.
- Added `packages` with unique reference/order/invoice/barcode indexes and handover state.
- Expanded `pickinglists` with controlled statuses, optimistic version, progress quantities, shortfall records, and discrepancy resolution metadata.
- Added Phase 6 StockMovement, AuditLog and Notification event usage.

### API changes

Added `/api/v1/fulfilment` queue/detail/ready, start/progress/resume, discrepancy/report/resolve, packing, invoice-read and A4/thermal PDF actions. All actions and permissions are documented in `docs/API.md` and `docs/PERMISSIONS.md`.

### Web changes

Responsive Storekeeper and management queues, batch/quantity confirmation, progress actions, discrepancy review/resolution, packing metadata and shortfall inputs, invoice preview, A4/thermal PDF/print actions, package label, ready queue, and loading/empty/error/retry/success states.

### Mobile changes

Role-linked Storekeeper fulfilment and ready queues, picking/pause/resume/completion, native camera barcode scanning with permission handling, manual confirmation fallback, packing, shortfall/discrepancy capture, and feedback states.

### Tests added

- Three invoice/PDF unit tests.
- One five-scenario replica-set integration suite spanning inventory, ordering, approval, picking, packing and invoice permissions/integrity.
- Two web fulfilment queue component tests.
- Three mobile fulfilment flow tests.

### Test results

- API unit/service tests: 13 passed.
- Replica-set integration tests: 5 passed; includes concurrent and transactional rollback assertions.
- Web component tests: 2 passed.
- Mobile flow tests: 3 passed.
- API, web and mobile strict TypeScript checks: passed.
- API compile and web production build: passed.
- Android Expo export with native camera module: passed.
- Repository lint: passed with 21 non-blocking warnings inherited from Phases 1-5.

### Known limitations

- This workstation's Docker Desktop engine cannot start because Windows reports firmware/Virtual Machine Platform virtualization disabled. The identical transaction suite passed against a one-node `mongodb-memory-server` replica set; Docker deployment still requires virtualization to be enabled and `docker version` to show a Server section.
- Batch-specific supplier barcodes are not yet stored. Mobile scanning matches the medicine barcode, while exact allocated batch ID remains the manual fallback.
- Invoice correction/revision and posted-payment adjustment records arrive with later financial phases; issued invoices cannot be silently edited now.

### Next phase dependencies

Package, invoice, ready queue, human references, and handover status are ready for delivery assignment and handoff.

### Exact next phase

Execute **Phase 7 - Delivery Assignment and Delivery Application**.

## Phase 7: Delivery Assignment and Delivery Application

**Status:** COMPLETED

### Scope

Transactional delivery creation, Manager assignment/workload, custody handover and acknowledgement, Delivery Person pickup/tracking, configurable receiver proof, collection capture, failed delivery and return-to-store, web/Shop Owner visibility, role-based Expo operations and offline-safe status retries.

### Completed work

- Packing creates one `DEL-YYYY-NNNNNN` Delivery with package, invoice, shop, address/contact snapshots and `READY_FOR_ASSIGNMENT` inside the existing transaction.
- Added controlled assignment, safe pre-handover/post-return reassignment, workload counts, expected date, priority and instructions.
- Added exact package/invoice/count handover, assigned-person acknowledgement, pickup, route start and arrival actions.
- Added configurable OTP/signature/photo/GPS proof, consent/permission handling, receiver/package/notes data and full/partial terminal coordination.
- Added enumerated failed reasons, required notes, package return custody and Storekeeper receipt before another assignment.
- Added version and stable idempotency enforcement, record-level Delivery Person/Shop Owner permissions, audits and notifications.
- Added pending collection snapshots without falsely posting a financial result before Phase 8.
- Added web delivery board, 15-second live refresh, assignment/workload, detail/handover/failed/POD/invoice views and Shop Owner tracking.
- Added mobile call/map, pickup/delivery/failure/return, native camera, drawn signature, foreground GPS, OTP and visibly unsynchronised safe-action queue.

### Files created

- API: `Delivery`, `ProofFile`, delivery controller/routes, delivery service/policy/OTP/proof-storage services and policy tests.
- Web: DeliveryBoard, DeliveryDetail and delivery-board component tests.
- Mobile: deliveries, delivery-detail and delivery-proof screens; offline queue/core and queue tests.

### Files modified

Shared types/Zod schemas; fulfilment transaction and Package custody model; API app/tests/package scripts; web routing and Order detail; mobile routing/dashboard/config/package manifest; lockfile, environment example, README and maintained project documents.

### Database changes

Added indexed `deliveries` and `prooffiles` collections. Delivery stores workflow/custody/proof/collection/history/version/idempotency data. Package custody now includes returning and returned-to-store states. Delivery, Order, Package, AuditLog, Notification and ProofFile changes share appropriate MongoDB transactions.

### API changes

Added role-filtered delivery list/detail/order/proof/workload reads and assign, handover, acknowledge, pickup, start, arrive, OTP, complete, fail, returning, returned and cancel business-action endpoints under `/api/v1/deliveries`.

### Web changes

Added responsive delivery queues/search/status filters, polling updates, assignment/reassignment and workload, handover/return confirmations, failure detail, timeline, authenticated POD images and invoice PDF. Shop Owners see only their own status/date/timeline/invoice and appropriate receiver proof.

### Mobile changes

Added Delivery Person and operational role navigation, cached assignments, stable safe-action retries, call/map actions, custody and status flow, all failure reasons, camera photograph, drawn PNG signature, informed foreground GPS capture, receiver OTP and collection form. Financial completion always requires immediate server confirmation.

### Tests added

- Two delivery transition-policy unit tests.
- One comprehensive replica-set delivery scenario covering creation, permissions, assignment/reassignment, workload isolation, handover, acknowledgement, pickup, route/arrival, OTP, proof upload, terminal completion, exact replay, failure, return and post-return reassignment.
- Two web delivery-board component tests.
- Two mobile offline-queue tests for stable keys, duplicate suppression and retained retry.

### Test results

- API unit/service tests: 15 passed.
- Replica-set integration tests: 6 passed.
- Web component tests: 4 passed.
- Mobile flow/offline tests: 5 passed.
- Direct strict TypeScript checks for shared types, validation, API, web and mobile: passed.
- API/shared builds and web production build: passed.
- Android Expo export with camera/location/signature/offline modules: passed.
- API/web/mobile lint: passed with 20 non-blocking warnings inherited from Phases 1-6.
- Docker Compose configuration validation: passed.

### Known limitations

- This workstation's Turbo wrapper returns Windows `spawn UNKNOWN` under Node 24, so every underlying typecheck/build/lint was executed directly and passed. Node 20 LTS remains the documented CI/deployment runtime.
- Docker Compose validates, but the local Docker engine still does not return a Server version because Windows virtualization/WSL2 is unavailable. The full suite passed against a real one-node MongoDB memory replica set.
- Local OTP uses in-app notifications and local proof storage uses MongoDB; approved external OTP and encrypted object-storage providers are required for production deployment.
- Web live status uses reliable 15-second polling rather than Socket.IO push.
- Delivery collections remain `PENDING_POSTING` and intentionally do not alter invoices, balances or ledgers until Phase 8.

### Next phase dependencies

Server-confirmed collection snapshots, delivery/invoice/shop links, proof attachments and immutable audit history are ready for Payment and Ledger posting.

### Exact next phase

Execute **Phase 8 - Payments, Customer Due and Ledger**.

## Phase 8: Payments, Customer Due and Ledger

**Status:** COMPLETED

### Scope

Payment capture and verification, append-only balanced customer journals, live Invoice balances, credit reservations and blocking, delivery collections and custody, receipts, statements, finance reports, reconciliation, migration safety, and role-specific web/mobile finance workflows.

### Completed work

- Added `PAY`, `RCT`, and `LED` human references; pending, posted, failed and reversed Payment actions; exact request idempotency; duplicate transaction/delivery constraints; immutable posted records; validated JPEG/PNG/PDF proof; and full reversal journals.
- Added balanced double-entry Invoice charge, Payment, advance, adjustment, return-credit, opening-balance and reversal mappings. Ledger totals are authoritative; Invoice paid/due values and customer statements are derived without mutating issued Invoices.
- Invoice creation posts its charge in the packing transaction. Positive delivery collections create exactly one Payment in the delivery transaction and remain pending when verification is enabled.
- Added full/partial/multiple allocation, explicit advance creation/application, overpayment protection, cash handover, receipts, overdue calculation in Asia/Dhaka, account/Invoice projections, statements and management reports.
- Added atomic per-Shop credit exposure plus one reservation per credit Order. Concurrent approvals cannot exceed the limit; manual/limit/overdue blocks and reasoned Manager override are captured in an immutable decision snapshot. Packing consumes and releases the reservation.
- Added reconciliation reads/authorised repair, plus a rerunnable Phase 8 migration dry-run, legacy `MOBILE_BANKING` canonicalisation and an authenticated, audited credit-reservation backfill action.

### Files created

- API: Payment, PaymentAttachment, LedgerTransaction, CreditReservation and MigrationRun models; payment/ledger/finance/credit services and tests; payment/finance controllers/routes; `scripts/migratePhase8Finance.ts`.
- Web: payment list/record/detail/collection review, ledger, statement, financial reports, Shop Owner account, finance components/types/helpers and tests.
- Mobile: account, invoices, payments/detail, statement, finance dashboard, overdue, collection review and driver collections; typed finance API, money/date/idempotency/navigation/collection helpers and tests.

### Files modified

Shared types/validation; API app/package scripts, Shop/Delivery models, approval/delivery/fulfilment/invoice services and integration tests; web routing/dashboard/shop/delivery/payment styling; mobile routing/dashboard/delivery proof/auth client/configuration; environment example, README and maintained documentation.

### Database changes

Added `payments`, `paymentattachments`, `ledgertransactions`, `creditreservations`, and `migrationruns`. Shop now carries rebuildable `outstandingBalance` and `reservedCreditMinor` compatibility projections. Delivery collection snapshots link to their Payment and reflect posting/failure/reversal state. Unique source/idempotency/reference indexes prevent duplicate financial effects.

### API changes

Added `/api/v1/payments` record/list/detail/post/fail/reverse/handover/receipt/attachment/own-collection APIs and `/api/v1/finance` own/internal summary, Invoice balance, ledger, statement, dashboard, outstanding, overdue, collection, adjustment, reconciliation and credit-reservation backfill APIs. Delivery completion accepts explicit no-payment and payment-proof data and returns its Payment reference/status.

### Web changes

Added operational payment entry/review/detail, authenticated receipt/proof, append-only ledger, printable statement, outstanding/overdue/collection reports, Shop Owner account/invoices/payment history and a real permission-denied screen. Forms parse BDT major units to integer poisha without floating-point conversion.

### Mobile changes

Added Shop Owner due/credit/Invoice/payment/statement views, Manager due/overdue/collection review, Delivery Person daily collection/history/handover, dedicated payment-proof capture and explicit no-payment completion. Financial actions remain online-only. Refresh rotation is serialised/persisted and the API origin is configurable.

### Tests added

- Ten financial/credit rule tests cover allocation, full/partial/multiple amounts, overpayment, advance use, balanced reversal, safe precision, ratios and reservation consumption.
- Two integration scenarios cover concurrent credit reservation/override, Admin-only audited reservation backfill, and payment/delivery collection posting, duplicate requests/references, proof, receipt, reversal permission, record isolation, overdue/statement totals, immutable records and balanced journals.
- Web finance helper/page tests and mobile money/collection/navigation tests cover key loading, failure, role and precision paths.

### Test results

- API unit/service tests: 25 passed.
- MongoDB replica-set integration tests: 8 passed.
- Web tests: 14 passed across 7 files.
- Mobile tests: 14 passed across 5 files.
- Shared/validation/API/web/mobile strict TypeScript checks: passed.
- API and web production builds: passed; Android Expo export passed with 1,414 modules.
- API/web/mobile lint: passed with inherited non-blocking warnings only.
- Docker Compose configuration: valid. Docker Desktop is installed, but its Linux engine currently returns HTTP 500; transactional tests therefore ran against a real one-node `mongodb-memory-server` replica set.

### Known limitations

- Existing deployments must run the Phase 8 dry-run, backfill reported approved-credit reservations with the authenticated Admin action, resolve legacy opening balances with an authorised adjustment, canonicalise legacy mobile-banking values, then run reconciliation. The migration intentionally never fabricates an actor or unaudited journal.
- The supported role set has no Finance role, so Manager/Admin/Super Admin perform finance review; only Admin/Super Admin may reverse or post adjustments.
- Receipts/statements use deterministic local PDF/print rendering. Branded Unicode font embedding and external object storage remain later deployment integrations.

### Next phase dependencies

Posted financial events, delivery/payment references, account balances and audit events are ready to feed notification templates, activity streams and real-time updates.

### Exact next phase

Execute **Phase 9 - Notifications, Real-Time Updates and Activity Timeline**.

## Phase 9: Notifications, Real-Time Updates and Activity Timeline

**Status:** COMPLETED

### Scope

A single templated notification pipeline for every business event, per-user channel preferences with quiet hours, replaceable email/SMS/WhatsApp/push adapters, a durable queue, token-authenticated Socket.IO real-time updates, an append-only permission-filtered activity timeline, web and mobile interfaces, scheduled digests, a rerunnable migration and full test coverage.

### Completed work

- Added a closed catalogue of 26 notification events, each with a category, priority, default channels and a server-side template. Domain services now call `notify()` with an event key and context instead of composing copy inline.
- Preserved every historical `type` string, so notifications written by Phases 4-8 remain readable and are backfilled rather than rewritten.
- Added per-user preferences: optional default channels, per-event overrides, muted events and Asia/Dhaka quiet hours. In-app delivery is never opt-out, and CRITICAL events bypass quiet hours.
- Added one delivery record per recipient, channel and occurrence with status, attempts, provider reference, last error and suppression reason, making the queue observable rather than fire-and-forget.
- Added replaceable channel adapters: one signed-webhook adapter serves email, SMS and WhatsApp with a logging fallback, and a functional Expo push adapter that disables tokens Expo reports as unregistered.
- Added a queue abstraction that uses BullMQ when Redis is configured and an in-process driver with identical attempt limits and exponential backoff when it is not, plus a sweeper that re-queues any PENDING delivery older than a minute.
- Added Socket.IO on the existing HTTP server with a token-authenticated handshake, server-derived user/role/shop rooms, room-targeted emits only, and an optional Redis adapter for multi-instance fan-out.
- Added the append-only `ActivityEvent` stream with explicit `visibleToRoles`/`visibleToShop`, denormalised order and shop cross-links, and dedupe keys that make retries and backfills idempotent.
- Wired notifications, activity and realtime into order submission and cancellation, every approval transition, approval and picking-ready fan-out, picking discrepancy report and resolution, packing shortfall, invoice issuance, all delivery transitions, delivery OTP, payment recorded/posted/failed/reversed and credit-blocked approvals.
- Added daily overdue-invoice and near-expiry-stock digests keyed by the Dhaka calendar date so a rerun on the same day is a no-op.
- Added a rerunnable Phase 9 migration with a non-mutating scan, notification field backfill and audit-to-timeline projection.

### Files created

- API: `NotificationPreference`, `NotificationDelivery`, `PushDevice` and `ActivityEvent` models; `notificationCatalogue`, `notificationRules`, `notificationChannels`, `notificationAudience`, `notificationSchedules`, `activityService`, `jobQueue` and `realtime` services; notification and activity controllers/routes; `scripts/migratePhase9Notifications.ts`; `notificationRules.test.ts` and `notificationIntegration.test.ts`.
- Web: `realtime/socket.ts`, `realtime/useRealtime.ts`, `store/useNotifications.ts`, `components/NotificationBell.tsx`, `components/ActivityTimeline.tsx`, `pages/Notifications.tsx`, `pages/NotificationPreferences.tsx`, `pages/ActivityFeed.tsx` and their tests.
- Mobile: `notifications/push.ts`, `notifications/realtime.ts`, `notifications/api.ts`, `notifications/ActivityTimelineView.tsx`, the notifications and notification-preferences screens, and `push.test.ts` / `api.test.ts`.

### Files modified

Shared types and Zod schemas; the `Notification` and `User` models; order, approval and fulfilment controllers; fulfilment, delivery, delivery-OTP and payment services; API app, server bootstrap and package scripts; web routing, protected layout, dashboard, order/delivery views and styles; mobile protected layout, dashboard, order/delivery detail and `app.json`; `.env.example`; lockfile; README and all maintained documents.

### Database changes

Added `notificationpreferences`, `notificationdeliveries`, `pushdevices` and `activityevents`. Expanded `notifications` with `event`, `category`, `priority`, `link`, `metadata`, `archivedAt`, `correlationId` and a unique sparse `dedupeKey`. Added an optional `phone` field to `users`. Indexes cover recipient/date, recipient/read-state, recipient/category, entity history, delivery status sweeps and activity lookups by entity, order, shop, category and time.

### API changes

Added `/api/v1/notifications` list, unread-count, catalogue, preferences, read, read-all, archive, device registration, delivery-inspection and test-send endpoints, and `/api/v1/activity` feed and timeline endpoints. Added the Socket.IO endpoint at path `/realtime`.

### Web changes

Added a notification bell with live unread badge and dropdown, a filterable inbox with mark-read/mark-all/archive, a preferences screen covering quiet hours and per-event channels, an organisation activity feed and embedded timelines on order and delivery details. Delivery board and detail views now refresh on realtime signals with polling retained as a fallback. All new views carry loading, empty, error, retry and success states.

### Mobile changes

Added a notification inbox with pull-to-refresh and unread filtering, a preferences screen with per-event channel chips and quiet-hours control, Expo push registration with permission handling and honest simulator/declined states, tap-through deep linking, a dashboard unread badge, realtime refresh on delivery detail and embedded activity timelines. Sign-out unregisters the device token and closes the socket.

### Tests added

- 7 notification rule and queue unit tests covering template completeness, money rendering, quiet hours, channel resolution, dedupe keys, retry backoff and job deduplication.
- 11 replica-set integration tests covering delivery-row creation, replay idempotency, muting, inbox isolation, unread counts, cross-user mark-read, preference effects, push token migration and validation, activity visibility, activity dedupe, sweeper recovery and admin-only test-send.
- 10 web component tests across the bell, inbox, preferences and timeline.
- 13 mobile tests across push registration, sign-out, deep-link routing, preference resolution and realtime origin derivation.

### Test results

- API unit tests: 35 passed, up from 25.
- MongoDB replica-set integration tests: 19 passed, up from 8.
- Web tests: 24 passed across 9 files, up from 14 across 7.
- Mobile tests: 27 passed across 7 files, up from 14 across 5.
- Strict TypeScript checks for shared types, validation, API, web and mobile: passed.
- API compile and web production build: passed.
- Android Expo export with notification and socket modules: passed.
- API, web and mobile lint: passed with inherited non-blocking warnings only; no new warnings.
- Docker Compose configuration: valid.

### Known limitations

- Two defects were found and fixed by the new integration tests during this phase: duplicated timestamps in the notification and delivery bulk upserts conflicted with the automatic Mongoose timestamp handling, and a readonly test payload broke the notify contract. Both paths are now covered by tests.
- Docker Desktop's Linux engine remains unavailable on this workstation, so transactional tests ran against a real one-node `mongodb-memory-server` replica set. The Compose configuration validates.
- Redis was not available locally, so the BullMQ and Socket.IO Redis-adapter paths are covered by type checking and code review rather than a live run. The in-process queue driver is covered by tests, and both drivers share one retry policy.
- Expo push was verified through the adapter contract and mocked provider responses. A physical device and a development build are still required to confirm end-to-end delivery, because Expo Go on Android cannot receive push notifications.
- Email, SMS and WhatsApp share one signed-webhook adapter with a logging fallback. Vendor-specific templating, delivery receipts and opt-out handling arrive with real provider credentials.
- Quiet-hours start and end times are editable on the web only; the mobile screen shows the configured window and toggles it on or off.
- Notification retention and archival pruning are not yet scheduled, so the inbox grows until a retention policy is defined.

### Next phase dependencies

The notification catalogue, per-user preferences, channel adapters, activity stream and realtime rooms are ready to be driven by persisted System Settings, including business identity, near-expiry thresholds, tax configuration and per-tenant notification defaults.

### Exact next phase

Execute **Phase 10 - System Settings, Configuration and Administration**.

## Phase 10: System Settings, Configuration and Administration

**Status:** COMPLETED

### Scope

Persisted system settings replacing environment-only business configuration, a resolution layer with explicit precedence and provenance, administrative user management with guard rails, a read-only audit viewer, sign-in auditing, web and mobile interfaces, a rerunnable seed migration and full test coverage.

### Completed work

- Added seven settings groups — business identity, finance and credit, inventory thresholds, delivery proof, notification defaults, localisation and security policy — each stored as its own versioned, audited document.
- Added a resolution layer with persisted, then environment, then built-in default precedence, applied per field. Every group reports which of the three its effective values came from, so an administrator can see why a field looks the way it does before changing it.
- Migrated every business configuration read off `process.env`: invoice tax and supplier identity, invoice footer, receipt and statement identity, delivery proof requirements, receiver OTP lifetime, credit limit and overdue blocking, overdue grace, customer advances, delivery-collection verification, near-expiry and low-stock thresholds, and the sign-in lockout policy. Infrastructure configuration deliberately stayed in the environment.
- Added per-group optimistic concurrency, so a save composed against a stale read is refused instead of overwriting a concurrent change, and the first writer of a group wins the unique-index race.
- Added group reset, which removes the persisted override so the group falls back to the environment and then to the built-in default, keeping the discarded values in the audit record.
- Added a policy-free branding endpoint for every signed-in role, plus a `settings:updated` realtime event so clients holding branding or formatting values refetch.
- Added administrative user management: paged and searchable directory, profile and phone edits, role and status changes, temporary password reset and session revocation.
- Added guard rails enforced in the service: an Admin may not administer or create privileged accounts, nobody may change their own role or deactivate themselves, and the last active Super Admin cannot be demoted or deactivated. A role change or non-active status revokes that user's sessions in the same operation.
- Added sign-in auditing — succeeded, failed, locked and blocked — with the lockout threshold and duration read from settings, and no submitted password ever written to the log.
- Added a read-only, filterable audit viewer with a distinct-actions endpoint. The audit log has no write, edit or delete endpoint in the application.
- Added a rerunnable Phase 10 migration that scans each group and seeds only those the environment actually configures.

### Files created

- API: `SystemSetting` model; `settingsDefaults`, `settingsService` and `userAdminService`; settings and admin controllers and routes; `scripts/migratePhase10Settings.ts`; `settingsRules.test.ts` and `settingsIntegration.test.ts`.
- Web: `pages/SystemSettings.tsx`, `pages/UserAdministration.tsx`, `pages/AuditLogViewer.tsx` and `pages/Administration.test.tsx`.
- Mobile: `src/settings/api.ts`, `src/settings/api.test.ts` and the read-only system-settings screen.

### Files modified

Shared types and Zod schemas; the `User` model; auth, user, inventory, finance and payment controllers; delivery, delivery-OTP, fulfilment, payment, finance and notification-schedule services; the notification catalogue OTP template; API app, package scripts; web routing, dashboard and styles; mobile protected layout and dashboard; `.env.example`; README and all maintained documents.

### Database changes

Added `systemsettings`, one document per group with a unique immutable `group`, a mixed `values` object, an optimistic-concurrency `version` and the administrator who last saved it. Added an optional `phone` to `users`. Persisted values are merged field-wise over the fallback, so a document written before a schema change never hides a newly added field.

### API changes

Added `GET /settings/branding`, `GET /settings`, `PUT /settings/:group` and `POST /settings/:group/reset`. Added `/admin/users` list, detail, patch, password reset and session revocation, plus `/admin/audit` and `/admin/audit/actions`. Added the `settings:updated` realtime event.

### Web changes

Added a grouped settings administration screen showing effective values, provenance, per-group versions and a reset offered only where an override exists; a user administration screen with role, status, password reset and session controls that renders read-only for Managers; and an audit log viewer with action, entity and date filters and expandable recorded detail. All new views carry loading, empty, error, retry, success and permission-denied states.

### Mobile changes

Added a read-only system settings screen for Super Admins and Admins showing every group with its provenance, reachable from the dashboard and guarded in the protected layout. Editing remains on the web application, which those roles have full access to.

### Tests added

- 9 unit tests covering resolution precedence, unusable environment values, group source reporting, schema rejection of values that would corrupt downstream arithmetic, time-zone and locale validation, and the administrative guard rails that reject before any database read.
- 15 replica-set integration tests covering provenance and versions, saving, stale-version rejection, invalid input, settings changing domain behaviour without a restart, reset, role-scoped access, the Admin and Super Admin tiers, the last-Super-Admin protection, session revocation on role change, password reset, the configured password minimum, sign-in auditing and lockout, audit filtering and access, and directory search safety.
- 10 web component tests and 5 mobile helper tests.

### Test results

- API unit tests: 44 passed, up from 35.
- MongoDB replica-set integration tests: 34 passed, up from 19.
- Web tests: 34 passed across 10 files, up from 24 across 9.
- Mobile tests: 32 passed across 8 files, up from 27 across 7.
- Strict TypeScript checks for shared types, validation, API, web and mobile: passed.
- API compile and web production build: passed.
- Android Expo export: passed.
- API, web and mobile lint: passed with inherited non-blocking warnings only; no new warnings.

### Known limitations

- The web settings screen caught a real defect during this phase: the reload that follows a stale-save conflict cleared the explanation before the administrator could read it. Reload now runs before the message is set, and the behaviour is covered by a test.
- Settings are cached with a 30-second TTL, so on a multi-instance deployment a change is immediate on the saving instance and converges on the others within that window. A change that must be simultaneous everywhere needs a brief window or a restart.
- Finance day boundaries remain fixed to Asia/Dhaka. The localisation time zone drives notification quiet hours and digest boundaries only, because moving the finance calendar would change which period a posted transaction belongs to.
- The locale setting accepts Bangla so no migration is needed later, but the interface string catalogue is not yet extracted, so the interface remains English.
- Mobile settings are read-only by design; there is no mobile editing surface.
- The logo is a validated URL rather than an uploaded asset; managed file storage remains a later integration.
- Settings history is available through the audit log rather than a dedicated version browser with one-click rollback.

### Next phase dependencies

Persisted settings, the branding endpoint, administrative user management and the audit viewer are in place for reporting, analytics and any tenant-specific configuration that later phases introduce.

### Exact next phase

Execute **Phase 11 - Returns, Reporting and Analytics**.

## Phase 11: Returns, Reporting and Analytics

**Status:** COMPLETED

### Scope

A complete customer-return lifecycle from request through review, collection, warehouse receipt and inspection to an immutable credit note posted to the ledger, with disposition-controlled restocking, plus a read-only reporting and analytics layer covering sales, orders, inventory, delivery, returns and receivables ageing, with CSV export, across web and mobile.

### Completed work

- Added the `Return` record: one request per issued invoice, line-level quantities from invoiced ceiling through requested, approved and received, four disposition buckets per line, a full status history, optimistic concurrency and per-action idempotency keys.
- Added the whole return policy — action, permitted source statuses, roles, required data, side effects and audit event — as one executable table, so the route guard and the service cannot drift apart.
- Added transactional lifecycle actions: request, start review, decide, reject, cancel, collect, receive and inspect, and issue credit note. Each runs in a single transaction covering the return, the stock, the order status, the ledger, the audit record, the notification and the timeline entry.
- Enforced the invoice ceiling across returns: open requests hold their claim on an invoice line and rejected or cancelled ones release it, so two requests can never together return more than was sold.
- Added disposition-controlled restocking. A receipt books goods into the `returned` bucket; the inspection moves each unit out to available, damaged, expired or quarantined. Nothing returned is allocatable before somebody has looked at it, and an expired batch can be received but never restocked.
- Added refund arithmetic that follows the invoice's own order — line discount prorated, then a proportional share of the order discount, then tax on what remains — in integer minor units throughout, with the delivery charge deliberately not refunded.
- Added the immutable `CreditNote`, one per return, with supplier and customer identity snapshotted at issue time, a printable PDF, and a balanced `RETURN_CREDIT` ledger posting keyed on the return so a retried issue cannot double-credit.
- Added six notification events, activity timeline coverage and a `return:updated` realtime event.
- Added order transitions to `RETURN_REQUESTED` and `RETURNED`, with the interrupted status recorded so a rejection or cancellation restores it.
- Added the reporting layer: sales summary and time series, sales by medicine, category, manufacturer, customer or territory, the order funnel with conversion and cycle times, inventory valuation with expiry buckets, low stock and dead stock, delivery performance by person with punctuality and failure reasons, returns analytics with return rate and recovery, receivables ageing, stock movement summary, and a composed analytics overview.
- Added CSV export on every report with a UTF-8 byte order mark and formula-injection neutralisation, downloaded through the authenticated client.
- Added web returns list, request, detail with role-specific review, receipt and credit actions, an analytics dashboard and five detailed report screens with dependency-free SVG charts that are each paired with an accessible data table.
- Added mobile returns list opening on each role's own queue, a return detail with role-appropriate actions and a local disposition guard, and a business analytics summary.

### Files created

- API: `Return` and `CreditNote` models; `returnRules`, `returnService`, `reportService`, `reportPeriod` and `csv` services; return and report controllers and routes; `returnRules.test.ts` and `returnsIntegration.test.ts`.
- Web: `components/Chart.tsx`, `pages/ReturnList.tsx`, `pages/ReturnRequest.tsx`, `pages/ReturnDetail.tsx`, `pages/AnalyticsDashboard.tsx`, `pages/AnalyticsReports.tsx`, `pages/reportRange.tsx` and `pages/Returns.test.tsx`.
- Mobile: `src/returns/api.ts`, `src/returns/api.test.ts`, and the returns, return-detail and analytics screens.

### Files modified

Shared types and Zod schemas; `inventoryService`, `ledgerService`, `activityService` and the notification catalogue; the API app and package scripts; web routing, dashboard, activity timeline and styles; mobile protected layout and dashboard; and every maintained document.

### Database changes

Added `returns` and `creditnotes`. `medicinebatches.quantities.returned` becomes live, and `stockmovements` gains five return movement types. No migration is required: both collections start empty, `quantities.returned` was already present and zero on every batch, and no existing document is rewritten.

### API changes

Added `/returns` list, create, detail, review, decision, reject, cancel, collect, receive and credit-note, plus `/returns/credit-notes/:id` with a PDF format. Added `/reports/overview`, `/reports/sales`, `/reports/sales/breakdown`, `/reports/orders`, `/reports/inventory`, `/reports/deliveries`, `/reports/returns`, `/reports/receivables-ageing` and `/reports/stock-movements`, each with an optional CSV format. Added the `return:updated` realtime event.

### Web changes

Added a returns list that adapts to the viewer's role, a shop owner request form bounded by the invoice, and a detail screen whose review, receipt, collection, credit and cancellation controls appear only where the viewer's role and the record's state permit them. Added an analytics dashboard and sales, inventory, delivery, returns and receivables report screens with charts, CSV export and a date-range control. Every new view carries loading, empty, error, retry, success and permission-denied states, and every chart is paired with the same figures as a data table.

### Mobile changes

Added a returns list that opens on the queue the viewer's role actually works, a return detail with role-appropriate actions and a local disposition guard that catches an over-receipt or an expired-batch restock before the round trip, and a business analytics summary for management. Partial approval remains a web task.

### Tests added

- 17 unit tests covering the transition table, the role and state gates, the derived approve/partial/reject outcome, invoice-quantity claims, the disposition guards, and every money path including the cumulative credit ceiling.
- 14 replica-set integration tests covering the full lifecycle, partial receipt, the expired-batch refusal, the invoice ceiling across several returns, cancellation releasing a claim, cross-shop isolation, role separation, idempotent replay of both a receipt and a credit issue, stale-version rejection, audit coverage, report figures, CSV safety and shop-owner report narrowing.
- 6 web component tests and 12 mobile helper tests.

### Test results

- API unit tests: 61 passed, up from 44.
- MongoDB replica-set integration tests: 48 passed, up from 34.
- Web tests: 43 passed across 11 files, up from 34 across 10.
- Mobile tests: 44 passed across 9 files, up from 32 across 8.
- Strict TypeScript checks for shared types, validation, API, web and mobile: passed.
- API compile and web production build: passed.
- Android Expo export: passed.
- API, web and mobile lint: passed with inherited non-blocking warnings only; no new warnings.

### Known limitations

- Two defects were found by these tests and fixed. A stale action reported only that the transition was invalid, so the web client never reloaded and the reviewer was left looking at stale data; the version is now checked ahead of the transition. The activity timeline threw on an unexpected payload shape, blanking the record it was embedded in; it now degrades to an empty timeline.
- Reports are recomputed from source records on every request rather than maintained as rollups. This keeps them incapable of drifting from the ledger, but a very wide date range does real work; narrow the default period or add a rollup if a range becomes slow.
- Returned value is attributed by dimension only for medicine and customer, where the return record carries the key. Category, manufacturer and territory report sales without a returned column rather than inferring one.
- The returns pickup is recorded as a single action rather than being modelled as a reverse delivery with its own assignment, route and proof.
- A credit note settles against the customer balance. Refunding cash out, rather than crediting the account, is not implemented.
- Partial approval and per-line disposition splitting are web-only; mobile approves in full and rejects.
- Reports are exported as CSV and the credit note as PDF; there is no scheduled or emailed report delivery.

### Next phase dependencies

Returns, credit notes, the reporting aggregations and the CSV layer are in place for any later phase that needs supplier returns, stock write-off workflows, scheduled reporting or a data warehouse feed.

### Exact next phase

Execute **Phase 12 - Final Security Hardening, Performance and Release Readiness**.

## Phase 12: Final Security Hardening, Performance and Release Readiness

**Status:** COMPLETED

### Scope

A security audit of everything built in Phases 0-11 and the fixes it produced, a request pipeline that enforces protection centrally rather than per controller, tiered rate limiting, session and token hardening with self-service session management on web and mobile, structured redacted logging, a generated OpenAPI specification with a self-hosted reference, the indexes and query guards the reporting layer needed, and the deployment artefacts required to release: probes, graceful shutdown, container images, a reverse-proxy configuration, a production compose file and a CI pipeline.

### Vulnerabilities found and fixed

- **Password hash disclosure.** `login` loaded the whole user document to compare the password and returned it to the caller, so every successful sign-in handed back the account's bcrypt hash. The `User` model now strips `passwordHash`, `loginAttempts` and `lockoutUntil` at serialisation.
- **Regular-expression injection.** Shop search interpolated the caller's term straight into `$regex`, letting them change what the filter matched or submit a pattern far more expensive to evaluate than to send. Terms are escaped and length-capped.
- **NoSQL injection through the query string.** Several list endpoints assigned `req.query.x` directly into a filter, and the default Express parser turns `?status[$ne]=DRAFT` into an operator object. The parser is replaced, bodies and route parameters are stripped of `$`-prefixed and dotted keys, and the affected controllers coerce each value to the type they compare it as.
- **Reuse detection missed the case it exists for.** Replaying an already-rotated refresh token returned an error and left the live session running; only an already-revoked session triggered detection. A valid signature that does not match the stored hash is now treated as theft, revoking every session for that user and writing an audit record.

### Completed work

- Added `securityHeaders`, `requestContext`, `sanitiseRequest`, `rateLimit` and a hardened error handler, wired in a documented order in `app.ts`, with hop-counted proxy trust and body limits tiered so base64 uploads are not paid for by every endpoint.
- Added four rate-limit tiers over one window, keyed by user when authenticated and by address otherwise, backed by Redis when configured and by an identical in-process store when not.
- Added `tokenService`: typed access and refresh tokens, an optional dedicated refresh secret, HMAC session hashing with transparent bcrypt fallback, and a refresh cookie scoped to `/api/v1/auth`.
- Enforced session revocation on every authenticated request and on the Socket.IO handshake, so signing a device out stops it immediately rather than at the end of the access token's lifetime.
- Added `GET /auth/sessions`, `DELETE /auth/sessions/:id` and a reporting `logout-all`, plus the web Security centre and the mobile Security screen that use them.
- Added structured JSON logging with an async-local request context, credential redaction and bounded depth, breadth and string length.
- Added an OpenAPI 3.1 document generated from the Zod schemas, served with a self-contained reference page and writable to a file for review or client generation.
- Added the indexes the Phase 11 aggregations needed across invoices, orders, deliveries, returns, stock movements, audit logs and users, plus a `pre('aggregate')` `maxTimeMS` guard, lean list reads and connection pool tuning.
- Added split liveness and readiness probes, a version endpoint, an administrator-only runtime status, ordered graceful shutdown with a hard timer, and handlers that retire an instance on an unhandled rejection or uncaught exception.
- Added multi-stage non-root Dockerfiles for the API and web, an nginx configuration that proxies the API and realtime on the same origin, `docker-compose.prod.yml`, `.dockerignore`, a GitHub Actions pipeline on Node 20 LTS and `scripts/checkIndexes.ts`.
- Repaired the operational scripts. Every migration ran through `ts-node-dev`, whose pinned `ts-node` predates TypeScript 7 and fails to start against the compiler this repository uses, so all three Phase 8-10 migrations and the bootstrap script were unrunnable. They are now compiled by `tsconfig.scripts.json` and executed with plain `node`, which is both the fix and closer to how they run in a deployment. Type-checking them for the first time surfaced two latent errors in the Phase 9 migration, where `actorRole` and `visibleToRoles` were typed as strings against a model that constrains them to the role enum; an unrecognised historical role is now written as absent rather than as an invalid value.

### Files created

- API: `tsconfig.scripts.json`; `middlewares/securityHeaders.ts`, `middlewares/rateLimit.ts`, `middlewares/requestContext.ts`; `services/logger.ts`, `services/requestSanitiser.ts`, `services/rateLimitStore.ts`, `services/tokenService.ts`, `services/openapi.ts`; `controllers/healthController.ts`; `routes/docsRoutes.ts`; `models/queryGuards.ts`; `scripts/checkIndexes.ts`, `scripts/writeOpenApi.ts`; `securityRules.test.ts`, `hardeningIntegration.test.ts`; `Dockerfile`.
- Web: `pages/SecurityCentre.tsx`, `pages/SecurityCentre.test.tsx`, `Dockerfile`, `nginx.conf`.
- Mobile: `src/security/api.ts`, `src/security/api.test.ts`, `app/(protected)/security.tsx`.
- Repository: `docker-compose.prod.yml`, `.dockerignore`, `.github/workflows/ci.yml`.

### Files modified

API `app.ts`, `server.ts`, `env.ts`, `db.ts`, `scripts/migratePhase9Notifications.ts`, `middlewares/auth.ts`, `middlewares/role.ts`, `middlewares/error.ts`; the auth, shop, order, inventory, finance and return controllers; the `User`, `Session`, `Invoice`, `Order`, `Delivery`, `Return`, `StockMovement`, `AuditLog`, `Payment`, `LedgerTransaction` and `MedicineBatch` models; `services/realtime.ts`, `services/testEnv.ts`; `routes/authRoutes.ts`, `routes/adminRoutes.ts`; API `package.json`. Web `api/client.ts`, `realtime/socket.ts`, `App.tsx`, `pages/Dashboard.tsx`. Mobile `app/(protected)/_layout.tsx`, `app/(protected)/dashboard.tsx`. `.env.example`, lockfile, README and every maintained document.

### Database changes

No new collection and no migration. `sessions` gains `revokedReason` and `lastUsedAt`, an index on `{ userId, createdAt }` and a TTL index on `expiresAt` with a one-day grace period so reuse detection can still recognise a replayed token. `refreshTokenHash` holds an HMAC for sessions created or rotated from this phase onwards; earlier bcrypt values keep working. Report-supporting indexes were added to invoices, orders, deliveries, returns, stock movements, audit logs and users. Nothing already stored is rewritten.

### API changes

Added `GET /health/ready`, `GET /health/version`, `GET /api/v1/docs`, `GET /api/v1/docs/openapi.json`, `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:id` and `GET /api/v1/admin/runtime`. `POST /auth/logout-all` now reports how many sessions it closed. Every failure response carries `error.correlationId`; `x-request-id` is returned on every response and honoured when well formed. New failure codes: `RATE_LIMITED` (429), `PAYLOAD_TOO_LARGE` (413), `MALFORMED_JSON` (400), `TOKEN_REUSE_DETECTED` (401) and a JSON `NOT_FOUND` for unknown routes.

### Web changes

Added the Security centre at `/account/security`, reachable from the dashboard by every role: where the account is signed in, with the current device marked, a confirmation before ending one, and "sign out everywhere" when more than one session is live. Administrators additionally see a read-only deployment panel - version, database pool, rate-limit tiers, token lifetimes, trusted hops and the drivers the instance resolved - which contains no secret and whose failure leaves the session list working. The API origin moved from a hard-coded `localhost:5000` to a build argument defaulting to a same-origin path, the realtime origin is derived from it, and refresh is now single-flight so a dashboard's concurrent 401s cannot trigger reuse detection.

### Mobile changes

Added the Security screen, reachable from the dashboard by every role, listing each sign-in with the device named in words, a confirmation before ending one, pull-to-refresh, and wording that distinguishes a session ended for safety from an ordinary sign-out. Transport and policy live in `src/security/api.ts`; the screen stays presentational.

### Tests added

- 19 unit tests in `securityRules.test.ts` covering sanitisation, the query parser, regex escaping, rate-limit windows and tier isolation, log redaction, token typing and session hashing including the bcrypt fallback, and the OpenAPI document.
- 23 replica-set integration tests in `hardeningIntegration.test.ts` covering credential disclosure, cookie attributes, reuse detection, immediate revocation, cross-user session isolation, sign-in indistinguishability, query and body injection, search escaping, page caps, security headers, correlation identifiers, the 404/413/400 envelopes, rate limiting, the specification and reference page, index coverage proved with `explain()`, the aggregation time limit, the probes and the runtime status.
- 7 web component tests and 7 mobile helper tests.

### Test results

- API unit tests: 80 passed, up from 61.
- MongoDB replica-set integration tests: 71 passed, up from 48.
- Web tests: 51 passed across 12 files, up from 43 across 11.
- Mobile tests: 51 passed across 10 files, up from 44 across 9.
- Strict TypeScript checks for shared types, validation, API, web and mobile: passed.
- API compile and web production build: passed.
- Android Expo export: passed.
- API, web and mobile lint: passed with inherited non-blocking warnings only; no new warnings.
- Docker Compose configuration, development and production: valid.
- Container verification, once Docker became available on this workstation: both images build; the production stack starts with MongoDB and Redis healthy; the API comes up in production mode reporting the Redis rate-limit store, the Redis Socket.IO adapter and the BullMQ queue — the three shared drivers previously covered only by review. Through nginx: security headers present on API and static responses, gzip negotiated, the SPA and its client-side routes served, the unknown-route envelope correct, and the auth rate limiter allowing exactly ten sign-in attempts before returning 429 with `Retry-After` from the real Redis store. End to end against that stack: sign-in returns no password hash and no lockout counters, the refresh cookie is HTTP-only, `Secure` and scoped to `/api/v1/auth`, revoking a session invalidates its access token on the very next request, and replaying a rotated refresh token returns `TOKEN_REUSE_DETECTED` and kills the whole family including the legitimately rotated token.
- The full integration suite against a real Dockerised MongoDB 6.0 replica set rather than the in-memory one: 71 passed, 0 failed, run as five suites each in its own database.
- Index verification against a live server: report mode found 157 missing and exited non-zero; apply mode created them in three seconds; a re-run reported nothing missing and nothing unknown, including the text index that a literal key comparison would have reported as both.
- OpenAPI export: 59 operations written to `docs/openapi.json` with no database or secret configured.

### Known limitations

- Without Redis, rate-limit budgets are per instance, the notification queue is in-process and Socket.IO is single-instance. All three are supported single-instance configurations and none is correct for a horizontally scaled deployment. All three shared drivers have now been exercised live (see the verification below).
- Nothing is left unverified for want of a container runtime. The limitation carried from Phase 6 is closed.
- Access tokens issued before this phase carry no session identifier and are accepted until they expire, so immediate revocation applies to sessions created after the deployment. The window is at most one access-token lifetime.
- Two-factor authentication remains a foundation rather than a feature: the security policy group and session model support it, but no second factor is enrolled or challenged.
- Password reset is administrative only. There is no self-service "forgot password" flow, because it needs an email channel with real credentials.
- The content security policy allows inline styles and one inline script, both generated by this server for the print layouts and the API reference. Moving them to hashed or nonced sources would let the policy tighten further.
- Reports are still recomputed from source on every request. The indexes and the `maxTimeMS` guard added here make that bounded and index-served rather than unbounded, but a very wide range over years of data would still be better served by a rollup.
- Two further defects were found by running the containers rather than only validating their configuration, and both are fixed. The production image did not contain the operational scripts, so the release step `docs/DEPLOYMENT.md` prescribes could not be run from the deployed artefact; the compiled scripts now ship with the image and the full report/apply/re-check sequence was run inside it against a live database. The bootstrap script created the first Super Admin with a password hard-coded in this repository, printed it, and left `forcePasswordChange` off, so any deployment that ran it had a publicly known credential valid indefinitely; the credential is now supplied by the operator, checked against the configured minimum length, never echoed, and must be changed at first sign-in.
- The CI pipeline builds container images without pushing them. Choosing a registry and its credentials is a deployment decision this repository deliberately does not make.

### Next phase dependencies

None. Phases 0-12 are complete: the system is functionally whole, hardened, indexed, documented and packaged for deployment.

---

## Road to production

Phases 0-12 delivered the features. A subsequent audit, and a session spent
actually running the system, found that "complete and tested" and "safe to
operate for a real regulated distributor" are not the same claim. Every defect
in the phases below was found by running the system or reading it against real
load. None was found by the 254 tests, the typechecker, the container build or
the green pipeline.

The full plan, including the findings each phase answers, is held outside this
repository with the working notes. The sequence is: secure the ground; the
production blockers; a verification harness; the design foundation and
application shell; close the operational dead ends; language, errors and
accessibility; regulatory traceability.

### RTP Phase 0: Secure the ground

**Status:** COMPLETED

Committed the pending fixes and the untracked dev-server script without which
no clone could start the API; added `.gitattributes`; gave the mobile app the
`typecheck` script CI had been silently skipping for twelve phases, and changed
CI from a filtered invocation that exits zero on a missing script to one that
errors; added a guard that fails the build when a test file is registered with
no script that runs it. Verified by cloning fresh and starting both apps.

### RTP Phase 1: Production blockers and money correctness

**Status:** COMPLETED

MongoDB authentication with a least-privilege application account and a
readiness probe that can actually detect its absence; one ledger-derived
definition of what an invoice owes, so a credit note no longer blocks the
customer's next order; the receivables reports rewritten from roughly 17,500
database operations to a fixed six; web session rehydration, a real sign-out
and the sign-in redirect that locked shop owners out of the web application
entirely; one money and date formatter shared by both clients, always in
`Asia/Dhaka`; and the log-redaction bypasses closed, including one that printed
delivery OTPs in plaintext on the ordinary success path.

Full detail in `docs/CHANGELOG.md`. Each defect is covered by a guard that was
demonstrated to fail when the defect is reintroduced.

## RTP Phase 2 — The verification harness

**Status:** COMPLETED

Strict TypeScript now genuinely applies to the web application; a pipeline-wiring
test reconciles CI against the workspace so a package cannot go unchecked again;
route coverage is reconciled against a route table reflected off the live
routers, with the gaps written out endpoint by endpoint rather than as a
percentage. A deterministic seed builds a working system by driving the real API.
Playwright runs six roles through both the built bundle and the dev server, and
axe holds at strict zero across fifteen screens.

Each guard was reintroduced against its own defect and watched go red.

## RTP Phase 3 — Design foundation and app shell

**Status:** COMPLETED

`@medsupply/design-tokens` replaces roughly 141 hand-picked hex values and three
simultaneous brand greens, with a parity test between its TypeScript and CSS
halves and WCAG AA asserted on both themes. Tailwind v4 replaces the Vite starter
template that had been shipping as the global stylesheet. `@medsupply/navigation`
holds the permission matrix that was written out three times. The shell adds
role-filtered navigation, breadcrumbs, search, sign-out and a theme toggle;
routes are lazy, so a shop owner no longer downloads the administration surface.
Mobile gained the per-role tab bar `AGENTS.md` has specified since phase 1.

## RTP Phase 4 — Closing the dead ends

**Status:** COMPLETED

Order cancellation now performs the transition `ORDER_STATE_MACHINE.md` has
promised since phase 4 of the original build, releasing the credit reservation
and the stock allocation with it. Passwords can be changed, and
`forcePasswordChange` is enforced. Credit override is settled as an
administrator decision and has a control on both clients. All 22 native browser
dialogs are gone.

## RTP Phase 5 — Language, errors and accessibility

**Status:** COMPLETED

English and Bangla, switchable, with the Bangla catalogue typed against the
English one so a missing key is a compile error. Numbers stay in Western digits
in both, deliberately. `@medsupply/api-client` holds the refresh policy the two
clients had diverged on. Server error codes become sentences a shop owner can
act on, carrying the correlation identifier the backend has always emitted.

## RTP Phase 6 — Regulatory traceability

**Status:** COMPLETED for purchasing, recall and retention

Suppliers, purchase orders and goods receipts, with batches carrying their
provenance and ordered-versus-received variance recorded rather than silently
accepted. `recallService` answers, for any batch, every shop that received it —
with a telephone number — and where it came from. The `invoices.items.batchId`
index that query needs did not exist, so a recall would have scanned every
invoice ever issued. A prescription-medicine movement return reads
`MedicineClassification`, which had been stored since the catalogue phase and
read by nothing. Retention archives the audit log with a verified digest before
pruning, and never deletes without one.

### What is not done

- **The purchasing and recall screens exist only as API endpoints.** The
  services, routes and tests are complete and verified; no web or mobile UI has
  been built for them, so today they are reachable only by a client that calls
  the API directly.
- **A `Recall` record with its own lifecycle** — initiated, notified, quantities
  returned, closed — is not built. The trace is read-only, which is deliberate,
  but tracking a recall through to closure is not yet possible.
- **Mobile's tab navigation has not been run on a device or emulator.** Sixteen
  screens were moved into a `(tabs)` group and the file-based routing is
  asserted by tests, but no emulator was available here, so it is verified as
  far as static checks reach and no further.
- **Translation covers the shell, navigation, statuses, errors and
  authentication.** Individual page bodies are still English-only; the catalogue
  and the switcher are in place for them.
- **Visual-regression baselines** were deferred rather than captured.

The operational work listed above - production secrets, TLS, index application,
real provider credentials, mobile distribution - still stands.

## RTP Phase 7: Documents, formatting and the operational floor

**Status:** COMPLETED

### Scope

The artefacts a customer physically receives, the formatting rules the server
had never adopted, and the two operational controls whose absence meant nobody
would learn that anything had gone wrong.

### Completed work

- **`pdfService.ts` replaced.** The fixed-offset text stamper it replaces
  truncated silently past ~28 invoice lines — 200 lines in produced 49 rendered
  runs out — and substituted `?` for every non-ASCII character, so `৳` and all
  Bangla were unprintable. The new builder measures and wraps text, paginates
  with a repeated table header and `Page n of m`, and embeds Noto Sans Bengali,
  which covers Latin, Bengali, Bengali digits and `৳` in one file. The invoice
  moved from slash-separated prose to a real column table.
- **The server adopted `@medsupply/utilities`.** Every money and date on an
  invoice, statement, receipt and credit note now uses `formatMoneyMinor` and
  `formatDate`; `formattingDiscipline.test.ts` fails the build if
  `(minor / 100).toFixed(...)` or `toISOString().slice(0, 10)` reappears.
- Three UTC date defaults on web corrected to the Dhaka calendar day, and
  `toDateTimeInputValue` added to the utilities package to replace a hand-rolled
  `+6h` offset that had begun to be copied.
- Mobile approval no longer tells the manager `"approve completed"` or stores
  `"reject requested"` as the reason the shop owner is shown.
- **`backup.ts` and `restoreDrill.ts`.** The drill verifies the archive digest
  before restoring anything, restores into a scratch database, reconciles
  document counts against the live one, and asserts every ledger transaction
  still balances. It exits non-zero, so cron can alert on it.
- **`GET /metrics`** in Prometheus format, bearer-token guarded, carrying
  request/latency/error counters, queue depth and failures, and the
  ledger-imbalance gauge.

### Verified

452 tests pass (105 API unit, 102 API integration plus 4 reconciliation, 124
web, 60 mobile, 57 browser). A backup and restore round trip was run against the
live database; corrupting a single byte of the archive makes the drill exit 1
with nothing restored. `/metrics` was scraped from a booted API and confirmed to
strip ObjectIds from route labels.

### Known limitations

- `ERROR_REPORTING_DSN` is validated and documented but no adapter is wired.
- The in-process job queue reports `failed: 0` because it keeps no dead-letter
  state; only the BullMQ driver reports a real figure.
- Selecting Bangla text out of a PDF yields visual rather than logical order.
  The page is correct; fixing extraction needs `/ActualText` and tagged PDF.
- `mongodump`/`mongorestore` are not in the API image by design. Backups need
  the MongoDB Database Tools on the host, or `--docker <container>`.

### Corrections to the audit

The CSV byte-order-mark finding was wrong: `toCsv` already emits `U+FEFF` and
`csvMinor` already uses integer arithmetic.

## Phase 23 — The journeys people actually take

**Status:** COMPLETED

The features existed and the screens did not, or existed somewhere nobody
stands. Order entry on the web, then on the phone a rep actually carries.
`GET /shops` opened to `SALES` — the role added specifically to take orders for
somebody else could not list a single shop — territory-scoped by the same rule
`decideOnBehalf` enforces, so the picker cannot offer a customer the submission
will refuse. Picking by scan, and a queue that remembers where you were working.
The roles in the specification reconciled against the roles the router enforces,
which found seventeen disagreements, one of which was a live defect:
`GET /inventory/medicines` excluded `SALES`, so both order-entry screens opened
with a search box that answered 403 for the only role they were built for.

The catalogue learned to describe something other than a tablet: generic name,
strength and dosage form are conditional on `classification` rather than
required on every row, and a supplier export of fifteen products — six medicines,
seven personal care, one baby care, one herbal — imported end to end.

## Phase 24 — Pictures, the specification, and the menu

**Status:** COMPLETED

Three things believed true and not, each found by building the gate rather than
by reading the code again.

- **Product photography is served.** `MEDIA_ROOT` is a configured directory the
  catalogue import copies into and the API serves at `/media` — unauthenticated,
  raster-only, on its own rate-limit tier, cached immutably for a year. Before
  this, every `productImageUrl` the import wrote pointed at a file no client
  could fetch.
- **The importer survives the full export.** `descriptions.csv` was read whole
  into one string, which at the documented ~4.1M rows throws rather than running
  slowly. Streamed now, and measured against a synthesised full-scale bundle:
  57,015 products, 812 MB, 62 seconds inside a 1 GB heap.
- **`docs/openapi.json` is gated.** It described 72 operations while the source
  declared 110. Gating it exposed why: the document was not reproducible, because
  two request bodies published the moment of the build as a contract default.
- **The menu is reconciled against the router.** A fifth reconciliation, and the
  first that looks at a client. Five conflicts, resolved in both directions.

### Verified

API 169 unit, 133 integration, 5 reconciliation; web 199; mobile 93 logic and 33
render. `pnpm -r typecheck` clean; lint clean apart from seven pre-existing
fast-refresh warnings in files this phase did not touch. Every new gate proved by
planting the defect it claims to catch.

### Known limitations

- The real 57,000-product export has not been run. The scale figures above come
  from a synthesised bundle of the documented shape; the sample is 15 products.
- `productImageUrl` is rendered on the web catalogue list and detail. The mobile
  order-entry search rows still show text only.
- Cost price is absent from the supplier export, so imported rows report a zero
  margin until a goods receipt supplies the real figure.
- Still open from the go-live list: SMS provider procurement, an
  `ERROR_REPORTING_DSN` adapter, and a scheduled backup — `backup.ts` exists and
  nothing runs it on a timer.

## Phase 25 — What the screenshots actually were

### Status

Complete.

### Scope

Repair every screen reported broken, find the ones that were broken and not
reported, and make the interface easier to use and better to look at — the
sidebar's length, the colour, and the density of the list screens.

### Completed work

**The cause of thirteen of the fourteen broken screens was a stale process, not
code.** The API on `:5000` had been started thirty-four hours earlier with
`start` rather than `dev`; two later `pnpm dev` stacks lost the port to
`EADDRINUSE` and stayed alive, because `node --watch` does not exit when its
script fails. Trips, pricing, stocktakes, warehouses, `/orders/quote` and
`/media` had all been added since. The server published 65 paths against the
repository's 167.

**The fourteenth, and three more nobody had reported, were a deleted
stylesheet.** `inventory.css` went when the pages were converted;
`uiDiscipline.test.ts` globs `pages/` only, so `components/` was never audited
and thirty-seven class names went on being written for a file that no longer
existed.

### Files created

- `apps/web/src/components/navIcons.tsx`
- `apps/web/src/components/ui/ProductImage.tsx`
- `apps/web/src/components/ui/ListToolbar.tsx`
- `apps/web/src/components/ui/TableLink.tsx`
- `apps/web/src/lib/sidebarState.ts`
- `apps/web/src/testing/orphanClasses.test.ts`
- `apps/web/src/testing/apiPaths.test.ts`
- `e2e/screens.spec.ts`

### Files modified

`apps/api/scripts/dev.mjs`, `apps/api/src/server.ts`,
`apps/api/src/middlewares/error.ts`, `apps/api/src/services/hardeningIntegration.test.ts`,
`apps/web/src/components/{AppShell,NotificationBell,Chart,FinanceSummaryCards,ActivityTimeline}.tsx`,
`apps/web/src/components/ui/{Data,StatusPill,index}.ts(x)`, `apps/web/src/index.css`,
`apps/web/src/lib/{query,tokenParity.test,usePasswordPolicy}.ts`,
`packages/design-tokens/{index.ts,theme.css}`, `packages/i18n/{en,bn}.ts`,
`e2e/{fixtures,navigation.spec}.ts`, `playwright.config.ts`, and 58 page files
(`<main>` → fragment; nine also gained pagination).

### Database changes

None.

### API changes

`notFoundHandler` answers `NO_SUCH_ENDPOINT` rather than `NOT_FOUND` for an
address that is not served. No route, schema or permission changed.

### Web changes

The notification panel, both analytics charts, the account credit figures and
the per-record history rebuilt on the design system; a real `@media print`
block; a shared `ProductImage` that reserves its box and falls back on error;
sidebar icons, collapsible groups and a rail; a four-step neutral ladder and two
new status tones; `ListToolbar`, `TableLink`, `Stat`/`StatGrid`; pagination on
nine list screens; nested `<main>` landmarks removed from 58 pages.

### Mobile changes

None. `packages/design-tokens` gained tokens and mobile consumes it, but no
mobile screen changed; its 93 tests pass unchanged.

### Tests added

`orphanClasses.test.ts` (4), `apiPaths.test.ts` (3), `screens.spec.ts` (42), and
18 new contrast assertions in `tokenParity.test.ts`.

### Test results

API 169 unit, 192 integration, 5 reconciliation. Web 217. Mobile 93. Browser 99,
of which the 42 new screen tests. Typecheck, lint and build clean apart from
seven pre-existing fast-refresh warnings in files not touched here.

### Known limitations

- The screen sweep opens every destination **without a path parameter**. Detail
  screens need a real record and belong in a journey spec; they are not covered
  by this gate.
- `apiPaths.test.ts` verifies the _resource_ for the five call sites that build
  their last segment from a variable action. A renamed action is caught by the
  union at the call site, which is a compile error, not by this gate. The
  financial reports are the exception: their union is read from the source and
  every member checked.
- The rail and the collapsed groups are stored per browser, not per account.
- Sidebar pending counts were considered and left out: they would break the
  frozen `exact: true` link-name matching in six specs, and need a server
  aggregate that does not exist.

### Next phase dependencies

The three gates hold the ground this phase recovered. Go-live items remain as
listed in Phase 24: SMS provider procurement, an `ERROR_REPORTING_DSN` adapter,
and a scheduled backup.

## Phase 26 — A form that is not finished is not a malfunction

### Status

Complete.

### Scope

One screenshot: the round-planning form answering its own validation with the
red "Something went wrong" card. The investigation found the same pattern on
four forms, and — while reading the primitive they all reach for — that the whole
web application's error, loading and empty wording was English regardless of the
chosen language.

### Files created

- `apps/web/src/components/ui/Feedback.test.tsx` — 7 tests over `FormNotice`,
  `ErrorState` and `LoadingState`.
- `apps/web/src/testing/uiStrings.test.ts` — the gate for an English sentence
  written as a literal in `components/ui`.

### Files modified

- `apps/web/src/components/ui/Feedback.tsx` — `FormNotice` added; `ErrorState`
  and `LoadingState` read their defaults from the catalogue.
- `apps/web/src/components/ui/Resource.tsx`, `DataTable.tsx` — likewise.
- `apps/web/src/components/ui/Field.tsx` — an optional stable `id`, so a
  validation summary can name the control it is talking about.
- `apps/web/src/pages/TripForm.tsx` — validation, the three states of the
  availability list, the rider-scoped empty wording, and the nothing-to-plan
  case.
- `apps/web/src/pages/PurchaseOrderForm.tsx`, `ReturnRequest.tsx`,
  `ShopForm.tsx` — validation moved off the failure card.
- `packages/i18n/en.ts`, `bn.ts` — a `forms` section; the round and purchase-order
  catch-all sentences split into one message per requirement.
- `apps/web/src/testing/uiWaivers.ts` — `UNTRANSLATED_PRIMITIVES`, empty.
- `e2e/journey.spec.ts` — the screenshot's own scenario, frozen.
- `docs/TESTING.md`, `docs/ASSUMPTIONS.md`, `docs/CHANGELOG.md`.

### Tests added

`Feedback.test.tsx` (7), `uiStrings.test.ts` (4), `journey.spec.ts` (1).

### Gates proved by planting the defect

- `uiStrings.test.ts` — restoring `title = 'Something went wrong'` and the
  literal `Try again`; it named both strings and the file.
- `journey.spec.ts` — restoring `ErrorState` as the round form's validation
  surface; it went red on `form-notice` not being visible.

### Test results

Web 235 (28 files). Browser 100. API 169 unit, 192 integration, 5
reconciliation. Mobile 93. Typecheck, lint and build clean apart from the seven
pre-existing fast-refresh warnings in files not touched here.

### Known limitations

- `uiStrings.test.ts` covers `components/ui` only, and only prose of two or more
  words. A single-word literal — `'Loading'` was one — is not distinguishable
  from an identifier by regex, so it is caught by the primitive's own test
  rather than by the sweep.
- Roughly ten forms still report a submit guard through `toast.error`. Those are
  mostly inside dialogs, where a toast is defensible, and they were left alone
  rather than converted speculatively; the four that used the red failure card
  were the defect.
- The round form's `needRider` problem is unreachable through the submit button,
  because the select carries the native `required` attribute and the browser
  refuses first. It is kept as the second line, not removed.

### Next phase dependencies

None. Go-live items remain as listed in Phase 24: SMS provider procurement, an
`ERROR_REPORTING_DSN` adapter, and a scheduled backup.

## Phase 27 — A catalogue you can actually run

**Status:** COMPLETED

### Scope and completed work

Four requests, three of which were holes rather than polish.

**Managing a medicine where you look at it.** `PATCH /inventory/medicines/:id`,
`POST /inventory/batches/:id/adjust`, `PATCH /inventory/batches/:id/block` and
`GET /inventory/movements?medicineId=` were all mounted, documented and tested,
and **none had ever had a caller.** `/medicines/:id` is rebuilt as stacked
sections — about, price, offers, stock, history — with role-filtered stats, a
one-field price change, list/delist, book-in-stock in a dialog, batch movements,
count correction and block/unblock. `MedicineForm` dual-mounts at
`/medicines/:id/edit`.

**Every field says what it is for.** `HelpTip` (Radix Popover, hover _and_ tap),
`Field.help`, and placeholder/hint/help copy on all nineteen catalogue fields in
both languages. `TEXT_FIELDS` became a `FieldSpec[]` of resolved strings so all
~60 `t('…')` calls are literal and gated.

**One name for every cached thing.** `lib/queryKeys.ts`; all 74 query sites and
23 broken mutations converted; seven previously-ignored realtime events wired
through one map; the cart repriced from `POST /orders/quote` instead of from
`localStorage`; `useBranding`'s module cache removed.

**Add a person.** `/admin/users/new`, the same form hosted in `PickOrCreate`'s
dialog beside every rider picker, and `POST /users` widened so a MANAGER may
create a `DELIVERY_PERSON` or a `STOREKEEPER`.

**Offers on a medicine.** `medicineId` filter on `GET /pricing/schemes`,
`objectIdParam` lifted into `requestSanitiser`, and a real schema for
`PATCH /batches/:id/block` — one of four hand-validated writes, and this phase
ships its first caller.

### New gates, each proved by planting its defect

- `queryKeyDiscipline.test.ts` — every key from the factory; every mutation
  invalidates through it. Both waiver lists empty.
- `browserSpecs.test.ts` — every `e2e/*.spec.ts` is selected by a Playwright
  project. Playwright reports zero tests for an unmatched file and prints green.

### Defects found while building

- The medicine form **could not be submitted at all**: optional fields with shape
  rules were sent an empty string.
- `apiPaths.test.ts` had silently fallen from 121 request sites to 63; its floor
  of 60 allowed it. Raised to 110.
- `TripForm` and `DeliveryDetail` shared a cache key and disagreed about its
  shape — a live crash on the rider picker.
- `TEST_IDS.toast` was in the frozen contract and emitted by nothing.
- The medicine page printed `PRESCRIPTION` as a raw enum.
- The `cart` entry in `SCREEN_READS` claimed the server was never asked
  anything, which stopped being true when the basket started quoting.

### Test results

Web 276 (34 files). Browser 116 — 44 smoke/accessibility/navigation on the built
bundle, 10 smoke on the dev server, 9 journey, 42 screens, 11 manage. API 170
unit, 194 integration, 5 reconciliation. Mobile 93.
Typecheck, lint and build clean apart from the seven pre-existing fast-refresh
warnings in files not touched here.

### Every picker converted

`SearchPicker` and `PickOrCreate` now cover every site named in the plan.
Medicine — `PriceListForm`, `PurchaseOrderForm`, `SchemeForm`,
`InventoryDashboard`. Supplier — `PurchaseOrderForm`. Customer — `OrderEntry`,
`RecordPayment`. Delivery address — `OrderEntry`. Rider — `TripForm`,
`DeliveryDetail`. Each searches the server rather than reading one unpaged page,
and each hosts its creation form in a dialog.

`GET /purchasing/suppliers` gained a `search` parameter to make that possible;
it had none, so the picker over it could only ever see the first fifty.

`AddressSchema` gained an optional `_id`. Delivery addresses are patched as a
whole array — that is the shape `PATCH /shops/:id` takes — so adding one means
sending the existing ones back, and without this the schema stripped their ids
and Mongoose minted new ones.

### Known limitations

- **The stocktake and goods-receipt forms keep a free-text `warehouseLocation`,
  and no warehouse picker exists.** That field is matched by the server as a
  _string_ against `MedicineBatch.warehouseLocation`; it is not a reference to
  the `Warehouse` model. A picker there would send an id the server matched
  against nothing, producing a stocktake that silently covers zero batches.
  Linking the two is a data change, not a UI one, and is not attempted here.
- **The price list field on `ShopForm` links out rather than opening a dialog.**
  A price list is a repeating line editor, which is more than a dialog should
  hold, and the field is optional so leaving costs less. Its cap is raised to a
  hundred and it now says so when the list is cut short — the silence was the
  defect, not the cap.
- **No SALES user is seeded**, in `e2e/fixtures.ts` or `seed.ts`, so the sales
  variant of the medicine page is covered by the page test rather than in the
  browser.
- Resolving each customer's _true_ price on the catalogue remains out of scope
  and is its own phase; the label says "List price" and states that the
  customer's own price is confirmed at ordering.
- Optimistic concurrency on `Medicine` is deliberately absent — see
  `ASSUMPTIONS.md`.

### Next phase dependencies

None. Linking `Warehouse` to `MedicineBatch.warehouseLocation` is the one piece
of unfinished business, and it is a data change rather than a screen. Go-live
items remain as listed in Phase 24: SMS provider procurement, an
`ERROR_REPORTING_DSN` adapter, and a scheduled backup.

## Phase 28: The Blank Page, and the Front Door Behind It

**Status:** COMPLETED

### Scope and completed work

Reported as "the system is showing a white blank page". The cause was a dev
server holding a stale transform of `packages/i18n/en.ts`: the module no longer
provided the export the catalogue is read through, evaluation stopped there,
`#root` was never touched, and the browser painted white with the reason in the
console. Restarting the server cleared it. The three things that did not clear
were fixed.

- **A blank page is now impossible.** `index.html` carries its own boot screen
  and a classic script that turns a failed or hung load into a sentence, the
  browser's own report of what went wrong, and a Try again button. It is
  outside `#root`, untranslated, and dismissed by the last statement of
  `main.tsx` — see `ASSUMPTIONS.md` for why each of those is deliberate.
- **`/` is a route.** It had never been one. All fifty-one manifest paths are
  sub-paths, so the origin fell through to the catch-all and told the visitor
  the page did not exist. It now sends a signed-in person to their own home
  screen and everybody else to the sign-in form.
- **The not-found screen no longer tells signed-out visitors they are signed
  in.** The sentence was unconditional, above a button that took them to the
  sign-in form.

### Testing

Web 279 (three for the front door), browser 124 (four new assertions, each run
against both the dev server and the built bundle), API 170 unit / 194
integration / 5 route coverage, mobile 93. Each new gate was proved by planting
the defect it claims to catch: the guard script deleted, the boot node left in
place, and the `/` route removed.

### Known limitations

- **The boot screen cannot rescue a partially-evaluated application.** It
  speaks only while it is still on the page, which means only before React
  mounts. Anything that fails afterwards belongs to `ErrorBoundary`, which is
  the right division but does mean a module that throws during a lazy route's
  evaluation is reported by the boundary, not here.
- **Nothing gates the arrangement structurally.** The browser tests prove the
  behaviour; there is no rule stopping somebody moving the fallback back inside
  `#root`, which would quietly disarm `expectPageRendered`. The comment in
  `index.html` says so, which is weaker than a test.

### Next phase dependencies

None. The Phase 27 item stands: linking `Warehouse` to
`MedicineBatch.warehouseLocation` is a data change rather than a screen.

## Phase 29: A Home Screen That Knows Something

**Status:** COMPLETED

### Scope and completed work

The component craft in this application was not the weak part — the token
system, focus rings, empty states and dark theme were already in place. The
weak part was information design, and `/dashboard` was the proof: a card per
destination, twenty of them on a manager's account, naming the same places the
sidebar names beside it, and carrying no fact about the business.

- **`lib/homeSignals.ts`** declares what is waiting for each role. A figure
  reuses the query key _and_ the URL of the screen it links to, so the number
  and the list cannot disagree and the click is served from cache; the
  navigation manifest decides who sees each one, so no figure can 403.
- Only work queues qualify — a total nobody can act on teaches people to stop
  reading the ones that matter. A zero is shown, and muted.
- A shop owner sees what they owe and what is out for delivery to them.
- The catalogue's "Available to order" badge, which sat on every card, now
  appears only when a medicine is delisted.

### Testing

Web 286 (six for the signal policy), browser 128 (two new, run against both web
targets), API 170 unit / 194 integration / 5 route coverage, mobile 93.

### Known limitations

- **A delivery person gets no figures on the web.** Their job is the mobile
  app; the one web screen they hold is a read-only view of their own round.
  Recorded rather than papered over with a number that means nothing.
- **A sales rep gets no figures either.** They reach pricing and their own
  customers, neither of which is a queue with a backlog.
- **Nothing gates "only queues qualify".** The rule is written in
  `homeSignals.ts` and enforced by review, not by a test — a future signal
  pointed at `/orders` would pass everything.
- The figures load independently and each renders nothing until it has an
  answer, so the row fills in rather than appearing at once.

### Next phase dependencies

None.
